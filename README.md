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
5. Rebuilt frontend with:
   - `VITE_INGRESS_URL=https://axim-coding-lab-worker.jrellars.workers.dev/api/v1/ingress`
   - `VITE_AXIM_INTERNAL_KEY=development-key`
6. Set Worker secret:
   - `AXIM_INTERNAL_KEY`

## Remaining required secrets

The Worker is live, but production automation requires these missing secrets:

- `GITHUB_PAT`
- `SUPABASE_SERVICE_ROLE_KEY`

Set them in `edge-coder-worker`:

```powershell
npx wrangler secret put GITHUB_PAT
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Build and deploy commands

```powershell
npm install
npm run build
npm run deploy:worker
npm run deploy:pages
```
