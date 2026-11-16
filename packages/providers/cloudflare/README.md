# The Cloudflare package

The Worker that runs a poplin install on Cloudflare, and the setup client for a zone.

| To | Run | Result |
| --- | --- | --- |
| build the bundle | `bun run --cwd packages/providers/cloudflare build` | `packages/providers/cloudflare/dist/worker.js`, the Worker as one file, and its source map `worker.js.map` beside it |
| deploy the Worker | `bun run deploy`, at the repository's root | the Worker and its source map in the Cloudflare account wrangler is logged in to, with its bucket and its database made the first time |
| measure what each action costs | `bun run --cwd packages/providers/cloudflare costs` | a table of the database queries and storage calls of every request. On GitHub, the Action Costs workflow adds it to its run's summary, keeps it as the `action-costs` artifact, and comments on a pull request with the rows that changed against main |

The Worker's configuration is `wrangler.jsonc` at the repository's root. It holds no value of any install: setup writes `ZONE`, `FIRST_SETTINGS`, `ACCOUNT_ID`, and `ACCESS` onto the deployed Worker. [By hand](../../../docs/start/by-hand.md) has the steps.

The Worker reads two secrets: `KEPT_KEY`, the Cloudflare API token poplin keeps, and `UPLOAD_KEY`, the key a publish's files are signed for the bucket with. No file names them, and a deploy leaves them as they are.
