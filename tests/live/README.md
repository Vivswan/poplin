# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                                       | Needs                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./tests/live`                                                   | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                            | `POPLIN_LIVE_DOMAIN`, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the test install                            | the `Live Checks` workflow: after a push to main that reaches it, or by hand | the `cloudflare-live-tests` environment                                   |

```text
Live Checks workflow
  the `paths` list of the workflow                the files of the push -> a run, or none
  packages/cloudflare/scripts/live/gate.ts       the `all-green` check of the commit's CI: it ended green, or the run stops red; a job after it stops nothing
  build the Worker bundle
  packages/cloudflare/scripts/live/start-over.ts a run by hand with `start_over` ticked: everything poplin made, removed
  packages/cloudflare/scripts/live/converge.ts   the account's plans, bucket, database, login, wrangler deploy, the Domain tab's repair, the caps
  packages/cloudflare/scripts/live/suite.ts      a token for the run -> bun test tests/live/live.test.ts -> the token removed
  packages/cloudflare/scripts/live/reset.ts      a token for the reset -> the install put back -> every token removed
  step summary                                   one table of the install's pieces, one of the checks, one of the reset
```

## What starts a run

| A push to main that changed                                                                  | Deploy and checks |
| -------------------------------------------------------------------------------------------- | ----------------- |
| `packages/**`, tests included                                                                | run               |
| `demo/**`, `tests/live/**`                                                                   | run               |
| `wrangler.jsonc`, the root `package.json`, `bun.lock`, `.bun-version`, `tsconfig*`           | run               |
| `.github/workflows/live-checks.yml`, `.github/actions/setup/**`, `.gitattributes`            | run               |
| a file no `!` line of the workflow's `paths` list names                                       | run               |
| only `website/**`, `docs/**`, `brand/**`, `skills/**`, `*.md` at the root                    | no run            |
| only the rest of `.github/**`, the root test guards, `tests/{fuzz,support}/**`               | no run            |
| only the settings of lint, review, hook, and release tools at the root                       | no run            |

The `paths` list of `.github/workflows/live-checks.yml` holds every row. The files are those of the one push, first commit to last. GitHub reads the first 3,000 changed files of a push, and a push of more than 1,000 commits always starts a run.

| Also                                                   | What happens                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| a run started by hand                                  | deploy and checks, with no wait for CI                               |
| a run started by hand with `start_over` ticked         | first removes everything poplin made there, then the same            |
| a push that starts no run                              | no row in the list of runs, and no tick on the commit                |
| the commit's `all-green` check did not end green       | a red run: nothing deployed, no call to Cloudflare                   |
| a run ended red                                        | it stays red until it is run again by hand, or a later push starts a run |
| a newer push while an older push's run has not started | the older run is cancelled, the newer one deploys both               |
| 00:00 UTC                                              | the reset alone, every day; it waits its turn and replaces no run    |

The install is made from the commit of the push, the one whose `all-green` check ended green. Running a red run again makes the install from that same commit.

One job touches the install at a time. The checks and the midnight reset wait in one lane that keeps every waiting job, so neither takes the other's place.

## Start the test install over

On GitHub: Actions, Live Checks, Run workflow, tick `start_over`, Run workflow.

The run removes the Worker and its routes, poplin's DNS records, rules, Access application and policy, the database, and every file in the bucket. The bucket stays, and so does everything on the account that poplin did not make. A kind the token has no permission for stays too, and a warning names the permission. The run then makes the install from nothing and puts the samples and the demo back.

## The test install

One install on the Cloudflare test account, called staging. It stays up between runs.

|             | Staging                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Runs        | the latest main that changed a file reaching it                                  |
| Who gets in | the owner alone, behind the login; a stranger opens the public and unlisted sample sites |
| Updated     | after a green main that changed such a file                                      |
| Put back    | after every run of the checks, whatever they came to, and at 00:00 UTC every day |

| A reset removes                      | A reset leaves                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| every site but the demo's, for good  | the logins and every other setting                                           |
| everything in the trash              | the Worker, the bucket, the database, and the zone's objects                 |
| every token, its own among them      | the sample sites below, published anew                                       |
| every login of a computer that waits | the demo: a public site with the public name `demo`, updated where it stands |

| The sample sites a reset leaves | How many                              |
| ------------------------------- | ------------------------------------- |
| public                          | 2, and the demo                       |
| unlisted                        | 3, one of them runs out after 7 days  |
| private                         | 4, one of them runs out after 2 days  |
| in the trash                    | 1                                     |
| with three versions             | 1; every other has one                |

