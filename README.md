# AXiM Coding Lab

This project is now deployed to Cloudflare as:

- **Frontend (Pages):** https://axim-coding-lab-dashboard.pages.dev
- **Worker API:** https://axim-coding-lab-worker.jrellars.workers.dev

## Cloudflare setup applied

1. Installed Wrangler and connected to Cloudflare account `AXiM Systems Account`.
2. Created and bound KV namespaces in `edge-coder-worker/wrangler.toml`:
   - `LAB_STATE`: `afc3219e3592439b8d3ae6fcb2f40004`
   - `TASK_LOCKS`: `f399b6d9a6e7425aa3cb648e742ab4b8`
3. Deployed Worker `axim-coding-lab-worker`.
4. Created Pages project `axim-coding-lab-dashboard` and deployed `dist/`.
5. Set Worker secret:
   - `AXIM_INTERNAL_KEY`

## Production configuration

The Worker, both KV namespaces, and the Pages project are present in the AXiM Systems Cloudflare account. The Worker expects these deployed secrets:

- `AXIM_INTERNAL_KEY`
- `GITHUB_TOKEN`
- `SUPABASE_SECRET_KEY`
- `EMAILIT_API_KEY`

Set a missing secret interactively from `edge-coder-worker`:

```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put EMAILIT_API_KEY
```

`SUPABASE_URL` and `SUPABASE_LLM_PROXY_URL` are version-controlled Worker variables. Their values are required by the deployed runtime and must remain aligned with the AXiM Supabase project. `deploy:worker` uses `--keep-vars` to retain any other dashboard-managed variables, but it does not preserve variables that are absent from `wrangler.toml`.

Do not set `VITE_AXIM_INTERNAL_KEY`: Vite exposes `VITE_*` values to every browser user. The dashboard requires `VITE_SUPPORT_API_URL=https://support.axim.us.com` and sends its Passport `axim_session` cookie to the AXiM Support task-dispatch proxy. That proxy must authorize the operator, then HMAC-sign and forward `TASK_DISPATCH`, `DEPLOY_ACTION`, and `FORCE_UNLOCK` operations to the corresponding Coding Lab Worker endpoints.

The dashboard no longer signs anything in the browser. When it calls the Worker directly — task dispatch, project scaffold, repository tree, DLQ stats and sweep — it sends the operator's Supabase session as a bearer token, and the Worker accepts a verified operator session as an alternative to a relay signature on those routes. A signature that *is* present is still always verified, so a tampered body fails even with a valid session. See `DEBUGGING_NOTES.md` (2026-11-03) for why the bundled-key approach was removed.

The human approval links in the daily briefing are single-use and bound to one pull request. The link opens a confirmation page; the merge happens on the POST, never on the GET, because mail clients prefetch links.

Cloudflare Email Sending has no enabled sender domain. Enable the approved AXiM sender domain before adding operational email notifications:

```powershell
npx wrangler email sending enable <approved-axim-domain>
```

The Coding Lab sends the daily executive summary through EmailIt, not Cloudflare Email Sending. It runs at 04:00 EST (`09:00 UTC`) and sends to `james.ellars@axim.us.com`, with `jrellars@gmail.com` BCC'd. The current Worker account does not yet have the required `EMAILIT_API_KEY` secret; add it before deploying the scheduled summary.

## Build and deploy commands

```powershell
npm install          # single toolchain for the dashboard *and* the edge worker
npm run build        # lint + vite build
npm run test         # vitest: dashboard suite + edge-coder-worker suites
npm run deploy:worker
npm run deploy:pages
```

`edge-coder-worker/` has its own `package.json` (`test`, `deploy`, `deploy:dry-run`,
`tail`) but shares the repository-root `node_modules`, so a single `npm install`
at the root covers both halves:

```bash
cd edge-coder-worker
npm test                                        # worker suites only
npx wrangler deploy --dry-run --config wrangler.toml   # bundle check, no deploy
```

CI (`.github/workflows/ci.yml`) runs the same battery on every PR: `npm run lint`,
`npx vitest run`, `npx vite build`, the worker suites, and a `wrangler deploy
--dry-run` bundle check. A worker that cannot bundle now fails the PR instead of
reaching `main`.

`edge-coder-worker/src/locks.ts` owns task lifecycle state. `lock:<taskId>` is a
run lease (any value means busy) and `pr-open:<taskId>` remembers the pull
request a task already produced, so a Support retry is answered
`202 ignored` with the existing `pr_url` instead of generating a second patch.

Multi-file tasks are handed to `SWARM_QUEUE` when that binding exists. Without
it — or if the payload exceeds the 128 KiB queue limit, or the send throws — the
task runs inline and answers `202` with `transport: "inline"`. If you enable the
binding, enable `[[queues.consumers]]` with it: a producer with no consumer acks
work at the edge and drops it.

`TELEMETRY_KV` and `CODER_DLQ_KV` are read behind optional guards, so the Worker
deploys without them, but the dead-letter queue and telemetry history are
no-ops until both namespaces are bound in `wrangler.toml` with real IDs.

## Internal relay signatures (v2)

Every satellite-to-satellite call signs the raw body with HMAC-SHA256 under
`AXIM_INTERNAL_KEY` and sends `X-Axim-Timestamp` (unix seconds). The signature
covers `${timestamp}.${body}` and is rejected when the timestamp is more than
300 seconds away from the receiver's clock. This matches
`AXiM-Support-System-1.1-4538`, which stops honouring body-only signatures after
its `AXIM_SIG_LEGACY_UNTIL` sunset (default `2026-12-31`).

Inbound, the worker accepts v2 and falls back to the legacy body-only signature,
logging every fallback so the remaining migration debt is visible in
`wrangler tail`. All outbound calls (`postSignedRelay` in
`edge-coder-worker/src/ingress.ts`) use v2, including DLQ replays, which re-sign
with a fresh envelope on every attempt.

The only Support System endpoint the Coding Lab resolves tickets against is
`POST https://support.axim.us.com/api/v1/tickets/:id/resolve-from-coder`.

Deploy only after the secrets and variables above have been verified.

## Documentation

- `AGENTS_VERIFICATION.md` — what changed and the verbatim commands that prove it.
- `DEBUGGING_NOTES.md` — root causes, decisions and known debt.
- `CHANGELOG.md` — release-facing summary.
