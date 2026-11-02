# Debugging Notes

Engineering journal for the AXiM Coding Lab: root causes, decisions that are not
obvious from the diff, and debt that is knowingly deferred.

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
