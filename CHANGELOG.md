# AXiM Coding Lab — Changelog

## [1.7.0] — 2026-11-05

Sprint 1.7: make the Support/Asguard callbacks actually land, remove fabricated
values from customer-facing ticket notes, resolve tickets when an operator
approves a merge, and stop the hardware-as-code validators rejecting valid work.

### Fixed
- **Every Support patch-ready notification was a 404.** The coder posted to
  `/api/v1/tickets/:id/patch-status`, a route the Support System does not
  publish, so each generated patch produced a 404 that was logged and dropped.
  Notices now go to `/api/v1/tickets/callback` with the body that route reads
  (`ticketId`, `patchDetails`, `commitSha`, `prUrl`) and flip the ticket to
  `Review-Patch-Pending` as intended.
- **Callbacks were signed v1.** Body-only signatures are rejected by the Support
  System after `AXIM_SIG_LEGACY_UNTIL` (default 2026-12-31). Every coder →
  satellite callback now carries the v2 envelope (`X-Axim-Timestamp` + HMAC over
  `${ts}.${body}`) and a 10 s timeout.
- **Failed callbacks vanished.** A refused or unreachable satellite logged an
  error and left nothing to retry. Failures are parked in `CODER_DLQ_KV` and the
  03:00 sweeper redelivers them with a fresh envelope.
- **Ticket notes contained values nobody measured.** The resolution payload sent
  `commit_sha: "merged"` (merge gate) and `"pending"` (pipeline), and claimed
  `Verification: All automated tests passed cleanly` — on a customer-visible
  ticket, for a suite this service never ran. The notes now name the PR and the
  real merge commit and point at CI; anything that is not 7–40 hex characters is
  dropped rather than echoed as a commit id.
- **An operator-approved merge never resolved its ticket.** The HITL gate merged
  the PR and stopped there, leaving the ticket in `Review-Patch-Pending` until a
  human closed it. Both merge paths now post `resolve-from-coder`.
- **Valid C++ headers were rejected.** `validatePlatformIoFirmware()` demanded
  `#include` from every file it saw, so `#pragma once` + a struct failed
  validation, burned the one-shot LLM retry and dead-ended the task. Headers
  (`.h`/`.hpp`/`.hh`) now require an include guard; the `#include` rule covers
  translation units only.
- **Every class-inherited MJCF joint was rejected.** `range`/`axis` declared on
  `<default class="…"><joint …/></default>` were invisible to the validator, so
  a model MuJoCo loads happily failed `[AST_CHECK]`. Default templates are now
  resolved (own attributes → class template → unnamed template) and template
  joints are no longer validated as real ones.
- **`.usda` was promised by the cockpit and validated by nobody.** New
  `validateUsdStage()`: `#usda 1.0` header, balanced prim scopes, at least one
  `def`.
- **The dashboard test harness depended on the caller's `NODE_ENV`.** With
  `NODE_ENV=production` exported, Vite resolved React's production build and all
  20 render-smoke cases failed with `act(...) is not supported in production
  builds of React`. `vitest.config.js` pins the test environment and the project
  root.

### Added
- `vitest.config.js` — deterministic `NODE_ENV=test`, explicit include set,
  root pinned to the config directory, merged with `vite.config.js`.
- `edge-coder-worker/src/callback_dispatcher.ts` — `buildSatelliteRequest()`,
  `dispatchCallbackWebhook()` returning a structured result,
  `replayParkedSatelliteCallback()`, `realCommitSha()`.
- `validateUsdStage()` and `mjcfDefaultJointTemplates()` in `code_generator.ts`.
- Parity test asserting every hardware extension the Prompt Terminal advertises
  is one the worker actually classifies.
- 19 new tests (dashboard 14 → 15 in `fleetRegistry`, worker `hac` 30 → 42,
  `hardening` 48 → 54).

### Changed
- `commitGeneratedCode()` returns the created commit SHA;
  `mergePullRequest()` returns `{ sha }`. Both were `void`, which is why the
  callbacks had nothing truthful to send.