Each site, its title, and who opens it come from one table, `packages/demo/src/preview/sample-sites.ts`. The demo's seed plays its whole history, and the reset publishes what it ends in, so the install's Sites screen and the demo's list the same sites. The install holds no site that already ran out.

The demo is what `bun run demo:build` writes, at `demo-<public word>.<domain>`. The install serves its files, and the demo's worker answers every address inside it.

The reset writes `sites.json` beside the demo's files: the address of each sample site outside the trash. The demo's links to those sites then lead to the install's own: a public or unlisted one opens, a private one shows the login. No line of a run names an address.

The owner sets these; the environment is `cloudflare-live-tests`.

| Set                     | Where                        | For                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| R2 switched on          | the Cloudflare account       | the bucket                                                                |
| Zero Trust switched on  | the Cloudflare account       | the login                                                                 |
| `CLOUDFLARE_API_TOKEN`  | a secret of the environment  | every step that calls Cloudflare                                          |
| `CLOUDFLARE_ACCOUNT_ID` | a secret of the environment  | the same                                                                  |
| `POPLIN_LIVE_LOGIN`     | a secret of the environment  | the login the install lets in                                             |
| `DEMO_URL`              | a variable of the repository | the demo's whole https address, for the website; absent, it shows no link |

## What keeps the test account at no cost

| Guard                                                                                  | Where                                         | At the limit                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| the zone's plan is Free, and no subscription of the account has a price                | `plan.ts`, before anything is made            | the run stops red                                             |
| caps: 200MB stored, 20MB a site, 100 sites, 2,500 files a publish, 5,000 files a day   | `caps.ts`, on every run, once the install answers | the install refuses the publish                           |
| bucket writes and lists: 150 by the checks, 2,300 with the many-files check, 150 by a reset | `budget.ts`, around every request to the install | the request is not sent, and the step stops red       |
| every site the checks make is removed for good                                         | the checks' own sweep, then the reset         | the reset runs after failed checks too                        |
| a site of a run that was killed                                                        | published with `--expires 1d`, trash of one day | the midnight reset removes it                               |
| the sample sites and the demo: 12 sites, 110 files, and 4 MB at most                   | `caps.test.ts`, from a reset of a local fake  | the self-test fails                                           |

A token without Billing: Read cannot read the subscriptions: the run goes on, with a warning and a skipped row. The zone's plan is checked all the same.

```text
one run, at its ceilings         2 (the bucket found or made) + 150 (checks) + 150 (reset) = 302 bucket writes and lists
a day of 40 such runs            40 x 302 + 150 (the midnight reset) = 12,230
31 such days                     12,230 x 31 = 379,130 of the 1,000,000 R2 takes for free in a month
a run with the many-files check  2 + 2,300 + 150 = 2,452, started by hand alone
a usual run                      about 50 (checks) + 112 (reset)
```

A run starts after a green main that changed a file reaching the install, or by hand, so 40 a day is far above what happens. The count is the harness's own, one for each request that makes the install write or list; the install lists once more for every thousand files.

## What a run skips

A check that cannot run is written to the step summary as skipped, with what it needs, and to the log as a warning. It never fails the run.

A run that cannot make the install answer, or cannot start the checks, fails: the log's error line and the step summary say what it needs. That covers a token with no permission for the zone, the bucket, the database, the Worker, the DNS record, or the route.

| Skipped: needs                                                      | Checks                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a token permission for a rule, the bot settings, or the login       | the piece of the install that permission makes, and the checks behind it |
| the token permission Billing: Read                                  | the reading of the account's subscriptions, before anything is made      |
| Access switched on for the account                                  | `L1`                                                                     |
| an install that sends a private site's address to its letter p form | `L1`, `L4`, `L5`                                                         |
| a Worker route for the public word's hostnames                      | `public-name`, `demo`                                                    |
| a public site named `demo`, which the reset publishes               | `demo`                                                                   |
| a plan whose bot settings the API can change                        | `crawler`                                                                |
| the guard rule, the redirect rule, or the rate rule on the zone     | `L8-method`, `L8-scanner`, `L8-http`, `burst-rate-rule`                  |
| a run started by hand with the many-files check switched on         | `L10`: two thousand uploads, so not on every green main                  |
| a person in a browser                                               | `L2`, `L3`, `L4-in`, `L5b`, `L6`, `L7`, `L9`, `download`: the checklist below        |

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
| Billing: Read                                               | the account | reading that no subscription has a price          |

## The checklist a person makes

Before you start: Access is on for the test account, and the `POPLIN_LIVE_LOGIN` secret of the environment holds an email you can read. Run the workflow once, so the install lets that login in. Use a private browser window for every step that says logged out.

