# Debugging Notes

Engineering journal for the AXiM Coding Lab: root causes, decisions that are not
obvious from the diff, and debt that is knowingly deferred.

---

## 2026-11-06 — Sprint 1.8

### Root cause: an extension-only router cannot serve two runtimes

`validateCodeSyntax()` dispatched on file extension alone. That works while
every extension maps to exactly one artifact type, and stops working the moment
the cockpit advertises `.xml` for both `ROS 2 / Python` (launch files) and
`MuJoCo / URDF` (models). The worker had one `.xml` branch, so the second
runtime's documents were judged by the first runtime's rules and every ROS 2
launch file was told it was missing a `<mujoco>` root.

The instructive part is the failure shape, not the fix. Nothing errored. The
cockpit's `findRuntimeMismatches()` read the same table it advertised from, so it
returned `[]` and showed no warning; the dispatch succeeded; the task reached
`[AST_CHECK]` and failed with a message that was *correct about the wrong
thing*. From the operator's seat it looked like the worker was broken, and from
the worker's seat it looked like the operator had asked for a MuJoCo model. Two
services each doing exactly what they were written to do, disagreeing about a
string.

The general rule worth keeping: **an extension is a hint, a document is
fact.** Where two runtimes share an extension, route on content. `.mjcf` and
`.urdf` stay unambiguous and keep the full HAC contract; `.xml` is a model only
if it declares `<mujoco>` or `<robot>`, and otherwise gets the structural
balance check and no stronger claim. The cost is that a MuJoCo model saved as
`.xml` without its root element is now reported as malformed XML rather than as
a missing root — which is still a rejection, and the operator still gets told to
look at the file.

### Root cause: nothing tested the seam between the cockpit and the worker

`fleetRegistry.test.js` checks that the dashboard's fleet table and the worker's
`registry.ts` agree on repository names. That test is real and it works. But the
programme's actual contract with the operator is one level up: *if the cockpit
says this runtime covers this file, the worker will accept it.* No test
asserted that, so it was free to be false for as long as nobody tried a ROS 2
launch file.

`runtime_contract.test.ts` closes it by enumerating `RUNTIME_EXPECTED_EXTENSIONS`
and, for each pair, feeding the worker a genuine artifact of that type. Two
properties make it worth its runtime:

- The fixtures satisfy the validators' real requirements rather than their
  regular expressions. A header has an include guard, a sketch has
  `setup()`/`loop()` and `<Arduino.h>`, `platformio.ini` has `platform` *and*
  `board` *and* `framework`, an MJCF hinge has a `range` and a three-component
  `axis` beside an inertial `mass`. When the validator gets stricter, a fixture
  breaks and someone has to decide whether the dashboard's promise or the
  worker's rule is wrong — which is the conversation that should happen.
- It carries counter-cases. A parity suite that only asserts "valid things are
  valid" passes if `validateCodeSyntax` is changed to `return { valid: true }`.
  The mismatched-path, unconstrained-hinge and unclosed-tag cases make that a
  failing change.

It found a defect in its own first draft, which is the best evidence it is not
decorative: the `platformio.ini` fixture omitted `platform =`, and
`validatePlatformIoConfig()` rejected it. The fixture was wrong, not the rule.

### Root cause: a template dependency that nobody owned

2,076 kB of the built stylesheet was `@questlabs/react-sdk/dist/style.css`,
imported on line 3 of `src/App.jsx`. The project is literally named
`quest-react-starter` in `package.json` — it was scaffolded from a starter kit
and the kit's design-system import outlived the kit. Zero `ql-*` classes and
zero component imports existed anywhere in `src/`.

What made it survive so long is that dead CSS is invisible in every signal the
repo watches: lint does not read CSS imports, tests run in jsdom without
loading stylesheets, and the build only ever warned that *a* chunk was large —
which had been normalised into background noise by the `manualChunks`
suggestion printed on every run. `2,076 kB → 44.34 kB` is not a heroic
optimisation; it is deleting one import line that should never have been there.