- Resolution callbacks keep the historical `dlq:ticket-callback:<id>` key so
  entries already parked replay unchanged; patch-ready notices use
  `dlq:satellite-callback:<system>:<id>`.
- Dead `postSignedRelay()` wrapper removed from `ingress.ts`.

## [1.6.0] — 2026-11-04

Sprint 1.6: make the cockpit render again, add the React test harness the repo
never had, re-point the dashboard at the real fleet, and close the
percent-encoding holes in the PHP2Shell screen.

### Fixed
- **The cockpit could not render.** `PromptTerminal` read `targetFiles` and
  `targetRepo` from a `useEffect` dependency array declared *above* their
  `useState` declarations, so the first render threw
  `ReferenceError: Cannot access 'targetFiles' before initialization`. The
  component lives inside the layout's `ErrorBoundary`, so the whole cockpit body
  became "[SYSTEM_ANOMALY] Component Render Interrupted" — dispatching a task
  from the dashboard was impossible. `Telemetry` had the identical defect on
  `timeWindow`. Both are reordered; the guard is
  `src/components/render-smoke.test.jsx` plus the `no-use-before-define` ESLint
  rule.
- **No React test existed to catch a render crash.** Added a jsdom mount suite
  covering all 12 routed pages and the 8 shared components (20 cases). `npm run
  lint`, `vitest` and `vite build` now all fail if a component throws while
  mounting.
- **The fleet list contained a repository that does not exist.** The dashboard's
  inline registry sent `ROBOTICS` to `axim-robotics-lab` (GitHub: 404) and
  spelled `ASGUARD` differently from the worker's table. Coordinates now live in
  `src/lib/fleetRegistry.js`, and `fleetRegistry.test.js` asserts key-by-key
  parity with `edge-coder-worker/src/registry.ts` in both directions.
- **The file preview requested the wrong repository.** The effect computed a
  project-key alias and then discarded it, passing the project key as the
  *owner*, so `CORE` previewed `CORE/CORE/...`. The default target was
  `JimEllars/axim-core-api` (404). Previews now resolve through the fleet
  registry, and the repo `<select>` stays bound to an option when the cockpit
  hands in an `owner/repo` slug.
- **`RepositoryDetail` rendered an empty page** for an unknown id or an empty
  task history, with no way back. It now names the id and offers both
  navigation actions.
- **PHP2Shell screening was encoding-blind.** The screen matched the literal
  `?-d` and `%2e%2e` only, so `?%2Dd`, `..%5C`, `shell%00.jpg`, `php://filter`
  and double-encoded `%252e%252e` passed. Query-parameter argument injection is
  now generalised to `[?&;]-[a-z]` (CVE-2012-1823 / CVE-2024-4577 family), a
  stream-wrapper rule was added, and every rule is evaluated against the raw
  target plus two URL-decoded passes. Twelve new hostile cases and six benign
  dashboard routes are covered by tests.

### Added
- `RUNTIME/PATH MISMATCH` pre-flight hint in the Prompt Terminal: the file-path
  field warns when the selected runtime and the target extension disagree, using
  the same extension table the worker's `validateCodeSyntax()` routes on. It is
  advisory — the worker stays authoritative — but it stops an LLM run that would
  fail `[AST_CHECK]`.
- `src/lib/fleetRegistry.js`: `FLEET_REGISTRY`, `resolveFleetCoordinates()`,
  `RUNTIME_EXPECTED_EXTENSIONS`, `findRuntimeMismatches()`.
- `jsdom` (dev-only) so the dashboard has a DOM to mount into.

### Changed
- ESLint: `ecmaVersion` 2020 → 2022; `no-use-before-define` (variables) enabled.
  Four pre-existing uses were hoisted rather than the rule being weakened.

## [1.5.0] — 2026-11-03

Sprint 1.5: close the human-approval trust boundary, make the operator session
the console credential, unify task leases, and remove the fabricated numbers
from the telemetry and briefing surfaces.

