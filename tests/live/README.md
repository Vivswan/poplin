# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                                       | Needs                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./tests/live`                                                   | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                            | `POPLIN_LIVE_DOMAIN`, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the test install                            | the `Live Checks` workflow: after a green main that reaches it, or by hand | the `cloudflare-live-tests` environment                                   |

```text
Live Checks workflow
  packages/cloudflare/scripts/live/decide.ts     the files of every commit since the last green deploy -> run, or skip
  build the Worker bundle
  packages/cloudflare/scripts/live/converge.ts   bucket, database, login, wrangler deploy, the Domain tab's repair
  packages/cloudflare/scripts/live/suite.ts      a token for the run -> bun test tests/live/live.test.ts -> the token removed
  packages/cloudflare/scripts/live/reset.ts      a token for the reset -> the install put back -> every token removed
  step summary                                   one line of the decision, one table of the install's pieces, one of the checks, one of the reset
```

## What starts a run

| A green main that changed                                                                    | Deploy and checks |
| -------------------------------------------------------------------------------------------- | ----------------- |
| `packages/{core,app,cloudflare,demo,cli}/**`, tests included                                 | run               |
| `demo/**`, `tests/live/**`                                                                   | run               |
| `wrangler.jsonc`, the root `package.json`, `bun.lock`, `.bun-version`, `tsconfig*`           | run               |
| `.github/workflows/live-checks.yml`, `.github/actions/setup/**`, `.gitattributes`            | run               |
| a file in no row of the table in `decide.ts`                                                 | run               |
| only `website/**`, `docs/**`, `brand/**`, `skills/**`, `*.md` at the root                    | skip              |
| only the rest of `.github/**`, `.githooks/**`, the root test guards, the other folders of `tests/` | skip              |
| only the settings of lint, review, and release tools at the root                             | skip              |

The table in `decide.ts` holds every row. A test fails when a file of the repository is in none.

| Also                                                             | Deploy and checks                        |
| ---------------------------------------------------------------- | ---------------------------------------- |
| a run started by hand                                            | run                                      |
| the last run that touched the install did not end green          | run                                      |
| a midnight reset after the last deploy ended red                 | run                                      |
| no earlier deploy is found, or its commit is not in main         | run                                      |
| GitHub does not answer the decision                              | run                                      |
| 00:00 UTC                                                        | neither: the reset alone, every day      |

The files are those of every commit after the last run that deployed and ended green. A change one run skipped still counts for the next, and so does a file changed and put back.

A skip ends green, with a notice and one line of the step summary. It makes no call to Cloudflare.

```text
Live checks skipped: no file that reaches the test install changed since 0a1b2c3 (2 files, e.g. docs/using.md)
```

The midnight reset first waits, in `lane.ts`, until no run of the checks is queued or running. The lane holds one waiting job, and a reset that joined it then would take the place of the checks that wait. A lane busy for an hour ends that run red, with no reset.

## The test install

One install on the Cloudflare test account, called staging. It stays up between runs.

|             | Staging                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Runs        | the latest main that changed a file reaching it                                  |
| Who gets in | the owner alone, behind the login; the demo's site is public                     |
| Updated     | after a green main that changed such a file                                      |
| Put back    | after every run of the checks, whatever they came to, and at 00:00 UTC every day |

| A reset removes                      | A reset leaves                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| every site but the demo's, for good  | the logins and every other setting                                           |
| everything in the trash              | the Worker, the bucket, the database, and the zone's objects                 |
| every token, its own among them      | the four sample sites of `demo/samples`, published anew, each private        |
| every login of a computer that waits | the demo: a public site with the public name `demo`, updated where it stands |

The demo is what `bun run demo:build` writes, at `demo-<public word>.<domain>`. The install serves its files, and the demo's worker answers every address inside it.

The owner sets these; the environment is `cloudflare-live-tests`.

| Set                     | Where                        | For                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| R2 switched on          | the Cloudflare account       | the bucket                                                                |
| Zero Trust switched on  | the Cloudflare account       | the login                                                                 |
| `CLOUDFLARE_API_TOKEN`  | a secret of the environment  | every step that calls Cloudflare                                          |
| `CLOUDFLARE_ACCOUNT_ID` | a secret of the environment  | the same                                                                  |
| `POPLIN_LIVE_LOGIN`     | a secret of the environment  | the login the install lets in                                             |
| `DEMO_URL`              | a variable of the repository | the demo's whole https address, for the website; absent, it shows no link |

## What a run skips

A check that cannot run is written to the step summary as skipped, with what it needs, and to the log as a warning. It never fails the run.

A run that cannot make the install answer, or cannot start the checks, fails: the log's error line and the step summary say what it needs. That covers a token with no permission for the zone, the bucket, the database, the Worker, the DNS record, or the route.

