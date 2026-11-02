# AXiM Coding Lab — Changelog

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