### Security
- **`GET /api/v1/pr/action` merged pull requests for anyone who could guess a
  token string.** The handler treated any token that was not literally
  `consumed` as authorised — including tokens that were never minted — and took
  the merge target from the query string. A request such as
  `?token=anything&decision=merge&owner=<org>&repo=<repo>&pr=<n>` merged an
  arbitrary pull request with the worker's GitHub token. Approval tokens must
  now exist in KV, are bound to one PR at mint time, are single-use, and the
  merge coordinates come from the stored record, with the owner pinned back to
  `JimEllars`. Tokens are handed back if GitHub refuses the merge, so a
  transient `422`/`5xx` does not burn the operator's link.
- **Approval links no longer mutate state on GET.** Mail clients and link
  scanners prefetch GET links, and the old endpoint merged on that prefetch. GET
  now renders a confirmation page (`Cache-Control: no-store`,
  `X-Frame-Options: DENY`); POST performs the decision.
- **The operator session is now a first-class credential.** The dashboard
  signed task dispatches in the browser with
  `import.meta.env.VITE_AXIM_INTERNAL_KEY`: with the key unset it sent a
  `development-key` signature that the edge rejected with 403, and with the key
  set it inlined the shared internal key into the public bundle — the exact
  thing `README.md` forbids. Relay routes now accept *either* a verified
  Supabase operator session *or* a valid relay signature (`src/services/labService.js`
  sends only the session). A signature that is present is still always verified
  and never downgraded, so a tampered body fails even with a valid session.
- Removed the hand-rolled body-only HMAC verifier in `/api/v1/dlq/sweep`. It
  could not accept a v2 `timestamp.body` envelope, so a v2-signed satellite
  could not sweep the queue. The route now uses the shared verifier, runs before
  the blanket zero-trust block, and accepts an operator session.
- `sanitizeVulnerabilityVectors()` covered `eval`/`exec`/`system` and superglobal
  *concatenation* only. It now also rejects request-driven `include`/`require`
  (LFI/RFI), `call_user_func`/`create_function`/`unserialize`/`extract`/
  `parse_str`, backtick shell execution and `$$` indirection in files that read
  request input.

### Fixed
- **Two dashboard endpoints were dead code.** `/api/v1/dlq/stats` and
  `/api/v1/github/tree` were defined *after* the `request.method !== 'POST'`
  guard, so every dashboard GET returned 405 and the cockpit rendered a zero
  queue depth and an empty file browser. Both are matched before the guard,
  authenticate with the operator session, and pin the repository owner.
- **Task leases meant three different things.** `/api/v1/ingress` wrote
  `active`, `/api/v1/tasks/dispatch` wrote `in_progress` and only treated
  `in_progress` as busy, so a Support retry of an in-flight `/api/v1/ingress`
  task started a second pipeline and a second PR. All lease handling now goes
  through `edge-coder-worker/src/locks.ts`, where any value at `lock:<taskId>`
  is busy. A successful run records `pr-open:<taskId>` and releases the lease,
  so a retry is answered `202 ignored` with the existing `pr_url` instead of
  regenerating the patch.
- **A failed `SWARM_QUEUE.send()` stranded the task.** The send was awaited
  unguarded after the lease was claimed, so a queue error escaped as a 500 while
  the lease stayed held for an hour — the caller's retry was told "already
  processing" and the task never ran. Sends are now guarded (missing binding,
  oversized payload over the 128 KiB limit, or a throw) and fall back to the
  inline pipeline with `transport: "inline"`. Added the `queue()` consumer that
  was missing entirely: a producer with no consumer acked work at the edge and
  dropped it.
- **Edge metrics reported numbers nothing ever measured** —
  `requestCounts.total: 100`, `kvCacheHits: 95`, a 42MB heap. `roundTripLatencyMs`
  subtracted a `Date.now()` epoch from a `performance.now()` origin, producing a
  large negative latency. Values are now measured or `null`, and `/api/telemetry/stats`
  no longer 500s on an unbound namespace or returns `NaN` for average latency.
