# Worker production deployment

The production Worker is `ansem-frontline-stream` in the Cloudflare account whose `workers.dev` subdomain is `ansem-frontline`. Its public origin is therefore:

`https://ansem-frontline-stream.ansem-frontline.workers.dev`

The source of truth is `worker/wrangler.jsonc`. It explicitly enables `workers_dev`, uses `worker/src/index.js`, compatibility date `2026-08-24`, and the SQLite Durable Object class `StreamHub` through the `STREAM_HUB` binding and migration tag `v1`. The only Worker secret currently required by the application is `HELIUS_API_KEY`. Its value must never be committed or printed.

## Public contract

- `GET /health` proves only that the Worker runtime is reachable. It is side-effect free, does not access RPC/providers or a Durable Object, returns `cache-control: no-store`, and does not claim upstream health.
- `GET /market`, `POST /recent`, `/gecko/*`, and the `/stream` WebSocket are the production data routes.
- Browser access is restricted to `https://ansem-frontline.vercel.app`, `https://powerpinkk.github.io`, and local development origins. Direct server requests without an `Origin` header remain supported. Lookalike origins are rejected.
- The frontend endpoint authority is the single `RELAY_ORIGIN` constant in `js/config.js`; only the WebSocket URL has the documented `VITE_STREAM_URL` development override.

Before deployment, run:

```text
npm ci
npm run lint
npm test
npm run build
npx wrangler deploy --dry-run --config worker/wrangler.jsonc
```

An authenticated operator can then deploy the exact checked-out commit with:

```text
npm run worker:deploy
```

Immediately verify `/health`, CORS from both production origins, WebSocket upgrade, the active deployment/version ID, and both public frontends. A custom domain is a future hardening option; this recovery intentionally retains the existing `workers.dev` hostname.

## GitHub Actions setup still required

As of the M10.1 recovery, the repository and its `Production` environment do not contain the required Cloudflare secret names. Do not add a deployment workflow that fails on every main push. Configure these encrypted GitHub secrets first:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use a scoped API token, not a Global API Key. Follow Cloudflare's current **Edit Cloudflare Workers** token template, restrict it to the single owning account, and grant no unrelated zone or account permissions. Durable Objects use the implementing Worker's permission and do not require a separate Durable Objects token permission.

After those names exist, add a production-only workflow using `cloudflare/wrangler-action@v4`, the repository's locked Wrangler version, `contents: read`, a serialized production concurrency group, `workflow_dispatch`, and `push` to `main` filtered to Worker code/config, shared Worker runtime modules, the lockfile/package manifest, and the workflow itself. It must run tests and `wrangler deploy --dry-run` before deployment. Pull requests and arbitrary branches must never deploy the production Worker.

Source-version correlation should be added when CI/CD is enabled. Prefer a non-sensitive build identifier injected by the trusted deployment workflow and returned by `/health`; do not replace or omit the existing configured variables when injecting it.
