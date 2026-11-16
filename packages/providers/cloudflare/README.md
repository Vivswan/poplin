# The Cloudflare package

The Worker that runs a poplin install on Cloudflare, the installer `poplin install cloudflare` runs, and the client that makes and repairs an install's objects at Cloudflare.

| To | Run | Result |
| --- | --- | --- |
| build the bundle | `bun run --cwd packages/providers/cloudflare build` | `packages/providers/cloudflare/dist/worker.js`, the Worker as one file, and its source map `worker.js.map` beside it |
| build the installer | `bun run --cwd packages/cli build` | `packages/cli/dist/providers/cloudflare.mjs`, built from `src/shared/install/first/installer.ts`: the one file of this package the published command carries |
| measure what each action costs | `bun run --cwd packages/providers/cloudflare costs` | a table of the database queries and storage calls of every request. On GitHub, the Action Costs workflow adds it to its run's summary, keeps it as the `action-costs` artifact, and comments on a pull request with the rows that changed against main |

The Worker's configuration is `wrangler.jsonc` at the repository's root. It holds no value of any install: the installer uploads a release's built files as the Worker's first version, then writes `ZONE`, `FIRST_SETTINGS`, `ACCOUNT_ID`, and `ACCESS` onto it. [Install](../../../docs/start/install.md) has the steps.

The Worker reads two secrets: `KEPT_KEY`, the Cloudflare API token poplin keeps, and `UPLOAD_KEY`, the key a publish's files are signed for the bucket with. No file names them, and an update's upload leaves them as they are.