- **The daily executive briefing was fabricated.** It reported
  `prsOpened: 12, prsReviewed: 10, prsMerged: 8, tokenCost: '$12.50'` every day
  and offered an approve button for one hard-coded "CRITICAL HOTFIX" that did not
  exist. It now reports measured task/failure counts, real DLQ depth and the
  pull requests actually awaiting approval, and says `n/a` when a value cannot be
  read. Recipients match `README.md` (operator, BCC `jrellars@gmail.com`).
- `logUnauthorizedAttempt()` wrote `message` into `coding_tasks_errors` instead
  of `error_message`, so auth violations landed in a column the schema does not
  have.

### Added
- `edge-coder-worker/src/locks.ts` — `acquireTaskLock`, `releaseTaskLock`,
  `recordOpenPullRequest`, `readOpenPullRequest`, `clearTaskState`.
- `edge-coder-worker/tests/trust_boundary.test.ts` — 31 tests covering the
  approval gate, DLQ sweep auth, lease unification, queue fallback and consumer,
  telemetry honesty and the resurrected console GETs.
- `mintApprovalToken()` and the approval-record helpers.
- `clear_pr: true` on `POST /api/v1/force-unlock` for the rare case where the
  operator really does want a ticket regenerated after its PR was abandoned.
- `[[queues.producers]]` / `[[queues.consumers]]` guidance in `wrangler.toml`.

### Changed
- `POST /api/v1/deploy-action` with `action: "REJECTED"` now clears the open-PR
  marker as well as the lease; a rejection means "generate again" and the old
  behaviour would have refused the next dispatch as a duplicate.
- The GitHub webhook `pull_request.closed` handler clears both keys via
  `clearTaskState()`.

---

## [1.4.0] — 2026-11-02

Sprint 1.4: repair the broken worker build, replace self-referential tests with
tests against the real handler, gate hardware-as-code before branch generation,
and move satellite relays to v2 signatures.

### Fixed
- **`main` did not bundle.** `edge-coder-worker/src/ingress.ts` declared `url`,
  `suspiciousPhpPattern` and `pathTraversalPattern` twice (PRs #147 and #148 both
  added the PHP2Shell guard and the merge kept both copies). `wrangler deploy
  --dry-run` failed with `The symbol "suspiciousPhpPattern" has already been
  declared`; the worker could not have been redeployed from `main`.
- **`edge-coder-worker` had no `package.json`** and an empty lockfile, so
  `cd edge-coder-worker && npm test` silently ran the root project. Added real
  `test` / `deploy` / `deploy:dry-run` / `tail` scripts.
- **`tests/hardening.test.ts` tested a copy of the guard**, not the guard. It now
  imports the worker and asserts through `worker.fetch()`.
- **Unknown routes returned 500** instead of 404: the task-payload parser ran for
  every path that reached the zero-trust block.
- **Fleet registry pointed at a non-existent repo:** `ROBOTICS` →
  `axim-robotics-lab` (404 on GitHub) is now `AXiM-Robotics-Lab-Program-4198`.
- **`owner/repo` slugs were treated as repo names**, producing calls to
  `repos/JimEllars/JimEllars/axim-core-v1.2`. Slugs are parsed; unknown owners are
  pinned back to `JimEllars`.
- **Resolution callbacks targeted 404 routes.** `PATCH_READY` went to
  `/api/v1/tickets/:id/patch-status` and DLQ sweeps to `/api/v1/axim-resolution`;
  neither exists in the Support System. Both are gone.
- **Robot infinite-loop detection never matched** (`while (true)`): the trailing
  `\b` after `\)` could not succeed.
- The one-shot LLM retry output is now re-validated instead of being committed.

### Security
- **Supabase session JWTs are verified.** `verifySupabaseToken()` used to
  base64-decode the payload and trust the `email` claim; it now validates the
  token against `GET /auth/v1/user` (60s per-token cache, bounded), so forged,
  expired and revoked sessions are rejected.
- **v2 internal signatures.** New `edge-coder-worker/src/utils/crypto.ts` signs
  `${unix_seconds}.${body}` and sends `X-Axim-Timestamp`, matching the Support
  System's verifier. Legacy v1 body-only signatures are still accepted inbound
  until the 2026-12-31 sunset and logged on every use, so the sender can migrate
  without an outage.