The check that finds this class of thing: source CSS is 982 bytes and
`tailwind.config.js` scans only `index.html` and `src/**`, so any stylesheet
larger than a few kB in `dist/` came from `node_modules` and is worth a `grep`
for its import before it is worth a bundler config change.

### Environment trap: `NODE_ENV=production` is exported in this workspace

`npm uninstall @questlabs/react-sdk dotenv yaml date-fns` pruned **397**
packages out of `node_modules` — every devDependency, including `vite` and
`vitest`. npm reads `NODE_ENV=production` from the environment and defaults to
`--omit=dev`, so a command that reads as "remove four runtime packages" is
also "remove the toolchain".

The recovery was `npm install --include=dev --offline` against the local npm
cache, needed because the registry dropped the connection (`ECONNRESET`, then
`SIGTERM` on a 300 s timeout) mid-install. This is the second time this
variable has caused a misleading failure in this repo — Sprint 1.7 hit it
through Vite's React export condition — and `vitest.config.js` pins
`NODE_ENV=test` for tests but cannot protect an `npm install`.

Rule for the runbook: **any dependency operation in this workspace passes
`--include=dev`.** A related trap in the same family: the first build of this
sprint was run as `NODE_ENV=development vite build` and reported JS at
2,212.23 kB. That is React's development build, not a regression. Builds that
produce numbers for a document use `NODE_ENV=production`.

### Decision: labels on the runtime controls

The `Target Runtime`, `File Path`, `Target Repository` and `Execution Engine`
captions were bare `<span>`s. Making them real `<label htmlFor>` + `id` pairs
was not needed to fix a bug, but it was needed to write the dispatch test
honestly: without an accessible name the only way to reach those controls is a
positional selector, and a positional selector silently re-points at a
different control the next time the layout changes. The test now addresses them
by the name a user sees, so a reordering is a test failure rather than a test
that quietly checks the wrong select.

---

## 2026-11-05 — Sprint 1.7

### Root cause: a callback to a route nobody publishes

`dispatchCallbackWebhook()` was twenty-eight lines that looked correct. It built
a URL, signed the body, posted it, and logged a failure. Four separate problems
were invisible because each one degraded into the same `console.error` line:

| Problem | What the log said | What was true |
| :--- | :--- | :--- |
| Wrong route (`/patch-status`) | `Failed to dispatch support webhook: 404` | The Support System publishes `/api/v1/tickets/callback`; nothing has ever served `/patch-status`. |
| Wrong route (asguard) | same | Asguard publishes `/api/v1/triage/dispatch` (a mitigation order), not `/triage/resolution`. |
| v1 signature | nothing — the call succeeded | Accepted today, rejected after the receiver's 2026-12-31 sunset. A silent time bomb, not a failure. |
| No DLQ write | nothing — the 404 was logged and dropped | Nothing retried, nothing counted, no operator-visible symptom until a customer asked why their ticket was still open. |

The reason this survived several sprints is the shape of the failure: a
notification is fire-and-forget *by design*, so a broken one is indistinguishable
from one nobody needed. The fix is not "check the status code harder" — it is
that the sender now returns a `CallbackResult` the caller logs with the DLQ key,
and the receiver's routes were read out of `axim-support/onyx-edge-worker`
before the mapping was written. A callback contract that is only asserted on the
sender side is a guess.

### Decision: two DLQ shapes for one delivery path

Resolution callbacks keep `dlq:ticket-callback:<id>` with the raw body; new
patch-ready notices use `dlq:satellite-callback:<system>:<id>` with a full
envelope (`{system, endpoint, body, parkedAt, attempts, lastError}`).

One shape would have been tidier. It would also have meant either (a) rewriting
entries already parked in production into a shape the running sweeper cannot
read, or (b) stamping a replay time over the `completedAt` the ticket should
show. A raw body plus a derivable route is enough for a resolution — the ticket
id is in the key — and it keeps the existing branch, its tests and any live
entries working untouched. Patch-ready notices have no such derivation, which is
precisely why they carry their own endpoint. Two shapes, each justified by what
can be reconstructed from the key.

### Decision: asguard is left explicitly open, not papered over

