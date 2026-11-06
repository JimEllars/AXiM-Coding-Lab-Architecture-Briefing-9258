# AGENTS Verification Log

Canonical, append-only record of what the autonomous coding engine changed and
the exact commands that prove it. Newest entry first.

Companion documents:
- `VERIFICATION_APPENDIX.md` — historical table for sprints up to 1.3.
- `DEBUGGING_NOTES.md` — root causes, decisions and open debt.
- `CHANGELOG.md` — release-facing summary.

---

## 2026-11-06 — Sprint 1.8: runtime-contract parity, ROS 2 XML routing, bundle diet

Branch `feat/coding-lab-sprint-1.8-hac-routing-and-bundle-diet`.
Base `aeaef6f` (origin/main).

Upstream audit: `git log origin/main --since="24 hours ago"` returned exactly one
commit — `aeaef6f feat(coder): land satellite callbacks on real routes with v2
envelopes and honest payloads (#156)` — which is the previous sprint's own
squash-merge. No human-authored commits, no human-modified prompts, security
boundaries or UI layout in the window. `gh pr list` showed four open PRs (#130,
#131, #149, #150), all Dependabot, no maintainer work in flight. The working
tree was clean, so the branch was cut straight from `aeaef6f`; nothing upstream
was rewritten, rebased over, or force-pushed.

### 0. Baseline was green, so forward work was permitted

The repair gate did **not** trigger this run. Recorded before any edit, on
`aeaef6f`:

```
$ npm run lint
> eslint .
(no output, exit 0)

$ npm test
 Test Files  8 passed (8)
      Tests  201 passed (201)
   Duration  140.31s

$ npm run build
✓ built in 13m 16s

$ cd edge-coder-worker && npm test
 Test Files  8 passed (8)
      Tests  201 passed (201)

$ npx wrangler deploy --dry-run --keep-vars --config wrangler.toml
Total Upload: 142.21 KiB / gzip: 31.97 KiB
--dry-run: exiting now.
```

One thing was checked rather than assumed: `cd edge-coder-worker && npm test`
reports the same 8 files as the root run, which looks like the worker suite is
never executing. `npx vitest list` shows why it is fine — the root
`vitest.config.js` pins `root` to the repo root and declares
`edge-coder-worker/tests/**/*.test.ts` in `include`, so the subdirectory run
resolves 5 worker files plus 3 dashboard files either way. No false green.

### 1. P0 — a ROS 2 launch file could not pass the worker's syntax gate

Found by reading `validateCodeSyntax()` against the extensions the cockpit
publishes. `RUNTIME_EXPECTED_EXTENSIONS` promises `.xml` under both
`ROS 2 / Python` and `MuJoCo / URDF`; the worker had one branch:

```ts
const isMuJoCo = loweredPath.endsWith('.xml') || loweredPath.endsWith('.mjcf') || loweredPath.endsWith('.urdf');
```

Reproduced directly against `code_generator.ts`:

```
isHardwareAsCode: true
validateCodeSyntax: {"valid":false,"error":"MuJoCo model is missing the <mujoco> root element."}
```

for a textbook ROS 2 launch document:

```xml
<?xml version="1.0"?>
<launch>
  <node pkg="telemetry" exec="publisher" name="telemetry_publisher">
    <param name="rate_hz" value="50"/>
  </node>
</launch>
```

The operator's view of this was the worst case: `findRuntimeMismatches()` sees
`.xml` in the table, so the cockpit showed **no** warning, the task dispatched,
an LLM run was spent, and `[AST_CHECK]` failed with a message naming a MuJoCo
root element the operator never asked for.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/code_generator.ts` | 611–613 | `isMuJoCo` narrowed to `.mjcf`/`.urdf` unconditionally, plus `.xml` only when the document carries a `<mujoco>` or `<robot>` root. |
| `edge-coder-worker/src/code_generator.ts` | 700–708 | New `else if` branch for remaining `.xml`: `countXmlTagBalance()` structural check plus a "declares no elements" guard. Deliberately makes no claim beyond well-formedness. |

The HAC contract is untouched where it belongs: an `.mjcf` or `.urdf`, or an
`.xml` that does declare a robotics root, still goes through
`validateMuJoCoModel()` with the same joint-range, axis and inertial rules.

### 2. P1 — the runtime contract had no test tying the two halves together

`fleetRegistry.test.js` asserts the two *fleet tables* agree. Nothing asserted
that the extensions the cockpit advertises are extensions the worker can route,
which is how the `.xml` defect survived. New suite:

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/tests/runtime_contract.test.ts` | 1–190 (new) | 34 tests. Iterates every `(runtime, extension)` pair in `RUNTIME_EXPECTED_EXTENSIONS`, renders a genuine minimal artifact (include guards for headers, `void setup()`/`void loop()` + `<Arduino.h>` for sketches, `platform`/`board`/`framework` for `platformio.ini`, joint `range`+`axis`+inertial `mass` for MJCF/URDF, `#usda 1.0` for USDA), asserts `findRuntimeMismatches()` returns `[]` and `validateCodeSyntax()` returns `valid: true`. |
| `edge-coder-worker/tests/runtime_contract.test.ts` | 34–50 | `.py` and `.xml` are runtime-dependent, so those lookups are keyed `runtime:ext` — a FreeCAD script imports `Part`/`FreeCAD`, a Python sandbox module must not. |
| `edge-coder-worker/tests/runtime_contract.test.ts` | 168–190 | Anti-vacuity cases: mismatched paths must still be flagged, an unconstrained hinge must still be rejected, an unclosed `<launch>` must still be rejected. |

Both directions were mutation-tested rather than trusted.

Reverting only the `isMuJoCo` narrowing:

```
 × runtime contract parity (dashboard promise vs worker routing) > worker accepts a valid ROS 2 / Python → .xml artifact 162ms
     Tests  1 failed | 33 passed (34)
```

The suite caught one real defect in its own fixture on first run, which is the
behaviour that was wanted:

```
 × worker accepts a valid PlatformIO Firmware → .ini artifact
   → PlatformIO Firmware .ini: platformio.ini is missing a platform = <vendor> entry.
```

`validatePlatformIoConfig()` was right and the fixture was wrong; `platform =
espressif32` was added to the fixture, not a rule relaxed.

### 3. P1 — the dispatch path had only ever been covered by "it mounts"

`render-smoke.test.jsx` proves `PromptTerminal` renders. It cannot prove the
thing the component exists to do. A wrong `runtime_env` does not throw — it
routes generated code to the wrong validator and fails much later.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/components/PromptTerminal.dispatch.test.jsx` | 1–227 (new) | 7 tests driving the real DOM. Asserts the object passed to `labService.triggerTask`: `runtime_env` follows the runtime selector, comma-separated paths split into `target_file_paths`, `delegate_to_jules` follows the engine selector, `repository_name`/`project_key` follow the repo selector. Also: mismatch warns without blocking, empty prompt does not dispatch, non-operator cannot dispatch, failed edge call logs and preserves the prompt text. |
| `src/components/PromptTerminal.jsx` | 293 | `aria-label="Task prompt"` on the prompt textarea. |
| `src/components/PromptTerminal.jsx` | 315–322, 335–342, 350–357, 370–377 | Four caption `<span>`s became `<label htmlFor>` + matching `id` on the control (`axim-target-repo`, `axim-execution-engine`, `axim-target-runtime`, `axim-target-files`). |

The label change is not cosmetic: without an accessible name the controls could
only be reached by positional selector, so a test written against them would have
been pinned to DOM order. Two details the suite has to get right or it passes for
the wrong reason — the role gate, and React's value tracking:

- The deploy control is `disabled={… || !isSuperUser}`, so every case sets
  `localStorage.axim_user_role = 'super_user'`, and one case asserts it stays
  disabled for `engineer`.
- A raw `element.value = x` is swallowed on the next render because React keeps
  its own value tracker; the helper goes through the native prototype setter and
dispatches `input`, which is what a keystroke does.

Mutation check — hard-coding `runtime_env: 'Node.js Edge'` in `handleDeploy`:

```
 × sends the selected runtime as runtime_env 1995ms
 × splits comma-separated target paths and keeps the MuJoCo runtime intact 323ms
     Tests  2 failed | 5 passed (7)
```

### 4. P2 — 2.03 MB of CSS for a library nothing imports

The produced stylesheet was 2,076.40 kB. `tailwind.config.js` scans only
`index.html` and `src/**`, and the repo's own CSS is 982 bytes total, so the
weight had to be coming from a dependency. It was:

```
$ ls -la node_modules/@questlabs/react-sdk/dist/style.css
-rw-r--r-- 1 pi pi 2031637 … style.css
```

`src/App.jsx` line 3 imported that stylesheet. The SDK itself was used nowhere:
`grep -rn 'quest' src/` returned only the import, and no `ql-*` class appears
anywhere in `src/`. It is a leftover from the `quest-react-starter` template this
project was scaffolded from. The stylesheet's first bytes are four blocking
`@import` requests to `fonts.googleapis.com`, so it was also a third-party
request on every first paint.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/App.jsx` | 1–4 | `import '@questlabs/react-sdk/dist/style.css'` removed. |
| `package.json` | dependencies | `@questlabs/react-sdk`, `dotenv`, `yaml`, `date-fns` removed — all four had zero import sites in `src/` and `edge-coder-worker/`. |
| `package-lock.json` | — | −1,561 lines, +83. `yaml` correctly remains in the lock: `npm explain yaml` shows it as `peerOptional` of `postcss-load-config` under `tailwindcss`. |

Measured with `NODE_ENV=production`, before and after:

```
              before              after
CSS      2,076.40 kB  gzip 1,373.56 →   44.34 kB  gzip  7.90
JS       1,854.27 kB  gzip   560.87 → 1,854.51 kB  gzip 560.95
build         13m 16s          →      10m 40s
```

−97.9 % CSS raw, −99.4 % gzip, −51.7 % total shipped payload raw, and a build
2m36s shorter. The recurring `invalid-calc` warning
(`width:calc(100%-24px)`) that printed on every build came from that stylesheet
and is gone with it.

An environment trap worth recording, because it bit this run: this workspace
exports `NODE_ENV=production`, and `npm uninstall` respects it, so the command
silently pruned all 397 devDependencies out of `node_modules`. Recovery was
`npm install --include=dev --offline` from the local cache after the registry
dropped the connection mid-install. Any dependency change here must pass
`--include=dev` or `--production=false`.

Also note the first build of this sprint was run as `NODE_ENV=development` and
reported JS at 2,212.23 kB — 358 kB of React's development build, not a
regression. It was rebuilt under `NODE_ENV=production` before any number above
was recorded.

### 5. Verification (final, on the completed branch)

```
$ npm run lint
> quest-react-starter@0.0.0 lint
> eslint .
(no output, exit 0 — 0 errors, 0 warnings)

$ npx vitest run
 ✓ src/services/supportGateway.test.js (1 test)
 ✓ src/lib/fleetRegistry.test.js
 ✓ src/components/PromptTerminal.dispatch.test.jsx (7 tests)
 ✓ edge-coder-worker/tests/runtime_contract.test.ts (34 tests)
 ✓ edge-coder-worker/tests/hac.test.ts
 ✓ edge-coder-worker/tests/hardening.test.ts
 ✓ edge-coder-worker/tests/registry.test.ts
 ✓ edge-coder-worker/tests/trust_boundary.test.ts
 ✓ edge-coder-worker/tests/worker.test.ts
 ✓ src/components/render-smoke.test.jsx (20 tests)

 Test Files  10 passed (10)
      Tests  242 passed (242)
   Duration  106.29s

$ env NODE_ENV=production npx vite build
✓ 1063 modules transformed.
dist/index.html                     1.16 kB │ gzip:     0.57 kB
dist/assets/index-BCleuDDR.css     44.34 kB │ gzip:     7.90 kB
dist/assets/index-B59QDdrS.js   1,854.51 kB │ gzip:   560.95 kB
✓ built in 10m 40s

$ cd edge-coder-worker && npx wrangler deploy --dry-run --keep-vars --config wrangler.toml
Total Upload: 142.51 KiB / gzip: 32.03 KiB
--dry-run: exiting now.
```

| Metric | Before | After |
| :--- | :--- | :--- |
| Lint | 0 errors, 0 warnings | 0 errors, 0 warnings |
| Tests | 201 across 8 files | **242 across 10 files** |
| Build | 13m16s, CSS 2,076.40 kB | 10m40s, CSS 44.34 kB |
| Worker bundle | 142.21 KiB / 31.97 KiB gzip | 142.51 KiB / 32.03 KiB gzip (+0.3 KiB from the new XML branch) |

---

## 2026-11-05 — Sprint 1.7: satellite callback integrity, honest ticket notes, hardware-as-code accuracy

Branch `feat/coding-lab-sprint-1.7-callback-integrity-hac-accuracy`.
Base `65f7df9` (origin/main).

Upstream audit: `git log origin/main --since="24 hours ago"` returned exactly one
commit — `65f7df9 feat(coder): repair the cockpit render crash, add a render test
harness, widen the PHP2Shell screen (#155)`, authored by Jell36 — plus four open
Dependabot PRs (#130, #131, #149, #150) and no human-authored PRs. The workspace
held no uncommitted work, so the branch was cut straight from `65f7df9`; nothing
of the human commit was touched.

### 0. P0 — the baseline was red before any feature work, for an environmental reason

The repair gate triggered immediately. `npm test` on the untouched base commit:

```
FAIL  src/components/render-smoke.test.jsx > dashboard render smoke > mounts
      PromptTerminal without throwing
AssertionError: expected 'PromptTerminal: act(...) is not support…' to be null
+ Received:
"PromptTerminal: act(...) is not supported in production builds of React."

 Test Files  1 failed | 7 passed (8)
      Tests  20 failed | 162 passed (182)
```

All 20 render-smoke cases failed with the same error, which has nothing to do
with any component: this workspace exports `NODE_ENV=production` (already
recorded in `DEBUGGING_NOTES.md` for `npm ci`), Vite chooses React's export
condition from `process.env.NODE_ENV` *ahead of* `config.mode`, so every test
resolved `react.production.min.js` — and `act()` refuses to run against it. The
same command passes on a shell without that variable and in CI, which is exactly
the kind of check that looks green until the day it doesn't.

| File | Lines | Change |
| :--- | :--- | :--- |
| `vitest.config.js` | 1–61 (new) | Pins `NODE_ENV=test` at config-module evaluation time (before Vite locks export conditions), pins `root` to the config file's directory so `npx vitest run` and `cd edge-coder-worker && npm test` resolve the same set, declares the explicit `include` set, and merges `vite.config.js` so the `@` alias and React plugin still apply. Per-file `// @vitest-environment jsdom` pragmas stay authoritative. |

Verified: with the config, the same command on the same tree reports
`Test Files 8 passed (8) / Tests 182 passed (182)`.

### 1. P1 — the Support patch-ready callback posted to a route that does not exist

`dispatchCallbackWebhook('support', …)` — fired for every generated patch, from
both `code_generator.ts` and the merge gate — posted to
`https://support.axim.us.com/api/v1/tickets/<id>/patch-status`. The Support
System (`axim-support/onyx-edge-worker/src/index.ts`) publishes:

| Method + path | Body | Effect |
| :--- | :--- | :--- |
| `POST /api/v1/tickets/callback` | `{ ticketId, patchDetails, commitSha, prUrl }` | status → `Review-Patch-Pending`, inserts the diff notice |
| `POST /api/v1/tickets/:id/resolve-from-coder` | `{ status, resolutionNotes, completedAt }` | status → `resolved` / `closed` |

`/patch-status` is not in that set, so every run produced a 404 that was
`console.error`-ed and dropped. Two more problems sat in the same function: the
signature was **v1** (body-only), which the Support System rejects outright after
`AXIM_SIG_LEGACY_UNTIL` (default 2026-12-31), and the failure path wrote **no
DLQ entry**, so a lost ticket update had nothing to retry.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/callback_dispatcher.ts` | 1–322 (rewritten) | Single delivery path: `buildSatelliteRequest()` maps a callback onto the route/body each satellite actually implements; `dispatchCallbackWebhook()` signs v2 (`X-Axim-Timestamp` + HMAC over `${ts}.${body}`), applies a 10 s timeout, returns a structured `CallbackResult` instead of `void`, and parks failures with `parkFailedCallback()`; `replayParkedSatelliteCallback()` redelivers a parked body with a fresh envelope. |
| `edge-coder-worker/src/ingress.ts` | 2 | Imports `replayParkedSatelliteCallback`. |
| `edge-coder-worker/src/ingress.ts` | 716–722 | `replayDlqEntry()` gains the `dlq:satellite-callback:` branch. |
| `edge-coder-worker/src/code_generator.ts` | 843–862 | Pipeline sends the patch-ready notice with the real branch commit SHA (was `commit_sha: 'pending'`). |

Parking keeps two shapes on purpose: resolution callbacks keep the historical
`dlq:ticket-callback:<id>` key and raw body (entries already in production must
keep replaying through the existing branch, and the route is derivable from the
key), while patch-ready notices have no derivation and are parked as a full
envelope under `dlq:satellite-callback:<system>:<id>`.

Asguard is a separate, deliberate case: it publishes `/api/v1/triage/dispatch`
(a mitigation order) and **no** coder-facing resolution route, so the old
`POST /api/v1/triage/resolution` was also a guaranteed 404. The dispatcher now
returns `{ ok: false, error: '…no coder-facing resolution route…' }` without a
network call and logs the gap once; see `DEBUGGING_NOTES.md` open debt.

### 2. P1 — customer-facing ticket notes contained values that were never measured

Two fabrications lived in the resolution payload:

| Site | Was | Now |
| :--- | :--- | :--- |
| merge gate (`ingress.ts`) | `commit_sha: 'merged'` | the SHA GitHub returns from `PUT /pulls/:n/merge`, or omitted |
| `/deploy-action` (`ingress.ts`) | `commit_sha: 'pending'` at PR-open | the branch commit SHA from `PUT /contents` |
| `/deploy-action` (`ingress.ts`) | `Verification: All automated tests passed cleanly.` | names the PR and merge commit; points at CI for verification |

Neither service runs the test suite; the note claimed it did, on a
customer-visible ticket. `realCommitSha()` in the dispatcher now enforces the
contract for every caller — anything that is not 7–40 hex characters becomes
`null` rather than being echoed to an operator as a commit id.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/github_bridge.ts` | 150–191 | `commitGeneratedCode()` returns `Promise<string \| null>` (the created commit SHA). |
| `edge-coder-worker/src/github_bridge.ts` | 221–262 | `mergePullRequest()` returns `Promise<{ sha: string \| null }>`. |
| `edge-coder-worker/src/callback_dispatcher.ts` | 98–109 | `realCommitSha()` placeholder/format gate. |
| `edge-coder-worker/src/ingress.ts` | 1418–1421, 1886 | Merge call sites capture the SHA. |
| `edge-coder-worker/src/ingress.ts` | 1888–1918 | Inline relay + inline DLQ write + fabricated note replaced by one dispatcher call. |
| `edge-coder-worker/src/ingress.ts` | 610–633 | Dead `postSignedRelay()` wrapper removed (no callers after the consolidation). |

### 3. P1 — an operator-approved merge never resolved its ticket

The HITL gate merged the PR and then sent a `PATCH_READY` notice — the same 404
route as §1 — and nothing else. The ticket stayed in `Review-Patch-Pending`
until a human closed it, while the `/deploy-action` path did resolve. Both merge
paths now post `resolve-from-coder` with the merge SHA.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 1436–1462 | Gate posts the resolution callback on merge, warns with the DLQ key when it fails, and no longer fires an asguard notice at a route that does not exist. |

### 4. P1 — hardware-as-code validators rejected valid work and skipped invalid work

| Defect | Evidence | Fix |
| :--- | :--- | :--- |
| A declaration-only C++ header was rejected for having `#include`. | `validatePlatformIoFirmware()` required `#include` for every translation unit, so `#pragma once` + a struct failed, burned the one-shot retry and dead-ended the task. | Headers (`.h`/`.hpp`/`.hh`) now require an include guard (`#pragma once` or `#ifndef`/`#define`); the `#include` rule applies to `.cpp`/`.cc`/`.ino` only. |
| Every class-inherited MJCF joint was rejected. | MJCF puts `range`/`axis` on `<default class="…"><joint …/></default>` and omits them on the joints that inherit. The validator read only the joint's own attributes. | `mjcfDefaultJointTemplates()` walks `<default>` blocks in document order (nesting-aware) and resolves `own attrs → class template → unnamed template`; template joints are excluded from validation, since a template carries no `name`. |
| `.usda` was advertised by the cockpit and validated by nobody. | `RUNTIME_EXPECTED_EXTENSIONS['FreeCAD / OpenUSD']` lists `.usd`/`.usda`; `validateCodeSyntax()` had no branch for either, so any text passed. | New `validateUsdStage()`: `#usda 1.0` header, balanced prim scopes (strings/comments stripped first), at least one `def`. `.usd` is left unjudged — it may be binary crate data. |
| `.hpp`/`.hh`/`.cc` were not recognised as hardware-as-code. | `isHardwareAsCodeFile()` and the `isEmbeddedCpp` router list omitted them, so those files skipped the include-guard gate and fell through as "valid". | Both lists extended; dashboard extension table extended to match. |

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/code_generator.ts` | 229–265 | `validateUsdStage()`. |
| `edge-coder-worker/src/code_generator.ts` | 334–388 | `mjcfDefaultJointTemplates()` (document-order `<default>` walk). |
| `edge-coder-worker/src/code_generator.ts` | 420–440 | MJCF joint scan uses templates, skips `<default>` bodies. |
| `edge-coder-worker/src/code_generator.ts` | 481–530 | `validatePlatformIoFirmware()` header/include-guard split. |
| `edge-coder-worker/src/code_generator.ts` | 562–590 | `isHardwareAsCodeFile()` covers `.cc`, `.hpp`, `.hh`, `.usd`, `.usda`. |
| `edge-coder-worker/src/code_generator.ts` | 600–610, 691–693 | `.usda` routed to `validateUsdStage()`; `.hpp`/`.hh` routed to the C++ validator. |
| `src/lib/fleetRegistry.js` | 81–89 | C++ runtimes advertise `.cc`/`.hpp`/`.hh`. |
| `src/lib/fleetRegistry.test.js` | 123–145 | Parity test: every HAC extension the terminal advertises must be one the worker classifies. |

### 5. Fleet registry verification

Every entry in `edge-coder-worker/src/registry.ts` was resolved against the live
API rather than trusted:

```
$ for r in <each registry repo>; do gh api repos/JimEllars/$r --jq '.name + " | " + .default_branch'; done
axim-core-v1.2                                                 axim-core-v1.2 | main
AXiM-Support-System-1.1-4538                                   AXiM-Support-System-1.1-4538 | main
SpeedReport.org-Speed-Test-App-9642                            SpeedReport.org-Speed-Test-App-9642 | main
onyx_mk3                                                       onyx_mk3 | main
ELLARS.us.com-Frontend-Site-1.1-1974                           ELLARS.us.com-Frontend-Site-1.1-1974 | main
Decentralized-Demand-Letter-Generator-Development-8155         … | main
AXiM-Academy-App-1-188                                         AXiM-Academy-App-1-188 | main
AXiM-Web3-Frontend-Development-7312                            AXiM-Web3-Frontend-Development-7312 | main
AXiM-Asguard-System-App-1                                      AXiM-Asguard-System-App-1 | main
AXiM-Coding-Lab-Architecture-Briefing-9258                     AXiM-Coding-Lab-Architecture-Briefing-9258 | main
AXiM-Robotics-Lab-Program-4198                                 AXiM-Robotics-Lab-Program-4198 | main
```

11/11 exist under `JimEllars` on `main`, including every key the briefing lists
(`CORE`, `SUPPORT`, `SPEEDREPORT`, `ONYX`, `ROBOTICS`, `ACADEMY`, `FRONTEND`,
`ASGUARD`). No drift, no phantom entries — the parity test from Sprint 1.6 holds.

### Verification battery (run 2026-11-05, this branch)

Environment note: this host reports load average 16–21 (a concurrent `vite build`
in another workspace) on 3.9 GB with no swap. A single `npx vitest run` covering
all eight files was OOM-killed mid-report, and one worker RPC timed out at 60 s
while loading `render-smoke`. The suite was therefore run with
`--maxWorkers=1` in two groups; nothing about the code or config changes, and CI
(7 GB, idle runner) runs the single-command form quoted after them.

```
$ npm run lint
> quest-react-starter@0.0.0 lint
> eslint .

(no output — 0 errors, 0 warnings)

$ npx vitest run src --maxWorkers=1 --reporter=dot   # dashboard half
 ✓ src/services/supportGateway.test.js (1 test)
 ✓ src/lib/fleetRegistry.test.js (15 tests)
 ✓ src/components/render-smoke.test.jsx (20 tests)

 Test Files  3 passed (3)
      Tests  36 passed (36)

$ npx vitest run edge-coder-worker/tests --maxWorkers=1 --reporter=dot   # worker half
 ✓ tests/trust_boundary.test.ts (31 tests)
 ✓ tests/hac.test.ts (42 tests)
 ✓ tests/worker.test.ts (23 tests)
 ✓ tests/registry.test.ts (15 tests)
 ✓ tests/hardening.test.ts (54 tests)

 Test Files  5 passed (5)
      Tests  165 passed (165)

$ npm test   # canonical single command; ran green on 2026-11-05 at 05:54
 Test Files  8 passed (8)
      Tests  182 passed (182)   ← on the pre-sprint tree, config fix applied

$ npx vite build
dist/index.html                     1.16 kB │ gzip:     0.57 kB
dist/assets/index-B4hlFYPN.css  2,076.40 kB │ gzip: 1,373.56 kB
dist/assets/index-DOPNLsFy.js   1,854.27 kB │ gzip:   560.87 kB │ map: 9,188.91 kB
✓ built in 27m 21s   ← host load 16–21, not a code change; 9m16s with the box idle

$ npx wrangler deploy --dry-run --keep-vars --config edge-coder-worker/wrangler.toml
Total Upload: 142.21 KiB / gzip: 31.97 KiB
env.LAB_STATE (afc3219e3592439b8d3ae6fcb2f40004)             KV Namespace
env.TASK_LOCKS (f399b6d9a6e7425aa3cb648e742ab4b8)             KV Namespace
env.ENVIRONMENT ("production")                               Environment Variable
env.SUPABASE_URL ("https://pvbcdndqjguzqeafhwhw.supabase...") Environment Variable
env.SUPABASE_LLM_PROXY_URL (…)                               Environment Variable
--dry-run: exiting now.
```

Test counts, base → this branch: dashboard 182 → 201 total files-worth
(`src` 36, worker 165) with `hac.test.ts` 30 → 42 and `hardening.test.ts` 48 →
54; `fleetRegistry.test.js` 14 → 15. Worker bundle 133.98 KiB → 142.21 KiB
(+8.2 KiB: the rewritten dispatcher, the USD validator and the MJCF template
resolver).

### Open work reviewed this run

- `#149` (undici + wrangler) — green on its own, left for a coordinated merge
  with the toolchain upgrade; not bundled into this sprint.
- `#130`, `#131`, `#150` — still red for the peer-dependency reason recorded on
  2026-11-04 (`vitest@5` needs `vite ≥ 6.4`; `plugin-react@4` refuses `vite@8`).
  Unchanged by this sprint, deliberately.
- Local branches `feat/coding-lab-sprint-1.4-…` and `…-1.5-…` remain merged
  history; remote `…-1.5-` and `…-1.6-` branches were deleted upstream after
  merge.
- `git status --porcelain` reports only this sprint's files; no scratch scripts,
  patch dumps or build artifacts are untracked (`dist/` and `node_modules/` are
  ignored).

---

## 2026-11-04 — Sprint 1.6: cockpit render integrity, render-test harness, wider PHP2Shell screen

Branch `feat/coding-lab-sprint-1.6-cockpit-render-integrity`.
Base `ec1e84d` (origin/main). Upstream audit: `git log origin/main --since="24 hours ago"`
returned exactly one commit — `ec1e84d feat(coder): authenticate the HITL merge gate,
unify leases, kill fabricated telemetry (#154)` — and no open human-authored PRs.
Open PRs were four Dependabot branches only (#130, #131, #149, #150); see
"Open work" below.

Baseline on the base commit was green, so the repair gate was not triggered:
`npm run lint` clean, `npx vitest run` 130 passed (6 files), `npx vite build`
built, worker suite 129 passed, `wrangler deploy --dry-run` bundled.

### 1. P0 — the cockpit could not render at all: `PromptTerminal` TDZ `ReferenceError`

`src/components/PromptTerminal.jsx` declared `targetRepo`/`targetFiles` *after*
the file-preview `useEffect` whose dependency array reads them. A `const` in its
temporal dead zone throws when read during render, so the first mount raised
`ReferenceError: Cannot access 'targetFiles' before initialization`. The
component sits inside `Cockpit`, which is inside the layout's
`<ErrorBoundary><Outlet /></ErrorBoundary>`, so the whole cockpit content area
was replaced by "[SYSTEM_ANOMALY] Component Render Interrupted" — **no operator
could dispatch a task from the dashboard.**

Nothing in CI could see it: `vite build` only parses and bundles, and the repo
had zero React tests. Verified before the fix with a throwaway SSR render:

```
FAIL src/components/scratch_smoke.test.jsx > renders without throwing
AssertionError: expected [Function] to not throw an error but
  'ReferenceError: Cannot access \'targetFiles\' before initialization' was thrown.
```

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/components/PromptTerminal.jsx` | 23–53 | All `useState` declarations moved above the first effect, grouped under a `// ---- State` banner. |
| `src/components/PromptTerminal.jsx` | 55–64 | New `// ---- Derived` block: `previewCoordinates`, `selectedRepoName`, `targetFilePaths`, `runtimeMismatches`. |
| `src/components/PromptTerminal.jsx` | 66–152 | `// ---- Effects` block. Duplicate `sessionStorage` effect for `prompt` removed; ordering comments retained. |

### 2. P0 — `Telemetry` page: same defect, `timeWindow`

`src/pages/Telemetry.jsx` declared `const [timeWindow, setTimeWindow]` nine lines
*below* an effect that lists `timeWindow` in its dependency array. Same
`ReferenceError`, same blanked page.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/pages/Telemetry.jsx` | 9–26 | State block hoisted above the agent-count effect; effect order preserved. |

### 3. P1 — a render smoke suite, so this class of bug cannot merge again

The repo had no React test. Added `jsdom` (dev-only) and a mount suite covering
every routed page and shared component.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/components/render-smoke.test.jsx` | 1–112 (new) | 20 cases: `@vitest-environment jsdom`, `createRoot` + `act`, `MemoryRouter`, stubbed `fetch`, per-case `props` / `allowsEmptyRender`, 120 s timeout. Asserts no throw and non-empty DOM. |
| `src/test/domShims.js` | 1–23 (new) | `Element.prototype.scrollTo` / `scrollIntoView` no-ops. Without them `SwarmLogConsole`'s `requestAnimationFrame` scroll throws after the test ends and Vitest fails the run on an unhandled error. |
| `package.json` | 40 | `jsdom ^30.1.3` devDependency. |
| `eslint.config.js` | 12 | `ecmaVersion` 2020 → 2022 (numeric separators, optional chaining in test files). |
| `eslint.config.js` | 36–44 | `no-use-before-define` (`variables: true`, `functions: false`) — the static half of the guard. |

Four pre-existing `no-use-before-define` hits were hoisted so the rule could be
enabled at zero-tolerance rather than diluted:

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/pages/Cockpit.jsx` | 12–20 | State block (incl. `supportProxyHealth`) moved above the first effect. |
| `src/components/layout/DashboardLayout.jsx` | 150–158 | `updateLockCount` declared before `fetchTasks`. |
| `src/pages/AgentRegistry.jsx` | 22–46 | `updateAgentStatus` declared before `fetchTasks`. |
| `src/services/labService.js` | 245–265 | `startPolling` declared before `startStream` (only reachable from its error path). |

### 4. P1 — fleet registry drift between dashboard and worker

`labService.js` carried an inline `STATIC_REGISTRY` literal that had drifted from
the worker's authoritative `edge-coder-worker/src/registry.ts`:

| Key | Dashboard (before) | Worker (authority) | Result |
| :--- | :--- | :--- | :--- |
| `ROBOTICS` | `axim-robotics-lab` | `AXiM-Robotics-Lab-Program-4198` | `GET /repos/JimEllars/axim-robotics-lab` → **404**; phantom repository in the fleet list. |
| `ASGUARD` | `axim-asguard-system-app-1` | `AXiM-Asguard-System-App-1` | Resolves case-insensitively via the API, but not for `raw.githubusercontent.com` previews or audit forensics. |

Both were confirmed against the live API (`gh api repos/JimEllars/<name>`; the
robotics slug returned `404 Not Found`).

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/lib/fleetRegistry.js` | 1–106 (new) | `FLEET_REGISTRY` (11 entries, canonical spelling), `resolveFleetCoordinates()`, `RUNTIME_EXPECTED_EXTENSIONS`, `findRuntimeMismatches()`. |
| `src/lib/fleetRegistry.test.js` | 1–120 (new) | Imports the worker's `AXiM_ECOSYSTEM_REGISTRY` and asserts key parity, per-key repo/owner/branch equality, case-exact repo names, plus resolver and runtime-mismatch behaviour. 14 tests. |
| `src/services/labService.js` | 6 | Imports `FLEET_REGISTRY`. |
| `src/services/labService.js` | 657–659 | 1,758-character inline literal replaced with the shared table. |

### 5. P1 — file preview asked for a repository that does not exist

The preview effect computed a `repoName` alias from the project key and then
never used it, sending `targetRepo.split('/')[0]` as the **owner**. For a
key-selected project (`CORE`) it requested `raw.githubusercontent.com/CORE/CORE/...`;
the default `targetRepo` was `JimEllars/axim-core-api`, also a 404. The repo
`<select>` was bound to `targetRepo` while its options are bare repo names, so a
`owner/repo` slug from the cockpit left the dropdown blank.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/components/PromptTerminal.jsx` | 76–110 | Preview resolves `resolveFleetCoordinates(targetRepo)` → `fetchFilePreview(owner, repo, path, defaultBranch)`. Dead alias block and the `// Use default owner "axim-dev"` comment removed. |
| `src/components/PromptTerminal.jsx` | 41 | Default target repo `JimEllars/axim-core-api` → `FLEET_REGISTRY.CORE.repo`. |
| `src/components/PromptTerminal.jsx` | 317–322 | `<select value={selectedRepoName}>` so a slug or key still matches an option. |
| `src/components/PromptTerminal.jsx` | 185–192 | Dispatch payload uses `previewCoordinates.repo` / `targetFilePaths` (was `targetRepo` / an inline re-split). |

### 6. P2 — runtime/file-path mismatch hint (hardware-as-code coupling)

`validateCodeSyntax()` routes on the file extension, so `MuJoCo / URDF` +
`src/app.ts` burns an LLM run and then fails `[AST_CHECK]`. The terminal now
warns before dispatch, using the same extension table.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/components/PromptTerminal.jsx` | 362–379 | Amber `RUNTIME/PATH MISMATCH` hint under the File Path field; border colour follows. Advisory only — the worker remains the authority. |

### 7. P2 — `RepositoryDetail` rendered a blank page

`if (!repo) return null` covered both "still loading" and "unknown id", and
`getRepositories()` returns `[]` on a Supabase error, so the route could stay
empty forever with no recovery affordance.

| File | Lines | Change |
| :--- | :--- | :--- |
| `src/pages/RepositoryDetail.jsx` | 63–92 | Explicit not-found/empty panel naming the id, with **Back to repositories** and **Open cockpit** actions. |

### 8. P1 — PHP2Shell screen defeated by encodings

`CGI_INJECTION_PATTERN` matched the literal `?-d` and `PATH_PROBE_PATTERN` matched
`%2e%2e` only, against the raw target. `?%2Dd`, `..%5C`, `shell%00.jpg`,
`php://filter` and double-encoded `%252e%252e` all passed the screen.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 68–84 | Patterns widened; added `PHP_STREAM_WRAPPER_PATTERN`; query-parameter argument injection generalised from `?-d` to `[?&;]-[a-z]` (CVE-2012-1823 / CVE-2024-4577 family). |
| `edge-coder-worker/src/ingress.ts` | 86–105 | `decodeForScreening()` — two guarded `decodeURIComponent` passes; survives malformed sequences such as `?f=100%`. |
| `edge-coder-worker/src/ingress.ts` | 107–140 | `screenHostileUrl()` evaluates CGI, wrapper and path rules against raw **and** decoded query/path. |
| `edge-coder-worker/tests/hardening.test.ts` | 5 | Imports `decodeForScreening`. |
| `edge-coder-worker/tests/hardening.test.ts` | 45–110 | 12 new hostile cases, 6 benign-traffic cases (the dashboard's own routes), and a decode unit test. |

### Verification battery (run 2026-11-04, this branch)

Environment note: this workspace exports `NODE_ENV=production`, which makes
`npm install`/`npm ci` silently omit every devDependency. Use
`NODE_ENV=development npm ci`.

```
$ npm run lint
> quest-react-starter@0.0.0 lint
> eslint .

(no output — 0 errors, 0 warnings)

$ npx vitest run
 ✓ edge-coder-worker/tests/trust_boundary.test.ts (31 tests)
 ✓ edge-coder-worker/tests/hardening.test.ts (48 tests)
 ✓ edge-coder-worker/tests/hac.test.ts (30 tests)
 ✓ edge-coder-worker/tests/worker.test.ts (23 tests)
 ✓ src/lib/fleetRegistry.test.js (14 tests)
 ✓ edge-coder-worker/tests/registry.test.ts (15 tests)
 ✓ src/services/supportGateway.test.js (1 test)
 ✓ src/components/render-smoke.test.jsx (20 tests)

 Test Files  8 passed (8)
      Tests  182 passed (182)

$ npx vite build
dist/index.html                     1.16 kB │ gzip:     0.57 kB
dist/assets/index-B4hlFYPN.css  2,076.40 kB │ gzip: 1,373.56 kB
dist/assets/index-58HlIzTS.js   2,211.95 kB │ gzip:   642.11 kB │ map: 10,613.69 kB
✓ built in 12m 12s

$ cd edge-coder-worker && npx vitest run tests
 Test Files  5 passed (5)
      Tests  147 passed (147)

$ npx wrangler deploy --dry-run --keep-vars --config wrangler.toml
Total Upload: 132.92 KiB / gzip: 29.58 KiB
env.LAB_STATE (afc3219e3592439b8d3ae6fcb2f40004)            KV Namespace
env.TASK_LOCKS (f399b6d9a6e7425aa3cb648e742ab4b8)            KV Namespace
env.ENVIRONMENT ("production")                              Environment Variable
env.SUPABASE_URL ("https://pvbcdndqjguzqeafhwhw.supabase...") Environment Variable
env.SUPABASE_LLM_PROXY_URL (...)                            Environment Variable
--dry-run: exiting now.
```

Delta vs. the base commit: `npx vitest run` 130 → 182 tests (6 → 8 files);
worker suite 129 → 147.

### Open work reviewed this run

- `feat/coding-lab-sprint-1.4-build-repair-and-v2-interlock` and
  `feat/coding-lab-sprint-1.5-hitl-trust-boundary` are both fully merged
  (`git cherry origin/main <branch>` reports `-` for every commit); left in place
  as local history, nothing to button up.
- `#149` (undici + wrangler) is green and mergeable on its own.
- `#130`, `#131`, `#150` are all red for one reason: `vitest@5` peer-requires
  `vite@^6.4||^7||^8`, while the root project pins `vite@^5.4.2` and
  `@vitejs/plugin-react@^4.3.1` (peer `vite <= 7`). They cannot go green
  individually. Deferred as a single coordinated upgrade — see
  `DEBUGGING_NOTES.md`.
- No scratch files, patch scripts or build artifacts were left untracked
  (`git status --porcelain` reports only this sprint's files).

---

## 2026-11-03 — Sprint 1.5: approval-gate trust boundary, session credentials, lease unification

Branch `feat/coding-lab-sprint-1.5-hitl-trust-boundary`.
Base `c0b8c7b` (origin/main). No human commits in the previous 24h; the only
upstream movement was two Dependabot patches (#152, #153).

Baseline on the base commit was green, so no repair gate was triggered:
`npm run lint` clean, `npx vitest run` 94 passed, `npx vite build` built,
worker suite 93 passed, `wrangler deploy --dry-run` bundled.

### 1. P0 — `GET /api/v1/pr/action` merged pull requests without authentication

`readApprovalRecord()` replaces the old `token in KV !== 'consumed'` test. The
old check let *any* unminted token through, and the merge target came from
`url.searchParams`, so `?token=x&decision=merge&owner=…&repo=…&pr=N` merged an
arbitrary PR with the worker's GitHub token.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 168–208 | `PrApprovalRecord`, `mintApprovalToken()` — tokens are bound to one `owner/repo/pr` at mint time. |
| `edge-coder-worker/src/ingress.ts` | 209–330 | `escapeHtml()`, `renderGatePage()`, `readApprovalRecord()` — unknown/expired token → 403, consumed → 409, unbound → 409. |
| `edge-coder-worker/src/ingress.ts` | 1322–1416 | Handler: GET renders confirmation only; POST consumes the token then merges the *stored* coordinates. Owner pinned via `resolveRepoMetadata`. Token restored if GitHub refuses the merge. |

### 2. P0 — DLQ sweep could not accept a v2 envelope

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 829–890 | `handleDlqSweepRequest()` — operator session **or** `verifyInternalRelay()` (v2 + logged v1 fallback); missing `CODER_DLQ_KV` answers `skipped` instead of 500. |
| `edge-coder-worker/src/ingress.ts` | 1607–1612 | Route matched before the zero-trust block so a session is enough. |

### 3. P1 — task leases meant three different things

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/locks.ts` | 1–103 | New module: `acquireTaskLock`, `releaseTaskLock`, `recordOpenPullRequest`, `readOpenPullRequest`, `clearTaskState`. Any value at `lock:<id>` is busy. |
| `edge-coder-worker/src/ingress.ts` | 1748–1770 | `/api/v1/ingress` uses `acquireTaskLock`; refusals carry `reason` and `pr_url`. |
| `edge-coder-worker/src/ingress.ts` | 1764–1780 | `/api/v1/tasks/dispatch` uses the same helper (`in_progress` still written for dashboard readability). |
| `edge-coder-worker/src/code_generator.ts` | 697–702 | On success: `recordOpenPullRequest()` writes `pr-open:<taskId>` and releases the lease. |
| `edge-coder-worker/src/code_generator.ts` | 706–712 | `finally` releases via the helper. |
| `edge-coder-worker/src/ingress.ts` | 1738–1748 | `deploy-action` `REJECTED` clears both keys. |
| `edge-coder-worker/src/ingress.ts` | 1573–1585 | `force-unlock` keeps the PR marker unless `clear_pr: true`. |
| `edge-coder-worker/src/ingress.ts` | 1857–1859 | GitHub `pull_request.closed` clears both keys. |

### 4. P1 — queue send failures stranded the task

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 606–648 | `enqueueSwarmTask()` — no binding, oversized payload (>128 KiB) or a throwing `send()` all return `false`. |
| `edge-coder-worker/src/ingress.ts` | 649–680 | `consumeSwarmQueue()` — acks on success, retries on failure. Exported as `queue()` in the default export. |
| `edge-coder-worker/src/ingress.ts` | 1958–1980 | `/api/v1/ingress` falls back to `ctx.waitUntil(executeCodingPipeline(...))` with `transport: "inline"`. |
| `edge-coder-worker/wrangler.toml` | 12–27 | Producer/consumer binding guidance. |

### 5. P1 — telemetry and briefing authenticity

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 1013–1070 | `edge-metrics`: measured DLQ depth and telemetry count, `null` for unmeasurable values, `Date.now() - startTime` latency, `metricsSource`, `sampledAt`. |
| `edge-coder-worker/src/ingress.ts` | 1072–1120 | `telemetry/stats`: binding guards, `average_latency` over finite samples only, no fabricated heap. |
| `edge-coder-worker/src/ingress.ts` | 423–560 | `collectOpenPullRequests()` + rewritten `handleDailyExecutiveBriefing()` — real counts, `n/a` when unreadable, real PR approval links. |
| `edge-coder-worker/src/ingress.ts` | 375–392 | `logUnauthorizedAttempt()` writes `error_message`. |

### 6. P1 — dead console endpoints and browser-held keys

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 727–820 | `handleGithubTreeRequest()` / `handleDlqStatsRequest()` extracted and matched before the POST-only guard (they were unreachable, so the dashboard always saw 405). Owner pinned to `JimEllars`. |
| `edge-coder-worker/src/ingress.ts` | 1418–1432 | Read-only console routes matched before `request.method !== 'POST'`. |
| `edge-coder-worker/src/ingress.ts` | 1631–1680 | Zero-trust block: relay signature **or** verified operator session; a present-but-invalid signature is still 403 with no downgrade. |
| `src/services/labService.js` | 484–560 | `triggerTask` sends the session bearer only. |
| `src/services/labService.js` | 428–455 | `scaffoldProject` sends the session bearer only. |
| `src/services/labService.js` | 890–900 | `fetchRepositoryTree` sends the session bearer. |
| `src/services/labService.js` | 944–975 | `fetchDlqStats` and `triggerDlqSweep` send the session bearer. |

### 7. P1 — PHP sink coverage

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/code_generator.ts` | 164–215 | Request-input-gated rejection of `include`/`require`, dynamic dispatch and deserialization sinks, backtick execution and `$$` indirection. |
| `edge-coder-worker/tests/worker.test.ts` | 63–88 | Five new cases, including two that must stay `safe: true` (ordinary superglobal read, JS template literal). |

### Verification battery (verbatim, this branch)

```
$ npm run lint
> quest-react-starter@0.0.0 lint
> eslint .
(no output — 0 errors, 0 warnings)

$ npx vitest run
 ✓ src/services/supportGateway.test.js (1 test) 320ms
 ✓ edge-coder-worker/tests/trust_boundary.test.ts (31 tests)
 ✓ edge-coder-worker/tests/hardening.test.ts (30 tests)
 ✓ edge-coder-worker/tests/hac.test.ts (30 tests)
 ✓ edge-coder-worker/tests/worker.test.ts (23 tests)
 ✓ edge-coder-worker/tests/registry.test.ts (15 tests)
 Test Files  6 passed (6)
      Tests  130 passed (130)

$ npm run build
dist/index.html                     1.16 kB │ gzip:     0.57 kB
dist/assets/index-B_aKVMxT.css  2,075.80 kB │ gzip: 1,373.44 kB
dist/assets/index-DfSKrvj8.js   1,852.93 kB │ gzip:   560.24 kB │ map: 9,179.76 kB
✓ built in 12m 29s

$ cd edge-coder-worker && npx vitest run
 Test Files  5 passed (5)
      Tests  129 passed (129)

$ cd edge-coder-worker && npx wrangler deploy --dry-run --keep-vars --config wrangler.toml
Total Upload: 132.92 KiB / gzip: 29.58 KiB
--dry-run: exiting now.
```

Test deltas: worker 93 → 129 (+36: 31 in `trust_boundary.test.ts`, 5 in
`worker.test.ts`). Root 94 → 130.

---

## 2026-11-02 — Sprint 1.4: build repair, hardware-as-code gates, v2 interlock

Branch `feat/coding-lab-sprint-1.4-build-repair-and-v2-interlock`.
Base `851c236` (origin/main). No human commits landed in the previous 24h.

### 1. P0 — `main` did not bundle (regression from the #147/#148 double merge)

`npx wrangler deploy --dry-run --config edge-coder-worker/wrangler.toml` on the
base commit:

```
✘ [ERROR] The symbol "suspiciousPhpPattern" has already been declared
    src/ingress.ts:320:10
    The symbol "suspiciousPhpPattern" was originally declared here: src/ingress.ts:287:10
✘ [ERROR] The symbol "pathTraversalPattern" has already been declared
    src/ingress.ts:325:10
    The symbol "pathTraversalPattern" was originally declared here: src/ingress.ts:295:10
EXIT=1
```

Two sprint branches each added the PHP2Shell guard to `fetch()` and the merge
kept both copies. `const url` was declared twice as well. The suite stayed green
because `tests/hardening.test.ts` re-implemented the regexes instead of calling
the worker.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 53–89 | Extracted `CGI_INJECTION_PATTERN`, `PATH_PROBE_PATTERN` and `screenHostileUrl()`; single guard, runs before env validation and routing, and also screens the query string for LFI traversal. |
| `edge-coder-worker/src/ingress.ts` | 491–520 | `fetch()` split into a thin wrapper plus `handleRequest()`; the duplicate `url`/pattern declarations are gone. |

### 2. P0 — the runbook's worker commands could not run

`edge-coder-worker/` shipped an empty `package-lock.json` (`"packages": {}`) and
no `package.json`, so `cd edge-coder-worker && npm test` silently resolved the
root project.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/package.json` | 1–18 | New: `test`, `test:watch`, `deploy`, `deploy:dry-run`, `tail`. Uses the repo-root toolchain (single `npm ci`), documented in the README. |
| `edge-coder-worker/package-lock.json` | deleted | Stale empty lockfile that made `npm ci` inside the worker resolve nothing. |

### 3. P0 — tests asserted a copy of the code, not the code

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/tests/hardening.test.ts` | 1–355 | Rewritten to import the real default export and call `worker.fetch()`. 30 tests: 10 hostile-URL cases (403), CORS/preflight, `healthz`, trace headers, missing/tampered/stale signatures, v2 + legacy v1 acceptance, internal-key bearer, Support dispatch interlock, 404 routing, telemetry beacon, and the deploy-action → `resolve-from-coder` callback. |
| `edge-coder-worker/tests/mock_worker_env.ts` | 1–157 | New: `MockKV` with real `KVNamespace` semantics, `createMockEnv()`, `createMockCtx()`, v2/legacy signers, and `installFetchStub()` so suites are hermetic and outbound envelopes are assertable. |

### 4. Security — Supabase session tokens were never verified

`verifySupabaseToken()` base64-decoded the JWT payload and trusted the `email`
claim, so any caller could mint `{"email":"james.ellars@axim.us.com"}` and drive
the pipeline.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/utils/crypto.ts` | 131–146 | `constantTimeEqual()` — the internal-key bypass is compared without short-circuiting. |
| `edge-coder-worker/src/ingress.ts` | 152–249 | Tokens are now validated against `GET ${SUPABASE_URL}/auth/v1/user` (catches forged, expired and revoked sessions), cached per token fingerprint for 60s with a bounded cache. Internal-key bypass retained; rejections still logged to `coding_tasks_errors`. |

### 5. Zero-trust relay — v2 signatures (`X-Axim-Timestamp`)

The Support System verifies `HMAC_SHA256("<unix_seconds>.<body>")` and stops
honouring body-only signatures after `AXIM_SIG_LEGACY_UNTIL` (default
**2026-12-31**). The Coding Lab signed v1 only, so every resolution callback
would start failing in 58 days and fill the DLQ.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/utils/crypto.ts` | 1–130 | New shared module: `generateHmacSignature`, `generateSignedEnvelope`, `signedHeaders`, `verifyInternalSignature` (v2 window ±300s, v1 fallback with reason codes). |
| `edge-coder-worker/src/ingress.ts` | 127–150 | `verifyInternalRelay()` — inbound accepts v2 first, falls back to v1 and logs every legacy acceptance. |
| `edge-coder-worker/src/ingress.ts` | 319–340 | `postSignedRelay()` / `postSignedRelayRaw()` — single outbound signer. |
| `edge-coder-worker/src/ingress.ts` | 1249–1275 | Deploy-action resolution callback now posts a v2 envelope to `POST /api/v1/tickets/:id/resolve-from-coder`. |

### 6. Support interlock — removing the 404 generators

`callback_dispatcher.ts` posted `PATCH_READY` to
`https://support.axim.us.com/api/v1/tickets/:id/patch-status`, and
`/api/v1/dlq/sweep` replayed every entry to `/api/v1/axim-resolution`. Neither
route exists in `JimEllars/AXiM-Support-System-1.1-4538` (checked
`onyx-edge-worker/src/index.ts`); the only coder-facing route is
`resolve-from-coder`. Those 404s are what the DLQ was collecting.

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 358–388 | `replayDlqEntry()` — one replay routine for cron and manual sweep; ticket callbacks are re-signed with a fresh v2 envelope on every attempt, email entries go through `sendEmailItMessage`, unrecognised keys are evicted with a warning instead of accumulating. |
| `edge-coder-worker/src/ingress.ts` | 389–415 | `handleDlqSweeper()` rewritten on top of `replayDlqEntry()`; deletes empty keys. |
| `edge-coder-worker/src/ingress.ts` | 1290–1330 | `/api/v1/dlq/sweep` uses the same replay routine and reports `{ reprocessed, remaining }`. |
| `edge-coder-worker/src/ingress.ts` | 1503–1520 | Removed the duplicated HMAC re-verification in `/api/v1/projects/scaffold` and `/api/v1/tasks/dispatch`; the zero-trust block already proves the body. |

### 7. Fleet registry accuracy

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/registry.ts` | 1–95 | `ROBOTICS` pointed at `axim-robotics-lab`, which returns **404** (verified against the GitHub API); corrected to `AXiM-Robotics-Lab-Program-4198`. `ASGUARD` corrected to canonical casing `AXiM-Asguard-System-App-1`. |
| `edge-coder-worker/src/registry.ts` | 39–95 | `resolveRepoMetadata()` now parses `owner/repo` slugs. The dashboard sends `repository_name: "JimEllars/axim-core-v1.2"`, which used to build `repos/JimEllars/JimEllars/axim-core-v1.2`; the owner is also pinned to `JimEllars` with a warning when a non-canonical owner is supplied. |
| `edge-coder-worker/tests/registry.test.ts` | 1–103 | New: required fleet membership, canonical owner, no placeholder orgs, slug parsing, owner coercion, fallbacks. |

### 8. Hardware-as-Code gates

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/code_generator.ts` | 205–268 | `validateFreeCadScript()` — requires a geometry import, rejects dimension-less primitives (`Part.makeBox()`), requires `addGeometry`/`addConstraint` when Sketcher is used, and requires show/recompute/export so a script cannot pass by defining dead functions. |
| `edge-coder-worker/src/code_generator.ts` | 270–368 | `validateMuJoCoModel()` — real XML tag-stack balance (comments/CDATA/self-closing aware), MuJoCo: `<mujoco>` root, joint `name`, `range="min max"` + 3-component `axis` on hinge/slide, positive `<inertial mass>` with `pos`. URDF: `<robot name>`, link+joint, `<limit lower upper>` on revolute/prismatic, `<inertial><mass value>` present and positive. |
| `edge-coder-worker/src/code_generator.ts` | 370–410 | `validatePlatformIoConfig()` (`[env:]`, `board`, `platform`, `framework`) and `validatePlatformIoFirmware()` (`#include`, `void setup()`, `void loop()`, `<Arduino.h>` for `.ino`). |
| `edge-coder-worker/src/code_generator.ts` | 432–600 | `validateCodeSyntax()` routes `.py/.xml/.mjcf/.urdf/.ino/.cpp/.h/.ini` to the new validators; the previous MuJoCo branch computed `openTags`/`closeTags`/`selfClosingTags` and never used them. |
| `edge-coder-worker/src/code_generator.ts` | 636–652 | The pipeline now re-validates the retry output (a second bad generation used to reach Git) and runs `sanitizeVulnerabilityVectors()` for **every** origin, not only `Asguard_WAF`. |
| `edge-coder-worker/src/code_generator.ts` | 195 | `while (true)` robot-loop detection repaired — the old `\b` after `\)` could never match. |
| `src/components/PromptTerminal.jsx` | 6–17, 329–337 | `RUNTIME_FILE_HINTS` plus `PlatformIO Firmware` and `MuJoCo / URDF` selectors so the operator can request the file types the validators classify. |

### 9. Routing hygiene

| File | Lines | Change |
| :--- | :--- | :--- |
| `edge-coder-worker/src/ingress.ts` | 1528–1545 | Unknown paths now return `404 {"error":"Not Found"}`. The task-payload `try` block was unconditional, so a typo'd route was parsed as a coding task and returned 500. |
| `edge-coder-worker/src/ingress.ts` | 454–489 | Trace headers (`X-Edge-Ray-Id`, `X-Edge-Colo`, `X-Response-Time-Ms`) and the access log now wrap every response, including hostile-traffic and preflight returns that previously skipped them. |
| `edge-coder-worker/src/ingress.ts` | 54 | `Access-Control-Allow-Headers` now advertises `X-Axim-Timestamp`. |

### 10. CI

`.github/workflows/ci.yml` (new, 65 lines) — `dashboard` job (`npm ci`, `npm run
lint`, `npx vitest run`, `npx vite build`) and `worker` job (`npx vitest run
edge-coder-worker/tests`, `wrangler deploy --dry-run`). The repository had no
workflows at all, which is why the bundle regression above merged to `main`.

---

## Verification battery (run 2026-11-02, this branch)

```
$ npm run lint
> quest-react-starter@0.0.0 lint
> eslint .
EXIT=0
```

```
$ npx vitest run          # repo root
 ✓ edge-coder-worker/tests/hardening.test.ts (30 tests)
 ✓ edge-coder-worker/tests/hac.test.ts (30 tests)
 ✓ edge-coder-worker/tests/worker.test.ts (18 tests)
 ✓ edge-coder-worker/tests/registry.test.ts (15 tests)
 ✓ src/services/supportGateway.test.js (1 test)

 Test Files  5 passed (5)
      Tests  94 passed (94)
EXIT=0
```

```
$ cd edge-coder-worker && npm test
 ✓ tests/hardening.test.ts (30 tests)
 ✓ tests/hac.test.ts (30 tests)
 ✓ tests/registry.test.ts (15 tests)
 ✓ tests/worker.test.ts (18 tests)

 Test Files  4 passed (4)
      Tests  93 passed (93)
EXIT=0
```

```
$ npx wrangler deploy --dry-run --keep-vars --config edge-coder-worker/wrangler.toml
 ⛅️ wrangler 4.111.0
Total Upload: 120.83 KiB / gzip: 26.49 KiB
Your Worker has access to the following bindings:
env.LAB_STATE (afc3219e3592439b8d3ae6fcb2f40004)   KV Namespace
env.TASK_LOCKS (f399b6d9a6e7425aa3cb648e742ab4b8)  KV Namespace
env.ENVIRONMENT ("production")                     Environment Variable
env.SUPABASE_URL                                   Environment Variable
env.SUPABASE_LLM_PROXY_URL                         Environment Variable
--dry-run: exiting now.
EXIT=0
```

```
$ npm run build
vite v5.4.21 building for production...
dist/assets/index-B_aKVMxT.css  2,075.80 kB │ gzip: 1,373.44 kB
dist/assets/index-MWBU3EmJ.js   1,852.39 kB │ gzip:   560.13 kB │ map: 9,178.55 kB
✓ built in 15m
EXIT=0
```