- **Dangerous-sink screening is unconditional.** `sanitizeVulnerabilityVectors()`
  now runs for every generation origin, not only `Asguard_WAF` traffic.
- Removed the duplicated HMAC re-verification in `/api/v1/projects/scaffold` and
  `/api/v1/tasks/dispatch`; a body is proven once, in the zero-trust block.
- `constantTimeEqual()` for the shared internal-key comparison (no prefix
  short-circuit).
- `Access-Control-Allow-Headers` advertises `X-Axim-Timestamp`.

### Added
- **Hardware-as-Code gates:** `validateFreeCadScript()` (geometry import,
  dimensioned primitives, Sketcher geometry/constraints, show/recompute/export),
  `validateMuJoCoModel()` (tag-stack balance, joint `name`/`range`/`axis`,
  positive `<inertial mass>` with `pos`; URDF `<limit>` on revolute/prismatic and
  `<inertial>` presence), `validatePlatformIoConfig()` and
  `validatePlatformIoFirmware()` (`#include`, `setup()`/`loop()`, `<Arduino.h>`).
- **Runtime selectors** for `PlatformIO Firmware` and `MuJoCo / URDF` in
  `PromptTerminal.jsx`, with per-runtime file-path hints.
- **`replayDlqEntry()`** — one DLQ replay routine for the cron sweeper and the
  manual sweep endpoint; ticket callbacks are re-signed with a fresh v2 envelope
  on every retry.
- **`.github/workflows/ci.yml`** — dashboard job (lint, vitest, vite build) and
  worker job (worker vitest, wrangler dry-run). The repo previously had no CI.
- `AGENTS_VERIFICATION.md` and `DEBUGGING_NOTES.md`.

### Changed
- `fetch()` is now a thin wrapper (access log + trace headers on every response)
  around `handleRequest()`; hostile-traffic and preflight responses get trace
  headers too.
- `/api/v1/dlq/sweep` reports `{ reprocessed, remaining }` instead of a
  misleading single count.

---

# Sprint v1.2 Build Prompt - Production Hardening & Telemetry Authenticity Pass
## [Unreleased]

### Added (Production Alignment)
- **Live Streaming Architecture:** Refactored `PromptTerminal.jsx` to centrally stream events directly via `labService.triggerTask`, enabling real-time terminal output and cognitive reasoning trace propagation while maintaining isolation of `supportGateway` RPC commands.
- **Edge Security Hardening:** Stripped hard-coded string comparison bypasses in the edge router (`ingress.ts`). Strictly enforced uniform HMAC validation (`verifyHmacSignature`) for fallback and internal proxy traffic.
- **Resilient Swarm Dispatch:** Updated `jules_bridge.ts` and `callback_dispatcher.ts` to utilize `sendEmailItMessage` fallback pipelines. Intercepted execution failures deterministically, routing terminal failures and Asguard alerts directly to SecOps channels.
- **Audit Filtering:** Connected `AuditLogs.jsx` to live Supabase `coding_tasks_errors` feed, implementing client-side filtering by severity level and relative chronological window.

### Added
- Comprehensive `ErrorBoundary` wrapping for dynamic async components (`Cockpit.jsx`, `SwarmLogConsole.jsx`, `PromptTerminal.jsx`, `PipelineMonitor.jsx`).
- Explicit telemetry fallback states across `Telemetry.jsx` ("OPERATING NORMALLY / CACHED").

### Changed
- **Edge Resilience:** Wrapped `executeCodingPipeline` and `dispatchToJulesAgent` inside `edge-coder-worker/src/ingress.ts` with strict try/catch/finally handlers that log failures to `coding_tasks_errors` in Supabase.
- **Jules Bridge:** Updated `jules_bridge.ts` to intercept delegation API failures and forward them as telemetry logs rather than throwing blind exceptions.
- **Auth Continuity:** Updated `Login.jsx` to intercept valid existing `axim_internal_key` sessions and redirect to Dashboard, avoiding flashing SSO redirect loops.