The coder wants to tell the SOC "a rule PR is open" for an incident. Asguard
publishes no route that accepts that. The three options were: keep posting at a
404 (what it did), invent a payload for `/api/v1/triage/dispatch` (a route that
validates `threatId`/`action`/`targetValue` and would answer 400 — an
`OpenRedirect`-shaped lie in the other direction), or record the gap.

The dispatcher now returns `{ ok: false, endpoint: null, error: 'asguard
publishes no coder-facing resolution route…' }` without a network call, logs it
once, and the gap is listed below. A satellite interlock that does not exist is
debt, and debt belongs in a list, not in a retry loop.

**Open debt — asguard interlock.** Needs one of: `POST /api/v1/triage/resolution`
accepting `{ incidentHash, status, prUrl, commitSha }` behind
`X-Axim-Signature` v2, or a documented event route on the SOC ingest surface.
Whichever ships, the coder side is a one-line `buildSatelliteRequest()` change.

### Decision: pin the test environment in config, not in the test file

`render-smoke.test.jsx` failed all 20 cases on this host with
`act(...) is not supported in production builds of React`, because the workspace
exports `NODE_ENV=production` and Vite picks React's export condition from
`process.env.NODE_ENV` *before* it considers `config.mode`.

The tempting fix is a `NODE_ENV=test` prefix on the `npm test` script. It works,
and it leaves `npx vitest run` — the command CI actually runs, and the command
in the runbook — broken on any shell that exports the variable. Setting it in
`vitest.config.js` at module scope covers every entry point, because Vite reads
it inside `resolveConfig` *after* the config module evaluates and *before* any
test file imports React. `test.env` is too late; React is already resolved.

Same file, second trap: pinning `root` to the config's own directory. Without
it, `cd edge-coder-worker && npm test` sets the root to that folder, the
root-relative `include` patterns match nothing, and the worker suite reports
"No test files found" — a green-looking exit for a command that tested nothing.

### Observation: the suite is now bigger than this box

Eight test files, 201 tests, one 3.9 GB host with no swap and another
workspace's `vite build` running: `npx vitest run` was OOM-killed mid-report and
one worker RPC timed out at 60 s. Split with `--maxWorkers=1` it is green
(36 + 165). CI has 7 GB and `timeout-minutes: 20`, and the single-command form
passes there; but if CI starts flaking, the fix is `poolOptions` concurrency, not
fewer tests. `npm test` wall time on this host: 3.5 min idle, 7+ min under load.

### Next priorities

1. **Coordinated toolchain upgrade** — `vite@7` + `vitest@5` +
   `@vitejs/plugin-react@5` on one branch, then #130, #131 and #150 all become
   mergeable; #149 (undici + wrangler) can go with them.
2. **Asguard resolution route** — see open debt above; the coder half is ready.
3. **Interaction tests for the Prompt Terminal dispatch path** (runtime selector →
   payload → patch-ready body), still covered only by "it mounts".
4. **Prune the ~40 stale `feat/*` remote branches**; every one is merged.
5. **Chunk the dashboard bundle** — 2.08 MB CSS + 2.2 MB JS in single chunks;
   `manualChunks` would cut build wall time, which is the actual pain (12 min).

---

## 2026-11-04 — Sprint 1.6

### Root cause: a render-phase temporal dead zone, invisible to every check we ran

Both P0s are the same mistake with different variables:

```jsx
const [filePreview, setFilePreview] = useState(null);   // …
useEffect(() => { /* … */ }, [targetFiles, targetRepo]); // ← read here
const [targetRepo, setTargetRepo] = useState(/* … */);   // ← declared here
```

A dependency array is evaluated **during render**, in source order. Reading a
`const` before its declaration is not hoisting — it is a temporal dead zone
reference, and it throws. Inside a React component the throw propagates to the
nearest error boundary; the layout wraps `<Outlet />`, so the entire page body
collapsed into the fallback, not just the terminal.

Why the existing battery was blind to it:

