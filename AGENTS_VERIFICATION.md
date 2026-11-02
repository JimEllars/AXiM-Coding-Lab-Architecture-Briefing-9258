# AGENTS Verification Log

Canonical, append-only record of what the autonomous coding engine changed and
the exact commands that prove it. Newest entry first.

Companion documents:
- `VERIFICATION_APPENDIX.md` — historical table for sprints up to 1.3.
- `DEBUGGING_NOTES.md` — root causes, decisions and open debt.
- `CHANGELOG.md` — release-facing summary.

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
