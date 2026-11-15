# The Cloudflare package

The Worker that runs a poplin install on Cloudflare, the setup client for a zone, and the OpenTofu module in `tofu/`.

| To | Run | Result |
| --- | --- | --- |
| build the bundle | `bun run --cwd packages/cloudflare build` | `packages/cloudflare/dist/worker.js`, the one file the OpenTofu module uploads |
| deploy the Worker | `bun run deploy`, at the repository's root | the Worker in the Cloudflare account wrangler is logged in to, with its bucket and its database made the first time |

The Worker's configuration is `wrangler.jsonc` at the repository's root. It holds no value of any install: setup writes `ZONE`, `FIRST_SETTINGS`, `ACCOUNT_ID`, and `ACCESS` onto the deployed Worker. [By hand](../../docs/start/by-hand.md) has the steps.