| Check | Why it passed |
| :--- | :--- |
| `vite build` | Parses and bundles. It never calls a component function. |
| `vitest` (before this sprint) | Zero React tests — the suite covered services and the worker only. |
| `npm run lint` | `no-use-before-define` was off, so nothing objected to the order. |
| Manual smoke | The terminal is the *second* thing you see; a reviewer reading the diff sees two `useState` blocks, not their ordering relative to an effect. |

The fix is three lines of movement. The *guard* is the interesting part:

1. **Runtime:** `src/components/render-smoke.test.jsx` mounts every routed page
   and shared component in jsdom. It asserts no throw and non-empty DOM. Two
   escape hatches exist and both are explicit: per-case `props` (a closed
   command palette renders `null` by design) and `allowsEmptyRender`.
2. **Static:** `no-use-before-define` with `variables: true`. The TDZ bug is a
   *static* pattern, so it should not need a DOM to catch. Four pre-existing
   hits were hoisted — three were harmless (called from a deferred callback) but
   the rule cannot distinguish "called later" from "read now", and a rule kept at
   zero findings is a rule people keep.

### Decision: jsdom as a devDependency, not a new test framework

`@testing-library/react` would add three packages for `render()` and `screen`.
`react-dom/client` + `act` from `react-dom/test-utils` is already installed and
is enough for a mount/assert/unmount net. Interaction behaviour, when it is
written, can migrate to Testing Library (or to a real Playwright run against
`vite preview`) without rewriting this file's purpose.

`src/test/domShims.js` exists because jsdom implements the DOM tree but not
layout: `Element.prototype.scrollTo` is missing, so `SwarmLogConsole`'s
`requestAnimationFrame` autoscroll throws *after* the test completed, which
Vitest reports as an unhandled error and fails the run on. The shims are inert
no-ops, deliberately — anything asserting on layout belongs in a real browser.

### Decision: two registry copies, pinned by a parity test

The dashboard needs `owner/repo` for previews and the fleet list; the worker needs
the same table to route. Importing `edge-coder-worker/src/registry.ts` into the
browser bundle would give one source of truth and couple `src/` to the worker
tree, so the dashboard keeps its own copy — with `fleetRegistry.test.js`
importing the worker's table and failing on any divergence (keys, repo, owner,
branch, and case-exact repo spelling). Two copies that cannot drift silently is
a better trade than one copy that drags worker code into the CDN bundle.

Recorded debt: the *right* end state is a single generated module (or a shared
`fleet-registry.json` consumed by both), so the parity test becomes a proof
rather than a detector. Cheap to do during a quiet sprint; not during a render
outage.

### Note: `NODE_ENV=production` is exported in this workspace

`npm ci` and `npm install` silently omit **all** devDependencies here, which
wipes `vitest`, `vite`, `eslint` and produces a 169-package `node_modules`
instead of ~449. This bit during this sprint: a routine `npm install --save-dev
jsdom` left `npx vitest` resolving a fetcher-cached `vitest@5` and the repo
appearing to have lost its toolchain. Recovery:

```
NODE_ENV=development npm ci
```

It also explains an apparent bundle-size jump (+359 kB on the JS chunk): the
first build of the day ran against the pre-existing hand-installed
`node_modules`, the later ones against the lockfile-exact tree that `npm ci`
produces — which is what CI has always used. The lockfile was not changed beyond
jsdom's own dependency tree.

### Open debt: the Dependabot PRs cannot be merged one at a time

`#130`, `#131` and `#150` are red for the same reason:

| PR | Bumps | Peer conflict |
| :--- | :--- | :--- |
| #130, #131 | `vitest@5` | vitest 5 peer-requires `vite@^6.4 \|\| ^7 \|\| ^8`; project has `vite@^5.4.2` |
| #150 | `vite@8` + `vitest@5` | `@vitejs/plugin-react@4.7.0` peer-requires `vite@^4 \|\| ^5 \|\| ^6 \|\| ^7` |