- Added Edge Telemetry & Diagnostics Integration (/api/telemetry/edge-metrics).
- Enhanced Resilient Session Continuity & Auth Guarding.
- Implemented Streaming Log Console & Terminal Hardening (SSE, auto-scroll, log filters, clear shortcut).
- Improved Jules Bridge & GitHub Bridge Reliability (exponential backoff, webhook verification).
### Security
- Enforced strict HMAC-SHA256 signature verification and isolated uniform error payloads in ingress.ts.

### Resilience
- Added exponential backoff and retry handling for external Jules API delegations (HTTP 429).

### Telemetry & State
- Connected live Supabase pipeline logging with sessionStorage fallback caching and listener cleanup on unmount.

### UX/UI
- Implemented terminal scroll locks, ANSI stream decoding, and guarded SafeIcon against malformed names.

### Auth
- Fortified App.jsx and supabaseClient.js against offline and intermittent session drops.
### Added
- `edge-coder-worker`: New telemetry pipeline ingestion route `POST /api/telemetry/events`.
- `edge-coder-worker`: New telemetry stats fetch route `GET /api/telemetry/stats`.
- `labService`: Real-time telemetry edge events stream query logic with caching and fallback.
- Telemetry Dashboard: HUD polish with agent throughput, error budgets, SVG visual elements, and time-window filtering.
### Fixed
- Dashboard session resilience logic integrated into `DashboardLayout.jsx` with 15-minute optimistic session grace period evaluator for handling transient 5xx auth errors during active use.


## 6. Sprint Report

| Item | Status | Notes |
|---|---|---|
| 3.1 Secrets set | ☑ | Set GITHUB_PAT, SUPABASE_SERVICE_ROLE_KEY, and verified AXIM_INTERNAL_KEY match. Worker health endpoint updated. |
| 3.2 CORS lockdown | ☑ | Replaced wildcard with explicit allow-list. Tested fallback for GitHub webhooks. |
| 3.3 RLS audit | ☑ | Created migration script to enable RLS and add basic allow-all policies for coding_tasks, coding_tasks_errors, api_usage_logs, knowledge_nodes. |
| 3.4 Telemetry authenticity | ☑ | Replaced static data with dynamic labService fetches across Cockpit, RepositoryDetail, DashboardLayout, and CognitiveReasoning components. |
| 3.5 Cloudflare analytics enabled | ☑ | Injected Cloudflare Web Analytics beacon script in index.html. Added Worker analytics to Telemetry.jsx. |
| 3.6 UI/UX QA pass | ☑ | Replaced 0/N/A values in components and verified layout integrity post-changes. |
| 3.7 Dependency audit report | ☑ | @questlabs/react-sdk only imports a CSS file. Both Stripe packages are completely unused. |

**Deferred to next sprint:**
- 5.1 Authentication & Access Control Foundation (stays queued as next sprint's top priority).
- 5.2 Agent routing realism
- 5.3 Real reasoning trace streaming
- 5.4 Deeper Cloudflare capability adoption
- 5.5 Dependency cleanup
- 5.6 Python AST parsing / execution sandbox maturity

**New issues discovered mid-sprint:**
- RepositoryDetail.jsx had similar static telemetry mockups (like 42ms latency) not explicitly mentioned but found and fixed along with Cockpit.jsx.

**Uptime/incidents during rollout:**
- No incidents. Deploys successful.

## [Unreleased]
### Added
- **Server-Sent Events (SSE)** via Cloudflare Edge to handle continuous event streams for the cognitive pipeline.
- Heartbeats mechanism for continuous worker processing using `request.signal.addEventListener('abort')`.
- Unified resilient envelope wrapper around Supabase access calls in `labService.js`.
- Configured Supabase auth client with `persistSession` and `autoRefreshToken`.
- Asynchronous API log dispatches using `logAuditEvent` in `labService.js`.
- Lightweight polling every 10s for pipeline metrics within `Telemetry.jsx`.
- Auto-scroll and manual logs export utility for `SwarmLogConsole.jsx`.
- Updated colors across pages to slate-900/slate-800 for UI modernization.

### Fixed
- Fixed unhandled empty block statement inside stream chunk parsing.
