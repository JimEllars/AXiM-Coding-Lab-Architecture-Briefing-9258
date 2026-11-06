# Continued Development Plan — AXiM Coding Lab

Living roadmap for `JimEllars/AXiM-Coding-Lab-Architecture-Briefing-9258`.
Newest state at the top. Every item here is either proven by a test in this repo
or was observed against a live system; nothing is aspirational prose.

Companion documents: `CHANGELOG.md` (what shipped), `AGENTS_VERIFICATION.md`
(proof for each sprint), `DEBUGGING_NOTES.md` (root causes, decisions, debt).

**Last reconciled:** 2026-11-06 (Sprint 1.8).

---

## Current state (2026-11-06)

| Surface | Status |
| :--- | :--- |
| Dashboard (`src/`) | Lint clean, 43 tests, production build passes, CSS 44.34 kB |
| Edge worker (`edge-coder-worker/`) | 199 tests, `wrangler deploy --dry-run` bundles at 142.51 KiB |
| PHP2Shell / CGI ingress screen | 403s CGI argument injection, PHP stream wrappers, traversal (raw + 2 decode passes) |
| Zero-trust relay | v2 `X-Axim-Timestamp` + `HMAC(ts.body)`, 300 s skew, v1 accepted with a warning until the 2026-12-31 sunset |
| Fleet registry | 11/11 entries verified against `gh api repos/JimEllars/…` |
| Runtime contract | `runtime_contract.test.ts` proves every `(runtime, extension)` the cockpit advertises is one the worker can route |
| Support interlock | Patch-ready → `/api/v1/tickets/callback`; resolution → `/resolve-from-coder`; both v2-signed, both DLQ-backed |
| Asguard interlock | **Open.** No coder-facing route exists upstream (see below) |
| CI (`ci.yml`) | lint → vitest → vite build → worker tests → wrangler dry-run, on every PR |

---

## P0 — blocking or customer-visible

_None open._

## P1 — correctness and interlock integrity

1. **Asguard resolution route.** The coder can produce a rule PR for an SOC
   incident but cannot report it: the SOC publishes `/api/v1/triage/dispatch`
   (a mitigation order) and nothing that accepts a coder notification.
   Unblock by adding `POST /api/v1/triage/resolution`
   (`{ incidentHash, status, prUrl, commitSha }`, v2 signature), then flipping
   `buildSatelliteRequest()` in `edge-coder-worker/src/callback_dispatcher.ts`
   from `unsupported` to a real endpoint. Tests already cover the unsupported
   branch; they would be replaced by route assertions. **Still blocked on the
   Asguard repo** — this is the one item the Coding Lab cannot close alone.
2. **Coordinated toolchain upgrade.** Dependabot #130, #131 and #150 are
   unusable individually: `vitest@5` peer-requires `vite ≥ 6.4` and
   `@vitejs/plugin-react@4` refuses `vite@8`. One branch with `vite@7` +
   `vitest@5` + `plugin-react@5` clears all three (plus #149, undici + wrangler,
   which is already green on its own). Note that `npm install` in this workspace
   must pass `--include=dev`; `NODE_ENV=production` is exported and will
   otherwise strip every devDependency.

## P2 — engineering hygiene

3. **Prune stale remote branches.** 147 remote branches, 4 open PRs (all
   Dependabot). ~40 `feat/*` and `jules-*` branches are merged into `main`.
   Keep the sweep script in the runbook rather than in the repo.
4. **Chunk the JS bundle.** The CSS half of this is done — 2,076.40 kB →
   44.34 kB by dropping the unused `@questlabs/react-sdk` stylesheet. One
   1,854.51 kB JS chunk remains, dominated by `echarts` + `echarts-for-react`,
   which are used on exactly one page (`Telemetry`). A `manualChunks` split plus
   a lazy route boundary is the next win, and it would take the 10m40s build
   down further.
5. **Single-source the fleet registry.** The dashboard keeps its own copy of
   the table (`src/lib/fleetRegistry.js`) and a parity test guards drift. The
   end state is one generated module (or `fleet-registry.json` consumed by
   both), so parity is a proof instead of a detector.
6. **Test-suite concurrency.** 242 tests across 10 files exceed a 3.9 GB host
   without swap (`--maxWorkers=1` is green). If CI ever flakes, cap
   `poolOptions.forks.maxForks` rather than dropping coverage.

## Verification gate (unchanged)

No feature work starts until all of these are green on the branch:

```
npm run lint
npx vitest run            # 4 files, dashboard (43 tests) + 6 files, worker (199 tests)
npx vite build
npx wrangler deploy --dry-run --keep-vars --config edge-coder-worker/wrangler.toml
```

The worker bundle must also stay under Cloudflare's 1 MiB compressed limit — it
is at 32.03 KiB gzip, so there is no pressure, but the check is free.