They are not independently mergeable and no amount of re-running will change
that. The coordinated path is `vite@7` + `vitest@5` + `@vitejs/plugin-react@5`,
verified on one branch (the dashboard build is ~12 minutes on this runner, and
`vite@8` needs Node ≥ 20.19 — `.nvmrc` says 20). #149 (undici + wrangler) is
green and independent. Deliberately not bundled into a render-outage sprint.

Also observed: build wall time is 12–13 minutes and the full `vitest` suite is
3–6 minutes depending on machine load; the CI workflow allows 20 minutes per
job, so there is headroom but not much. If it becomes a problem, the CSS chunk
(2.07 MB) and the single 2.2 MB JS chunk are the first things to attack via
`manualChunks`.

### Next priorities

1. Coordinated toolchain upgrade (`vite@7` / `vitest@5` / `plugin-react@5`) to
   clear #130, #131, #150 in one merge.
2. `resolveFleetCoordinates()` is now the single dashboard resolver — route the
   remaining hardcoded repo strings in `src/pages/*.jsx` through it.
3. Interaction tests for the Prompt Terminal dispatch path (runtime selector →
   payload), which today is covered only by "it mounts".
4. Prune the ~40 stale `feat/*` remote branches; every one of them is merged.

---

## 2026-11-03 — Sprint 1.5

### Root cause: an approval link that merged anything

`/api/v1/pr/action` asked one question — "is this token the literal string
`consumed`?" — and then merged whatever `owner`, `repo` and `pr` the query
string named, using `GITHUB_TOKEN`. An unminted token is not `consumed`, so the
endpoint was effectively unauthenticated. Two further problems hid inside it:

1. **The token record was never consulted.** The briefing stored
   `JSON.stringify(pr)` under `pr_token_<uuid>`, and the handler only ever read
   it to look for the word "consumed". Nothing bound a token to a PR.
2. **A GET mutated state.** Approval links land in an inbox; Gmail and Outlook
   both prefetch URLs. A prefetch was enough to merge.

The fix keeps the workflow the operator asked for (one click from the email) and
moves the confirmation one step later: GET renders a page, the button POSTs, and
the merge target comes from the token record rather than the URL. Tests assert
the GET merges nothing and that a forged token cannot name its own target.

### Decision: the operator session is the console credential, not a bundled HMAC key

Three call sites in `labService.js` signed payloads with
`import.meta.env.VITE_AXIM_INTERNAL_KEY || 'development-key'`. `README.md`
already says not to set that variable, because Vite inlines `VITE_*` values into
the public bundle. So the code was in one of two states:

| State | Consequence |
| :--- | :--- |
| Key not set at build time | Every dispatch was signed with `development-key`, the edge rejected it, and the Prompt Terminal could not start a task at all. |
| Key set at build time | The shared internal key shipped to every visitor of the dashboard. |

Options considered:

| Option | Verdict |
| :--- | :--- |
| Move signing to a server-side signer (Support proxy) | Architecturally right for the *satellite* path and already how `dispatchSupportTask` works, but it cannot cover a Support outage — which is exactly when the dashboard is the only console. |
| Keep HMAC and set the key anyway | Publishes the master secret. Rejected. |
| Accept a verified Supabase operator session as an alternative to the signature | Chosen. The session is already verified against `GET /auth/v1/user` and restricted to `SUPER_USER_EMAILS`; the HMAC stays the service credential. |

A signature that is *present* is still always verified — the session path is only
for requests that carry no signature at all — so a tampered body cannot ride in on
a valid session. Every session-authorised relay request is logged.

**Trade-off:** a stolen operator session can now drive the same routes that used
to require the shared key. That session already grants dashboard access to the
same pipeline, and it expires and is revocable, which the static key is not.

### Decision: `lock:` and `pr-open:` instead of a longer lease

The lease used to be the only dedupe mechanism, so it could not be released on
success — and it only lasted an hour, after which a Support retry regenerated the
patch and opened a second PR. Now the lease covers the *run* and a separate
`pr-open:<taskId>` marker covers the *outcome* for 24 hours. The pipeline
releases the lease as soon as it has a PR URL, and a retry receives
`202 { status: 'ignored', reason: 'pr-open', pr_url }`.

