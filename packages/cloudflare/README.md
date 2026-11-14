# The Cloudflare package

The Worker that runs a poplin install on Cloudflare, the setup client for a zone, and the OpenTofu module in `tofu/`.

| To | Run | Result |
| --- | --- | --- |
| run the Worker on this machine | `bun run --cwd packages/cloudflare dev` | the Worker on `http://localhost:8787`, with a local bucket, database, and counters, and the example values of `wrangler.jsonc` |
| build the bundle | `bun run --cwd packages/cloudflare build` | `packages/cloudflare/dist/worker.js`, the one file the OpenTofu module uploads |

A local run reads the hostname from the `Host` header:

```sh
curl -H "Host: admin.example.com" http://localhost:8787/api/whoami
curl -H "Host: docs-page.example.com" http://localhost:8787/
```
