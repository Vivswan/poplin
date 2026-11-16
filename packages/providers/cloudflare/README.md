# The Cloudflare package

The Worker that runs a poplin install on Cloudflare, the installer `poplin install cloudflare` runs, and the client that makes and repairs an install's objects at Cloudflare.

| To | Run | Result |
| --- | --- | --- |
| build the bundle | `bun run --cwd packages/providers/cloudflare build` | `packages/providers/cloudflare/dist/worker.js`, the Worker as one file, and its source map `worker.js.map` beside it |
| build the installer | `bun run --cwd packages/cli build` | `packages/cli/dist/providers/cloudflare.mjs`, built from `src/shared/install/first/installer.ts`: the one file of this package the published command carries |
| measure what requests cost as an install grows | `bun run --cwd packages/providers/cloudflare load` | [the load test](#the-load-test): a table for each request, a row for each size of install, then every place a number crosses or nears a limit of Cloudflare's free plan |
| measure what each action costs | `bun run --cwd packages/providers/cloudflare costs` | a table of the database queries and storage calls of every request. On GitHub, the Action Costs workflow adds it to its run's summary, keeps it as the `action-costs` artifact, and comments on a pull request with the rows that changed against main |

The Worker's configuration is `wrangler.jsonc` at the repository's root. It holds no value of any install: the installer uploads a release's built files as the Worker's first version, with `INSTALL_PLACE`, the place the install is started for, then writes `ZONE`, `FIRST_SETTINGS`, `ACCOUNT_ID`, and `ACCESS` onto it. [Install](../../../docs/start/install.md) has the steps.

The Worker reads two secrets: `KEPT_KEY`, the Cloudflare API token poplin keeps, and `UPLOAD_KEY`, the key a publish's files are signed for the bucket with. No file names them, and an update's upload leaves them as they are.

## The load test

`bun run --cwd packages/providers/cloudflare load` fills an install on the local Workers runtime and measures each request on it. It calls nothing at Cloudflare, and takes about a minute and a half.

| It fills | Sizes |
| --- | --- |
| sites, each with three versions | 10, 100, 1,000, 5,000 |
| the files of one site | 10, 1,000, 5,000 |
| the entries of the Activity log | 1,000, 50,000, 200,000 |
| users | 5, 50 |
| tokens | 50 |

| At each size it sends | And counts |
| --- | --- |
| one request, on an instance that reads the settings anew | database queries, rows read, rows written, bucket calls, and the milliseconds by the clock |
| 20 more, one after another, or as many as the fill has room for | what one costs on average, and how many failed |
| 50 more, at once | how many failed, and how many were refused as that request may be, in the refusal's own words |

The requests are a visitor's, each screen of the dashboard, a publish's three steps, a copy, an import, a removal, the scheduled run, and a backup's reads. Four more provoke a limit on purpose, and every request past it must answer that limit's refusal.

| To | Run |
| --- | --- |
| print the report | `bun run --cwd packages/providers/cloudflare load` |
| keep it as a Markdown file | the same, with `LOAD_REPORT_FILE` set to the file's path |
| change the sizes | `load/profiles.ts` |
| add a request | a row in a file of `tests/load/support/`, and its ceiling in `load/profiles.ts` |

The milliseconds are of the local database and bucket, and no measure of a Worker's processing time.

The Worker's tests run the same requests at two small sizes each. A request whose cost should not grow with the install fails there once it does, and so does one that costs more than its ceiling in `load/profiles.ts`.

Publishes, visits, listings, and a copy at small sizes against a deployed install are [the load of the live checks](live/README.md#the-load), which a person starts by hand.