Two paths deliberately clear the marker: `deploy-action` with
`action: "REJECTED"` (a rejection means regenerate) and GitHub's
`pull_request.closed` webhook (the outcome is settled either way). `force-unlock`
keeps it unless the operator passes `clear_pr: true`, so an operator cannot
accidentally spawn duplicate PRs while unsticking a task.

### Decision: guard the queue send instead of trusting the binding

`SWARM_QUEUE.send()` was awaited after the lease was claimed and had no
`try`. Three failure modes shared one symptom — a task that never ran:

- no binding (`wrangler.toml` declares none), so `send` on `undefined` threw;
- a payload over the 128 KiB message limit;
- a transient queue error.

All three now fall through to `ctx.waitUntil(executeCodingPipeline(...))` and the
caller still receives `202` with `transport: "inline"`. Separately, a producer
binding with no `queue()` consumer is a black hole — work is acked at the edge
and dropped — so `consumeSwarmQueue()` now exists and `wrangler.toml` documents
both halves together.

### Root cause: telemetry that was never telemetry

`/api/telemetry/edge-metrics` answered `requestCounts.total: 100`,
`kvCacheHits: 95` and a 42MB/64MB heap on every request. `roundTripLatencyMs`
subtracted a `Date.now()` epoch from a `performance.now()` origin, so the
dashboard's "P99 <N>ms" badge was reading roughly −1.7×10¹² and clamping it to the
hard-coded floor of 85ms in `Telemetry.jsx`.

Values are now measured where a measurement exists (DLQ depth, telemetry event
count, request duration) and `null` where the runtime cannot produce one (memory,
and request totals without an Analytics Engine query). The dashboard reads
`upstreamHealth` and `roundTripLatencyMs`, both of which are still present.

The same rot was in the daily briefing: `prsOpened: 12, prsReviewed: 10,
prsMerged: 8, tokenCost: '$12.50'` plus a hard-coded "CRITICAL HOTFIX" rows with
an approve link that merged nothing. It now counts real rows, lists real PRs, and
prints `n/a` rather than a plausible number.

### Known debt (not addressed today)

1. **TypeScript is not linted.** `eslint.config.js` only covers
   `**/*.{js,jsx}`. Everything under `edge-coder-worker/src` is unchecked by
   `npm run lint` and there is no `tsc --noEmit` in CI, so type errors surface
   only if esbuild trips over syntax. Adding `typescript-eslint` is a dependency
   change and belongs in a deliberate toolchain PR.
2. **`src/services/supportGateway.js` still signs in the browser** on its
   fallback path, with `VITE_AXIM_INTERNAL_KEY || localStorage.axim_internal_key`.
   The primary path (Support proxy) is correct; the fallback needs a server-side
   signer on the Support side before the key can be removed entirely. The worker
   now accepts a session there too, so the fallback could drop the signature
   today — left alone this sprint to keep one behaviour change per surface.
3. **`TELEMETRY_KV` and `CODER_DLQ_KV` are not declared in `wrangler.toml`.**
   Both are guarded everywhere they are read, but until the namespaces are bound
   the DLQ, DLQ stats and telemetry event endpoints all no-op. Binding them needs
   real namespace IDs.
4. **Dependabot PRs #149/#150/#131/#130** bump `vite`/`vitest`/`wrangler` and are
   open against `main`. They were triaged but not merged: a toolchain major bump
   is a bad co-tenant for a security sprint, and #131/#130 are superseded by #150.
5. **147 stale remote branches.** Each sprint leaves its feature branch behind.
   Safe to prune `feat/coding-lab-sprint-*` older than 30 days, but that is an
   operator call, not an automation one.

---

## 2026-11-02 — Sprint 1.4

### Root cause: why `main` shipped a worker that cannot bundle

Two feature branches (`feat/coding-lab-sprint-1.3-php-defense-and-fleet-registry-*`
and `…-and-robotics-interlock-*`) were both cut from the same base and both
inserted the PHP2Shell guard at the top of `fetch()`. The second merge added the
block again *after* `validateEnv()`, so `url`, `suspiciousPhpPattern` and
`pathTraversalPattern` each existed twice in one scope.

