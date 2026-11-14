# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                            | Needs                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./tests/live`                                        | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                 | `POPLIN_LIVE_DOMAIN`, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the test install                            | the `Live Checks` workflow: after every green main, or by hand | the `cloudflare-live-tests` environment                                   |

```text
Live Checks workflow
  build the Worker bundle
  packages/cloudflare/scripts/live/converge.ts   bucket, database, login, wrangler deploy, the Domain tab's repair
  packages/cloudflare/scripts/live/suite.ts      a token for the run -> bun test tests/live/live.test.ts -> the token removed
  step summary                                   one table of the install's pieces, one of the checks
```

The test install stays up between runs. A run removes what it made: every site whose name starts with `live-`, and its own token row. A site of a run that was killed expires after a day, and its token row after an hour.

## What a run skips

A check that cannot run is written to the step summary as skipped, with what it needs, and to the log as a warning. It never fails the run.

A run that cannot make the install answer, or cannot start the checks, fails: the log's error line and the step summary say what it needs. That covers a token with no permission for the zone, the bucket, the database, the Worker, the DNS record, or the route.

| Skipped: needs                                                      | Checks                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a token permission for a rule, the bot settings, or the login       | the piece of the install that permission makes, and the checks behind it |
| Access switched on for the account                                  | `L1`                                                                     |
| an install that sends a private site's address to its letter p form | `L1`, `L4`, `L5`                                                         |
| a Worker route for the public word's hostnames                      | `public-name`                                                            |
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

Delete the sites you published when you are done: `poplin delete <label> --forever`.