| Check   | Do                                                                                                                                                               | Look for                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| login   | Open the dashboard, logged out. Enter your email and the code Cloudflare sends.                                                                                  | Cloudflare's login page first, then the dashboard. An email that is no login gets no code that works.   |
| `setup` | On a Cloudflare account with no poplin, follow `docs/start/by-hand.md` from step 1 to step 5. Then open `/setup` on the dashboard and on the Worker's own address.     | Each step works as written: in step 2 the last button of the form deploys, and the page that opens has the `workers.dev` address at its top. The setup page lists the objects it made. After the first login, `/setup` answers 404 on both addresses.|
| `token` | Open the link "Make the token" on the setup page, or the one in step 3 of `docs/start/by-hand.md`, logged in to Cloudflare.                                            | The token form opens with the eight linked rights ticked.                                                                           |
| `eight-rights` | Install with the link's eight rights only: on a Cloudflare account with no poplin, make the token from that link, add nothing to it, and press Repair on the setup page. Log in, then publish a site and open it. | The notice counts what was repaired and names no failure. No row says failed. The redirect, guard, and rate rows say `optional`, each with the right that switches it on. So does the bot row, or `left out` on a domain with other hostnames. The login works and the site opens. |
| `http`  | Switch the redirect rule off in the zone's Redirect Rules, then run `curl -i http://<a site's address>` and the same on the admin hostname and the Worker's own address.                 | Status 308 and a `Location` that is the same address over `https`, from the Worker: its address reaches the Worker as `http`. Switch the rule on again. |
| `L3`    | Publish two private sites. Open the first, then the second.                                                                                                      | Both open. The second asks for nothing.                                                                 |
| `L2`    | Publish private site B. Publish private site A whose page shows B in an `iframe`. Open A in Chromium, Firefox, and Safari. Then open B directly and reload A.    | In each engine: whether B shows inside A before B was opened directly, and after. Write both down.      |
| `L4-in` | Publish an unlisted site and copy its address. Run `poplin set <label> --private`. Open the copied address logged out, then log in.                              | Logged out: the login, and no part of the page. Logged in: the site, at the address `set` printed.      |
| `L7`    | Add a second login on the dashboard. Log in as it in another browser and open a private site. Remove that login. Reload the site within a minute, then after it. | After a minute at most, the reload shows no page of the site.                                           |
| `L5b`   | In Zero Trust, delete the Access application named `poplin`. Open a private site logged out. Run the workflow again.                                             | Status 404 and no part of the page. After the workflow, the application is back and the login works.    |
| `L6`    | Reload a private page twenty times. Open the Worker's metrics in the Cloudflare dashboard.                                                                       | CPU time per request under 10 ms, the Free plan's limit.                                                |
| `L9`    | Open an unlisted site in Chromium, Firefox, and Safari. Publish new content to it. Reload within five minutes, then after.                                       | Which reload first shows the new version in each engine, and that no page mixes files of both versions. |
| `download` | On an install whose Activity holds more than 2,000 entries, press Download, then CSV. Open the Worker's metrics in the Cloudflare dashboard. | The file is named `poplin-activity-<date>-1.csv`, holds the heading and 2,000 entries, and ends with the line that says the log holds more. CPU time of that request under 10 ms, the Free plan's limit. |
| `copy`  | After `setup`, open the copy on GitHub, and the Worker's build settings in Cloudflare. Read the log of the first build. | The deploy command runs the `deploy` script of `package.json`. The log holds one line that starts with `poplin:`. Note what the copy's `wrangler.jsonc` holds that the repository's does not. |
| `update` | With a release of poplin published, follow "Update the install" in `docs/run/update.md` on the install of `setup`. Read the new build's log. | The log holds `poplin: deploying`, the release's version, and `(was asked for latest)`. The dashboard, its sites, and its settings are as before, and the account holds no second bucket or database. |
| `pin`   | Set the build variable `POPLIN_VERSION` to an older release's version and build again. Then set it to `v1` and build again. | The first log names the older version. The second build fails with one line that starts with `poplin:` and holds `Nothing was deployed`, and the install still answers. |
| `alerts` | With a token that also holds Notifications: Edit, apply the OpenTofu module once on the test account with `usage_alert_percents = [50, 90]`. Read the provider's list of available alerts for the account, at `/accounts/<account id>/alerting/v3/available_alerts`. | The apply makes six notification policies. The list names `billing_usage_alert`, with `r2_storage`, `r2_class_a_operations`, and `r2_class_b_operations` among its products. |

Delete the sites you published when you are done: `poplin delete <label> --forever`.