Three things conspired to hide it:

1. **No CI.** `.github/` did not exist, so nothing bundled the worker on a PR.
2. **`npm test` was green.** Vitest transforms per-file; the tests never imported
   `ingress.ts`, they imported nothing at all — `hardening.test.ts` defined its own
   `mockFetch()` with its own copy of the regexes.
3. **The runbook's worker command silently "passed".** `cd edge-coder-worker &&
   npm test` ran the *root* project because the directory had no `package.json`.

The durable fix is the third one: the worker now has its own manifest, its tests
import `worker.fetch`, and CI runs `wrangler deploy --dry-run` on every PR.

### Decision: verify Supabase tokens server-side, not by decoding the JWT

`verifySupabaseToken()` previously did
`JSON.parse(atob(token.split('.')[1]))` and trusted `decoded.email`. Any string
shaped like a JWT with the operator's email in the payload was accepted — the
signature was never checked.

Options considered:

| Option | Verdict |
| :--- | :--- |
| JWKS (`/auth/v1/.well-known/jwks.json`) + WebCrypto RS256 | Correct, no extra latency after the first fetch, but ~120 lines of key-cache and claim (exp/aud/iss) code to get right, and Supabase can rotate its signing key or move to EdDSA. |
| `GET /auth/v1/user` with the bearer token | Supabase does the verification, including revocation and expiry. One extra round trip, cached per token fingerprint for 60s (bounded at 64 entries). |
| Keep trusting the payload, add HMAC | Does not verify the session at all; the HMAC already gates the body. Rejected. |

Chose `/auth/v1/user`. The internal-key bypass stays so service-to-service callers
and the operator's `axim_internal_key` fallback keep working if Supabase auth is
unreachable. Rejections are logged to `coding_tasks_errors` exactly as before.

**Trade-off:** if Supabase auth is down, dashboard logins fail closed even though
the HMAC envelope is valid. That is the correct failure direction for a system
that opens PRs, but it is a new availability dependency — flagged below.

### Decision: v2 signatures with a v1 migration window

`JimEllars/AXiM-Support-System-1.1-4538` (`onyx-edge-worker/src/index.ts`)
verifies internal callbacks as either:

- **v2:** `X-Axim-Timestamp` + `HMAC_SHA256("<ts>.<body>")`, skew ≤ 300s
- **v1:** body-only HMAC, honoured only until `AXIM_SIG_LEGACY_UNTIL`
  (default `2026-12-31`), logged on every use

The Coding Lab emitted v1 only. Nothing was visibly broken today, but on
2027-01-01 every resolution callback would 401 and the DLQ would fill — silently,
since the DLQ sweeper also used v1.

Inbound accepts both (v2 first) so the Support System's dispatcher can migrate on
its own schedule; outbound always signs v2. `AXIM_SIG_LEGACY_UNTIL` is *not* set
in the Coding Lab, so the inbound fallback has no local sunset — if the operator
wants a hard cutover, set that variable and the worker will ignore v1 once it
passes.

### Decision: stop calling Support routes that do not exist

Verified against the Support System source:

| Call site | Route | Exists? |
| :--- | :--- | :--- |
| `callback_dispatcher.ts` (`support`) | `POST /api/v1/tickets/:id/patch-status` | **No** |
| `/api/v1/dlq/sweep` replay | `POST /api/v1/axim-resolution` | **No** |
| deploy-action resolution | `POST /api/v1/tickets/:id/resolve-from-coder` | Yes |

The 404s were being swallowed by `console.error` in the dispatcher and by the
per-entry `catch` in the sweep, so they showed up only as DLQ growth. The sweeper
now reuses the resolution path, and `PATCH_READY` no longer posts anywhere.

**Open item:** `dispatchCallbackWebhook('support', { status: 'PATCH_READY' })` is
still called when a PR opens. It is now a no-op for Support (no route exists), so
the event is invisible to Support operators until a route lands upstream. Either
the Support System adds a patch-status route, or the Coding Lab writes the event
to `coding_tasks` only. Needs a product decision, not a code fix.

**Also unverified:** the Asguard endpoint
`https://asguard.axim.us.com/api/v1/triage/resolution` could not be checked
because `JimEllars/AXiM-Asguard-System-App-1` is not in this workspace. Worth
verifying before relying on it.