| Skipped: needs                                                      | Checks                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a token permission for a rule, the bot settings, or the login       | the piece of the install that permission makes, and the checks behind it |
| Access switched on for the account                                  | `L1`                                                                     |
| an install that sends a private site's address to its letter p form | `L1`, `L4`, `L5`                                                         |
| a Worker route for the public word's hostnames                      | `public-name`, `demo`                                                    |
| a public site named `demo`, which the reset publishes               | `demo`                                                                   |
| a plan whose bot settings the API can change                        | `crawler`                                                                |
| the guard rule, the redirect rule, or the rate rule on the zone     | `L8-method`, `L8-scanner`, `L8-http`, `burst-rate-rule`                  |
| a run started by hand with the many-files check switched on         | `L10`: two thousand uploads, so not on every green main                  |
| a person in a browser                                               | `L2`, `L3`, `L4-in`, `L5b`, `L6`, `L7`, `L9`: the checklist below        |

## The token's permissions

| Permission                                                  | Scope       | For                                               |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------- |
| Zone: Read                                                  | the zone    | finding the zone and its plan                     |
| DNS: Edit                                                   | the zone    | the two records                                   |
| Workers Routes: Edit                                        | the zone    | the routes                                        |
| Zone WAF: Edit                                              | the zone    | the guard rules and the rate rule                 |
| Single Redirect: Edit                                       | the zone    | the redirect of plain http                        |
| Zone Settings: Read                                         | the zone    | reading the zone's own https switch               |
| Bot Management: Edit                                        | the zone    | the bot settings                                  |
| Workers Scripts: Edit                                       | the account | the Worker and its cron trigger                   |
| Workers R2 Storage: Edit                                    | the account | the bucket                                        |
| D1: Edit                                                    | the account | the database, and the run's token row             |
| Access: Apps and Policies: Edit                             | the account | the login                                         |
| Access: Organizations, Identity Providers, and Groups: Read | the account | the team domain the Worker checks a login against |

## The checklist a person makes

Before you start: Access is on for the test account, and the `POPLIN_LIVE_LOGIN` secret of the environment holds an email you can read. Run the workflow once, so the install lets that login in. Use a private browser window for every step that says logged out.

| Check   | Do                                                                                                                                                               | Look for                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| login   | Open the dashboard, logged out. Enter your email and the code Cloudflare sends.                                                                                  | Cloudflare's login page first, then the dashboard. An email that is no login gets no code that works.   |
| `setup` | On a Cloudflare account with no poplin, follow `docs/install.md` from step 1 to step 5. Then open `/setup` on the dashboard and on the Worker's own address.     | Each step works as written: in step 2 the last button of the form deploys, and the page that opens has the `workers.dev` address at its top. The setup page lists the objects it made. After the first login, `/setup` answers 404 on both addresses.|
| `token` | Open the link "Make the token" on the setup page, or the one in step 3 of `docs/install.md`, logged in to Cloudflare.                                            | The token form opens with the eight linked rights ticked. With the three by-hand rows added, a Repair shows no failed row.          |
| `http`  | Switch the redirect rule off in the zone's Redirect Rules, then run `curl -i http://<a site's address>` and the same on the admin hostname and the Worker's own address.                 | Status 308 and a `Location` that is the same address over `https`, from the Worker: its address reaches the Worker as `http`. Switch the rule on again. |
| `L3`    | Publish two private sites. Open the first, then the second.                                                                                                      | Both open. The second asks for nothing.                                                                 |
| `L2`    | Publish private site B. Publish private site A whose page shows B in an `iframe`. Open A in Chromium, Firefox, and Safari. Then open B directly and reload A.    | In each engine: whether B shows inside A before B was opened directly, and after. Write both down.      |
| `L4-in` | Publish an unlisted site and copy its address. Run `poplin set <label> --private`. Open the copied address logged out, then log in.                              | Logged out: the login, and no part of the page. Logged in: the site, at the address `set` printed.      |
| `L7`    | Add a second login on the dashboard. Log in as it in another browser and open a private site. Remove that login. Reload the site within a minute, then after it. | After a minute at most, the reload shows no page of the site.                                           |
| `L5b`   | In Zero Trust, delete the Access application named `poplin`. Open a private site logged out. Run the workflow again.                                             | Status 404 and no part of the page. After the workflow, the application is back and the login works.    |
| `L6`    | Reload a private page twenty times. Open the Worker's metrics in the Cloudflare dashboard.                                                                       | CPU time per request under 10 ms, the Free plan's limit.                                                |
| `L9`    | Open an unlisted site in Chromium, Firefox, and Safari. Publish new content to it. Reload within five minutes, then after.                                       | Which reload first shows the new version in each engine, and that no page mixes files of both versions. |
| `copy`  | After `setup`, open the copy on GitHub, and the Worker's build settings in Cloudflare. Read the log of the first build. | The deploy command runs the `deploy` script of `package.json`. The log holds one line that starts with `poplin:`. Note what the copy's `wrangler.jsonc` holds that the repository's does not. |
| `update` | With a release of poplin published, follow "Update the install" in `docs/install.md` on the install of `setup`. Read the new build's log. | The log holds `poplin: deploying`, the release's version, and `(was asked for latest)`. The dashboard, its sites, and its settings are as before, and the account holds no second bucket or database. |
| `pin`   | Set the build variable `POPLIN_VERSION` to an older release's version and build again. Then set it to `v1` and build again. | The first log names the older version. The second build fails with one line that starts with `poplin:` and holds `Nothing was deployed`, and the install still answers. |

Delete the sites you published when you are done: `poplin delete <label> --forever`.
