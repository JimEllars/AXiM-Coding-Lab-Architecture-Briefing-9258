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

Cloudflare Email Sending has no enabled sender domain. Enable the approved AXiM sender domain before adding operational email notifications:

```powershell
npx wrangler email sending enable <approved-axim-domain>
```

The Coding Lab sends the daily executive summary through EmailIt, not Cloudflare Email Sending. It runs at 04:00 EST (`09:00 UTC`) and sends to `james.ellars@axim.us.com`, with `jrellars@gmail.com` BCC'd. The current Worker account does not yet have the required `EMAILIT_API_KEY` secret; add it before deploying the scheduled summary.

## Build and deploy commands

```powershell
npm install
npm run build
npm run deploy:worker
npm run deploy:pages
```

Deploy only after the secrets and variables above have been verified.