### Definition of Hardware-as-Code validation

The old MuJoCo branch computed `openTags`, `closeTags`, `selfClosingTags` and used
none of them; the only rule was "if `<joint` appears, `name=` must appear
somewhere". A model with every joint range inverted passed.

New rules, in the order they fire:

1. **Tag-stack balance** — comments, CDATA, PIs and doctype are stripped first, so
   a `<` inside a comment cannot unbalance the stack.
2. **MuJoCo:** `<mujoco>` root; every `<joint>` named; `hinge`/`slide` need
   `range="min max"` with `min < max` and a 3-component `axis`; every `<inertial>`
   needs `mass > 0` and `pos`.
3. **URDF:** `<robot name>`, at least one `<link>` and `<joint>`, `<limit lower
   upper>` on `revolute`/`prismatic`, at least one `<inertial>` with
   `<mass value> > 0`.
4. **FreeCAD:** geometry import present, no dimension-less `Part.makeX()` /
   `Draft.makeX()`, `addGeometry`/`addConstraint` when Sketcher is used, and at
   least one of `Part.show`, `recompute`, `Part.export`, `Mesh.export`.
5. **PlatformIO:** `platformio.ini` needs `[env:]`, `platform`, `board`,
   `framework`; `.ino` needs `#include`, `<Arduino.h>`, `void setup()`, `void loop()`.

These are structural checks, not interpreters — a valid-but-wrong model still
passes. They exist to stop obviously unloadable files from reaching a branch, not
to replace a real FreeCAD/MuJoCo run.

### Deferred debt (known, not fixed today)

1. **The worker's TypeScript is never linted or type-checked.** `eslint.config.js`
   lints `**/*.{js,jsx}` and the worker has no `tsconfig.json`, so `npm run lint`
   says nothing about `src/*.ts`. `wrangler deploy --dry-run` bundles but does not
   type-check. Adding `typescript-eslint` with a worker `tsconfig` is the next
   structural win; it will surface a backlog of implicit-any (`renderHtml(message)`),
   which is why it was not bundled into a repair sprint.
2. **Multi-file orchestration is claimed but not implemented.**
   `executeAutonomousCodingTask` reads `target_file_paths[0]` only; the PR body
   implies every listed file was touched.
3. **`step_count`, `tokens_consumed`, `exit_code`** in `code_generator.ts` are
   module-level mutable globals shared across concurrent tasks in the same isolate.
4. **`/api/telemetry/edge-metrics` returns hard-coded numbers** (`requestCounts.total: 100`,
   `kvCacheHits: 95`, `workerMemory: 42MB/64MB`) — the dashboard presents them as
   live telemetry.
5. **`docs` drift:** `VERIFICATION_APPENDIX.md` still carries the sprint 1.2/1.3
   tables. It now points at `AGENTS_VERIFICATION.md`; folding it in properly is a
   documentation pass, not a code change.
6. **Five stale Dependabot PRs** (#130, #131, #145, #149, #150) are open, and #130/#131
   are superseded by #150 (both bump vitest). They now get real CI; merge the two
   current ones and close the superseded pair.

### Verification notes

- `npm ci --dry-run` succeeds at the repo root, so the lockfile the new CI job uses
  is in sync.
- `npm test` at the root picks up both the dashboard suite and the worker suites
  (5 files / 91 tests); `cd edge-coder-worker && npm test` runs the worker's own 4
  files / 90 tests.
- Test suites stub `globalThis.fetch`, but passthrough of non-HTTP URLs is required
  — Vitest's own module runner resolves `@vite/env` through the same global, and an
  unconditional stub deadlocks the worker pool.
- The Vite build needs ~4 GB; on the 3.9 GB review box it has to run on its own or
  the process gets OOM-killed at `transforming...`.
