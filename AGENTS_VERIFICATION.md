# AGENTS Verification Log

Canonical, append-only record of what the autonomous coding engine changed and
the exact commands that prove it. Newest entry first.

Companion documents:
- `VERIFICATION_APPENDIX.md` — historical table for sprints up to 1.3.
- `DEBUGGING_NOTES.md` — root causes, decisions and open debt.
- `CHANGELOG.md` — release-facing summary.

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
