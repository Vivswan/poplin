# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                                       | Needs                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./packages/providers/cloudflare/tests/live ./packages/providers/cloudflare/tests/scripts/live`                                                   | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                            | `POPLIN_LIVE_DOMAIN`, or `POPLIN_LIVE_ACCOUNT_ADDRESS` for an install without a domain, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the two test installs                       | the `Live Checks` and `Live Checks (account address)` workflows: after a push to main that reaches the install, or by hand | the `with-domain-ci-tests` and `without-domain-ci-tests` environments     |
| check that a build takes a release by its digest  | a release's own run of main, then the next one: `poplin-<version>.tar.gz` on the release's page, its digest under that version in the website's `releases.json`, and `poplin: deploying <version> (was asked for latest)` in an install's build | a published release |
| check that a release publishes its built Worker   | the same two runs: both `build the Worker` jobs green and the step that compares them; `poplin-<version>-worker.json`, `-worker.js`, and `-worker.js.map` on the release's page; `gh attestation verify` passes for each; `bundle` and `schema` beside `source` in `releases.json`, and `schema` in `latest.json` | a published release |

```text
Live Checks workflows, one for each kind of install
  the `paths` list of each workflow                         the files of the push -> a run of that kind, or none
  .github/workflows/live-install.yml                       the steps below, which both workflows call
  packages/providers/cloudflare/scripts/live/gate.ts       the `all-green` check of the commit's CI: it ended green, or the run stops red; a job after it stops nothing
  build the Worker bundle
  packages/providers/cloudflare/scripts/live/start-over.ts a run by hand with `start_over` ticked: everything poplin made, removed
  packages/providers/cloudflare/scripts/live/converge.ts   the account's plans, bucket, database, login, wrangler deploy, the Domain screen's repair, the caps
                                                           without a domain, in the repair's place: the two forwarders and the key
                                                           `Worker: deployed` in its log: Cloudflare took the built bundle and the source map beside it in one upload
                                                           `Key: created` or `Key: present` in its log: the Worker has its key as a secret, and Cloudflare lists an active token of the key's name
                                                           `Upload key: created` or `Upload key: present`: the same for the key that sends files straight to the bucket
  packages/providers/cloudflare/scripts/live/suite.ts      a token for the run -> bun test packages/providers/cloudflare/live/live.test.ts -> the token removed
  packages/providers/cloudflare/scripts/live/reset.ts      a token for the reset -> the install put back -> every token removed
  packages/providers/cloudflare/scripts/live/orphans.ts    after the reset: the files of the bucket no record of the database names, removed
  step summary                                             one table of the install's pieces, one of the checks, one of the reset
```

| Workflow                        | File                                                | Install                                  | Checks on the run                                             |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `Live Checks`                   | `.github/workflows/live-checks.yml`                 | on the account that holds a domain       | `live (domain) / checks`, `live (domain) / reset`             |
| `Live Checks (account address)` | `.github/workflows/live-checks-account-address.yml` | on the account that holds none           | `live (account address) / checks`, `live (account address) / reset` |

Each workflow runs the same steps on its own install. A push starts the one whose install its files reach, or both. One that fails stops no other.

## What starts a run

| A push to main that changed                                                                  | Deploy and checks |
| -------------------------------------------------------------------------------------------- | ----------------- |
| only files of an install with a domain                                                       | that install      |
| only files of an install without a domain                                                    | that install      |
| any other file of `packages/**`, tests included                                              | both installs     |
| `demo/**`, `packages/providers/cloudflare/live/**`                                                                   | both installs     |
| `wrangler.jsonc`, the root `package.json`, `bun.lock`, `.bun-version`, `tsconfig*`           | both installs     |
| `.github/workflows/live-install.yml`, `.github/actions/setup/**`, `.gitattributes`           | both installs     |
| the workflow file of one kind                                                                | that install      |
| a file no `!` line of either `paths` list names                                              | both installs     |
| only `website/**`, `docs/**`, `brand/**`, `skills/**`, `*.md` at the root                    | no run            |
| only the rest of `.github/**`, the root test guards, `tests/{fuzz,support}/**`               | no run            |
| only the settings of lint, review, hook, and release tools at the root                       | no run            |

| The files of one kind of install alone                                                                                                  | Kind             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `packages/providers/cloudflare/{src,tests}/with-domain/pieces/{bots,dns,routes}/**`                                                     | with a domain    |
| `guards.ts`, `rules.ts`, `waf.ts` of `packages/providers/cloudflare/src/with-domain/pieces/rules/`, and the tests of `guards` and `waf` | with a domain    |
| `packages/providers/cloudflare/{src,tests}/without-domain/pieces/forwarders/**`                                                         | without a domain |
| `packages/providers/cloudflare/src/without-domain/path-plug.ts` and its test                                                            | without a domain |

A file that code of both kinds imports is a file of both: `zone-plug.ts` is one, since the plug of an install without a domain is made of its pieces. `rules-follow.ts` beside the rules is another: every install's sweep reads it. So are the two files of a site's addresses, which the demo on every install runs, and every live check and script of `packages/providers/cloudflare/scripts/live`.

The `paths` list of each workflow holds every row: the two lists are the same, and each ends with the files of the other kind, taken out. `packages/providers/cloudflare/tests/live/workflow.test.ts` holds the two kinds' files once and reads both lists beside them.

The files are those of the one push, first commit to last. GitHub reads the first 3,000 changed files of a push, and a push of more than 1,000 commits always starts a run.

| Also                                                   | What happens                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| a run started by hand                                  | deploy and checks, with no wait for CI                               |
| a run started by hand with `start_over` ticked         | first removes everything poplin made there, then the same            |
| a push that starts no run                              | no row in the list of runs, and no tick on the commit                |
| the commit's `all-green` check did not end green       | a red run: nothing deployed, no call to Cloudflare                   |
| a run ended red                                        | it stays red until it is run again by hand, or a later push starts a run |
| a newer push while an older push's run of the same workflow has not started | that older run is cancelled, and the newer one deploys the commits of both pushes |
| 00:00 UTC                                              | deploy and checks of main, with the copy the install's job finishes, and the reset; each waits its turn and replaces no run |

The install is made from the commit of the push, the one whose `all-green` check ended green. Running a red run again makes the install from that same commit.

One job touches a test install at a time, of either kind. The checks and the midnight reset wait in one lane that keeps every waiting job, so neither takes the other's place.

## Start the test install over

On GitHub: Actions, the workflow of the install (`Live Checks`, or `Live Checks (account address)`), Run workflow, tick `start_over`, Run workflow.

The run removes the Worker, its Workflow, and its routes, poplin's DNS records, rules, two Access applications and their policies, the database, every file in the bucket, the budget alert, and the key. The bucket stays, and so does everything on the account that poplin did not make.

On the account without a domain it removes the two forwarders first, then the Access applications and their policies, the Workflow, the Worker, the database, every file in the bucket, and the key. A Worker of a forwarder's name without poplin's tag stays.

A kind the token has no permission for stays too, and a warning names the permission. The run then makes the install from nothing and puts the samples and the demo back.

## The test install

One install on the Cloudflare test account, called staging. It stays up between runs.

|             | Staging                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Runs        | the latest main that changed a file reaching it                                  |
| Who gets in | the owner alone, behind the login; a stranger opens the public and unlisted sample sites |
| Updated     | after a green main that changed such a file                                      |
| Put back    | after every run of the checks, whatever they came to, and at 00:00 UTC every day |

| A reset removes                               | A reset leaves                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| every site that is no sample and not the demo | the logins and every other setting                                                    |
| a sample that differs from its row, for good  | the Worker, the bucket, the database, and the zone's objects                          |
| every token, its own among them               | the sample sites below: one that still matches is kept, any other is published anew   |
| every login of a computer that waits          | the demo: a public site with the public name `demo`, updated where it stands          |
| the files of the bucket no record names       | the files of every site, of every upload, and of a removed site the install still empties |

| A sample is kept when                                      | It is published anew after                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| one site holds its name                                    | a rename, or a second site of that name                       |
| access, public name, typed title, and both switches match  | any of them changed on the dashboard, or in the table         |
| it is on its row's side of the trash, there for a day more | a move to the trash, or out of it, or under a day in it left  |
| it keeps its row's versions by their numbers, newest live  | a publish, a rollback, a dropped version, fewer versions kept |
| it never runs out, or does within its span and not today   | an expiry set or cleared, or less than a day left             |
| every version holds the folder's files, byte for byte      | a changed, added, renamed, or removed file, or a media type   |
| it stores the title of the folder's entry page             | another title in `index.html`                                 |

The demo's site is kept by the same rule, on its title, its expiry, and the files of its live version. A kept site costs no row of the database and no write or list of the bucket: its files are read, one request each.

| The sample sites a reset leaves | How many                                   |
| ------------------------------- | ------------------------------------------ |
| public                          | 2, and the demo                            |
| unlisted                        | 4: one runs out after 7 days, one after 30 |
| private                         | 4, one of them runs out after 2 days       |
| in the trash                    | 1                                          |
| with three versions             | 1; every other has one                     |

Each site, its title, and who opens it come from one table, `packages/demo/src/preview/sample-sites.ts`. The demo's seed plays its whole history, and the reset publishes what it ends in, so the install's Sites screen and the demo's list the same sites.

The demo is what `bun run demo:build` writes, at `demo-<public word>.<domain>`. The install serves its files, and the demo's worker answers every address inside it.

The reset writes `sites.json` beside the demo's files: the address of each sample site outside the trash. The demo's links to those sites then lead to the install's own: a public or unlisted one opens, a private one shows the login. No line of a run names an address.

The owner sets these. Each test account has its own environment, and the secrets carry the same names in both. `live-install.yml` declares each name and each workflow hands those names over; the value a step reads is the secret of its job's environment.

| Environment               | Its secrets are of                    | Read by                    |
| ------------------------- | ------------------------------------- | -------------------------- |
| `with-domain-ci-tests`    | the test account that holds a domain  | the `Live Checks` workflow |
| `without-domain-ci-tests` | the test account that holds no domain | the `Live Checks (account address)` workflow |

For each account:

| Set                     | Where                        | For                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| R2 switched on          | the Cloudflare account       | the bucket                                                                |
| Zero Trust switched on  | the Cloudflare account       | the login                                                                 |
| `CLOUDFLARE_API_TOKEN`  | a secret of the environment  | every step that calls Cloudflare                                          |
| `CLOUDFLARE_ACCOUNT_ID` | a secret of the environment  | the same                                                                  |
| `POPLIN_LIVE_LOGIN`     | a secret of the environment  | the login the install lets in                                             |
| `DEMO_URL`              | a variable of the repository | the demo's whole https address, for the website; absent, it shows no link |

## The test install without a domain

A second install, on the test account that holds no domain. It answers on the account's free address, stays up between runs, and is put back by the same reset.

| What                    | Where it answers                                 |
| ----------------------- | ------------------------------------------------ |
| the dashboard, the API  | `poplin.<account>.workers.dev`                   |
| a private site          | `poplin-private.<account>.workers.dev/<label>/`  |
| any other site          | `poplin-sites.<account>.workers.dev/<label>/`    |
| the demo                | `poplin-sites.<account>.workers.dev/demo/`       |

| Step of `converge.ts`   | Made by                                                                  | A line of its log                                           |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| the free address        | read from Cloudflare, never written in the repository                    | `Free address: found`                                       |
| plans, bucket, database | as on the other account, with no zone to read                            | `R2 bucket: present`                                        |
| the login               | `syncAccess`: the whole dashboard host, and the whole private sites' host | `Login application: created 0, changed 0, left 4, not poplin's 0` |
| the Worker              | `wrangler deploy`, with `ZONE` set to the account's name and the free address on | `Worker: deployed`                                  |
| the two forwarders      | `syncForwarders`                                                         | `Forwarders: created 0, changed 0, left 2, not poplin's 0`  |
| the key                 | `mintKey` and `syncVariables`, where the Worker holds no active key      | `Key: present`                                              |
| the Workflow            | `syncJobs`, where the deploy left none                                   | `Workflow: present`                                         |

A step Cloudflare refuses prints the step, the status, and the error codes, and nothing else Cloudflare said:

```text
Forwarders: stopped at poplin-sites: Cloudflare refused with status 400 and codes 10021
```

| Differs from the other install                                   | So                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| no zone: no redirect rule, guard rule, rate rule, or bot switch  | `L8-method`, `L8-scanner`, `L8-http`, `crawler`, `assistant-fetch`, `burst-rate-rule` are skipped: needs a domain |
| a site answers under a path                                      | `relative-file` also asks the address without its last slash, which moves to the one with it |
| a site's address is no root of an origin                         | the demo gets no link to a sample site: `sites.json` is empty                   |
| no budget alert                                                  | none is made, and a start-over removes none                                     |

Every other check runs on both installs, at the addresses of each one's layout. No run logs in: the checks of a person stay skipped on both.

## The files no record names

The install finds a site's files by a record of its database. A run that makes the database anew drops every record, and the files of the database before it stay in the bucket. The reset removes them when it has put the install back.

| A folder of the bucket                                    | The reset                      |
| --------------------------------------------------------- | ------------------------------ |
| of a site, in the trash or not                            | leaves it                      |
| of an upload, on its way, given up, or finished           | leaves it                      |
| of a removed site whose files the install still removes   | leaves it                      |
| that no such record names                                 | removes its files, one a call  |
| a key that starts with no folder of a site                | leaves it                      |

One run lists the bucket, a thousand files a call, and removes at most what its 300 lists and deletes reach. R2 counts a list with the writes and bills no delete. What is left waits for the next run, the midnight reset among them.

It acts on a test account alone, as the start-over does, and on the bucket of the run's own install: each of the two installs has its own bucket, guard, and ceiling.

```text
Files no site owns: removed 4 folders and 298 objects, 21 folders and 1457 objects remain
Bucket lists and deletes for them: 300 of at most 300
```

## What keeps the test account at no cost

Each account has its own allowances, and every ceiling below holds for each install by itself.


| Guard                                                                                  | Where                                         | At the limit                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| the zone's plan is Free, where the account holds a zone, and every subscription of the account that has not ended is at a price of 0 | `plan.ts`, before anything is made | the run stops red |
| a budget alert at 1 US dollar of usage charges, to the run's login | the repair, with the token permission Notifications: Edit | Cloudflare emails the login. Nothing is stopped |
| caps: 200MB stored, 20MB a site, 100 sites, 2,500 files a publish, 5,000 files a day   | `caps.ts`, on every run, once the install answers | the install refuses the publish                           |
| bucket writes and lists: 150 by the checks, 300 by the midnight run's, 2,300 with the many-files check, 150 by a reset | `budget.ts`, around every request to the install | the request is not sent, and the step stops red       |
| bucket lists and deletes: 300 together by the removal of the files no record names | `orphans.ts`, around every call to Cloudflare for the bucket | the removal stops, and the next run goes on |
| rows written to the database: 1,100 by the checks, 600 by a reset | `rows.ts`, around every request to the install | the request is not sent, and the step stops red |
| every site the checks make is removed for good                                         | the checks' own sweep, then the reset         | the reset runs after failed checks too                        |
| a site of a run that was killed                                                        | published with `--expires 1d`, trash of one day | the midnight reset removes it                               |
| the sample sites and the demo: 12 sites, 120 files, and 4 MB at most                   | `caps.test.ts`, from a reset of a local fake  | the self-test fails                                           |

A token without Billing: Read cannot read the subscriptions: the run goes on, with a warning and a skipped row. The zone's plan is checked all the same.

No name of a plan is read. Cloudflare lists the storage as a paid plan at a price of 0, and leaves the Workers plan out while it is Free. A subscription with no price stops the run like one with a price. The log holds one line of counts:

```text
Account plans: free (2 subscriptions: 2 at a price of 0, 0 ended)
```

```text
one run, at its ceilings         2 (the bucket found or made) + 150 (checks) + 150 (reset) + 301 (the files no record names, were every call a list) = 603 bucket writes and lists
the midnight run, at its ceilings  2 + 300 (checks, with the copy the install's job finishes) + 150 (reset) + 301 = 753, and 113 writes by the job itself
a day of 40 such runs            40 x 603 + 753 + 113 + 451 (the midnight reset) = 25,437
31 such days                     25,437 x 31 = 788,547 of the 1,000,000 R2 takes for free in a month
with a bucket of 2,000 files     3 in place of the 301: 305 a run, 12,921 a day, 400,551 a month
a run with the many-files check  2 + 2,300 + 150 + 301 = 2,753, started by hand alone
a usual run                      about 97 (checks) + 0 (a reset that keeps every sample and the demo) + 2 (the bucket found, and listed once)
the midnight run                 about 218 (checks): the copy's 113 files published, and the asks after its job
a reset that keeps nothing       about 131
either install                   the same sums, each against the 1,000,000 of its own account
the files no record names        the bucket found, and 1 list for every thousand files it holds; a delete is free, and counted against the 300 all the same
```

A run starts after a green main that changed a file reaching the install, at midnight, or by hand, so 40 a day is far above what happens. The count is the harness's own, one for each request that makes the install write or list; the install lists once more for every thousand files.

The copy the install's job finishes is a site of 113 files: one more than the first request of a copy takes. It costs a run 226 files of the day and over two hundred bucket writes, so the midnight run alone makes it, and a run started by hand with the many-files check.

```text
burst-rate-rule, usual   about 850 requests to the Worker: the rule blocks a few seconds after one data center passed 300
burst-rate-rule, worst   340 (burst) + 800 (paced, 12 ms apart) = 1,140: no block, and no data center past 300 for 5 seconds
own-limit                about 700
backup-drill             69, of which 34 make the install write to its bucket or list it
a run, at its worst      1,140 + 700 + 64 = 1,904
the plan's day           100,000 requests to the Worker, reached at about 52 such runs
```

The runs of one day must stay under the plan's 100,000 requests to the Worker. The other checks send a few dozen more, and a reset that keeps the samples reads each of their files, about 130 requests.

```text
the install without a domain
a run, at its worst      700 (own-limit) + 69 (backup-drill) = 769: no rate rule stands in front of it, so no burst is sent
a usual run              about 125 (own-limit, which ends at the first 429) + 69 + about 130 (the reset) and a few dozen more
a day of 45 runs         45 x 769 = 34,605 of its own account's 100,000
a request for a site     one request of a forwarder, which hands it to the Worker at no further request, by Cloudflare's documentation
```

## The rows a run writes

The database's free plan takes 100,000 rows written a day, every database of the account together. Past them it refuses each write until midnight UTC, and every run of that day fails.

| One request of a run                      | Rows, at most | Which are                                                                  |
| ----------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| a new site, from its begin to its finish  | 19            | the site 8, the upload 6, the day's counts 2, the version 2, the log 1     |
| a new site not told never to run out      | 20            | its entry in the index of expiries; one that names no expiry may take the install's |
| a new version that drops no older one     | 13            | 17 where it drops one, and 2 for each further one it drops                 |
| a new version that asks settings of its site |            | and what those settings cost as a change of the site, below                |
| a site put back from a backup             | 19            | 2 for each version more, and 1 where it runs out                           |
| a site removed for good                   | 13            | with three versions and a day's count; 6 to the trash, 6 out of it         |
| a change of who may open a site           | 3             | any other setting 2, both at once 5, and 1 where it is told an expiry      |
| a new link                                | 9             | a rollback 2, a setting of the install 3, a computer's login 3             |
| a copy of a site                          | 21            | counted at the request that begins it; 16 for each request that goes on    |
| a copy the install's job finishes         | 21            | none for an ask while the job copies; 16 and 1 for each round of the job, with the answer that names the site |
| a listing of the bucket                   | 1             | the files of a version, and what an upload lacks                           |
| a page or a file a site answered          | 2             | the day's count of the site, and of all sites                              |

The database counts an index entry and a row a trigger writes as rows, so the one row of a new site is 8. `rows.ts` holds the prices, and a test in the Workers pool sends each kind of request to a Worker on D1 and compares the two counts.

A product change that moves a row cost turns that test red, with the database's count beside the harness's for each kind of request.

| To measure the prices again | Then |
| --- | --- |
| `bun run --cwd packages/providers/cloudflare build`, then `bunx vitest run tests/shared/worker/worker.test.ts -t "the rows the live checks count"` there | set each price in `rows.ts` to the first number of its pair, and the pair in the test |
| `bun test ./packages/providers/cloudflare/tests/live ./packages/providers/cloudflare/tests/scripts/live` | set the totals it prints in `self.test.ts` and `reset.test.ts`, and the figures below |

```text
the checks, as the harness counts them   866 on the local fake, a few more with the demo's check: every site they publish, change, and remove
the midnight run's checks                959: the copy the install's job finishes, 93 more
a reset that keeps every sample          38: the trashed sample, published and trashed anew while the suite's trash holds a site for one day
a reset that keeps none                  about 390
the harness's own statements             18: three tokens in and out, and the caps
a usual run                              about 922 counted; the sweep later drops each upload's row, 5 a publish, about 135 more
a day of 40 such runs                    about 42,000 of the 100,000
```

The install without a domain writes to the database of its own account: the same checks, the same ceilings, a count line of its own in each step of its workflow, and its own 100,000 a day.

The harness's count is the most each request writes for a site a run made, so it runs a little above the database's own. A refusal or a missing file of a served site writes two rows the count leaves out. Each step prints its count:

```text
Rows written this run: 866 of at most 1100
```

## The backup drill

`backup-drill` proves that a backup restores: what is exported, removed, and put back is exported again, and the two backups are compared.

| Step     | On the install                                                                                |
| -------- | --------------------------------------------------------------------------------------------- |
| make     | 3 sites of its own: private with three versions, the second live; unlisted, renamed; public   |
| export   | each of the three with every version, a zip a site                                            |
| remove   | each of the three, for good                                                                   |
| import   | each zip                                                                                      |
| export   | each of the three again                                                                       |
| compare  | each second zip with its first, in `packages/providers/cloudflare/live/compare-backups.ts`; one visit opens a site    |
| clean up | each of the three removed for good, after a failure too                                       |

It never reads or changes a sample site: every export and every import names one site of its own.

| The compare passes over      | Which is                    |
| ---------------------------- | --------------------------- |
| `made_at` of `manifest.json` | the moment the zip was made |

Anything else that is not the same fails the check, with its place in the backup and what both backups hold there. A file is printed as its length and its SHA-256, never as its bytes.

```text
backup-drill: 3 sites, 5 files, 119 bytes put back and exported the same; passed over made_at of manifest.json; <milliseconds> ms
```

The line holds no name and no address. One drill is 69 requests when none is sent again.

## The check of the way a file goes

`direct-upload` watches the run's first publish, of one page, and says which way its file went. It publishes nothing of its own.

| The file went | The run knows | The check |
| --- | --- | --- |
| straight to the bucket | anything | passes: `the upload key is used` |
| through the install | the install holds no upload key | passes, and says so |
| through the install | this run made the key | passes: the bucket takes a key two and a half minutes after it is made |
| through the install, or refused by the bucket first | the key was there before the run | fails |

The first run after a key is made sends its files through the install: that is a pass. The line holds no address and no part of a key.

## The check of the users

`users-follow` proves that a change of the users reaches Cloudflare's login list by itself, with the key the install keeps and no Repair.

| Step   | On the install                                               | Then, at Cloudflare                                     |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------- |
| add    | `poplin config logins` with one more email, at `example.com` | the policy `poplin logins` names the email within 20 s  |
| remove | `poplin config logins` with the list as it was               | the policy names the same emails as before              |

The list is read with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The email is taken out again whatever the check met.

## The check of an assistant's page

`crawler` sends the user agent of a crawler that reads sites in bulk, which the bot switches stop. `assistant-fetch` sends the user agents of two assistants that open one page when their user asks for it, which they do not stop.

| The edge answered | The line says | Result |
| ----------------- | ------------- | ------ |
| 403               | `stopped`     | failed |
| anything else     | `let through` | passed |

```text
assistant-fetch: ChatGPT-User let through (302), Perplexity-User let through (302); a run is no verified bot, so the bot switches answered, and the bots rule's pass for a verified assistant is held by the test of its expression
```

| What stands at the edge                | Reads                                       | Proved by                                                    |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| the bot switches, as `block_bots` says | the user agent, of any address              | `crawler` and `assistant-fetch`                              |
| the bots rule                          | the kind of a bot Cloudflare has verified   | the test of the rule's expression, in the provider package   |

A run's requests come from no address Cloudflare has verified, so the bots rule reads none of them. The check is 2 requests where none is sent again, and no write to the bucket or the database.

## The check of the rate rule

Cloudflare counts the rate rule in each data center for itself, and each address for itself. `burst-rate-rule` counts the same way, from the data center each answer names and the addresses the edge says it saw.

| The run met                                                                     | Result  |
| ------------------------------------------------------------------------------- | ------- |
| a 429 of the rate rule                                                          | passed  |
| no block, and the edge saw the runner at more than one address                  | skipped |
| no block, and one data center held more than 300 in ten seconds for 5 seconds   | failed  |
| no block, and no data center stayed past 300 that long                          | skipped |

Each result comes with one line: the requests, the time, each answer's count, each data center's count, and how many addresses the edge saw. It never holds an address.

## A request that is cut off

The edge closes a connection it kept open, and a request sent on it then gets no answer. A client sends a read again by itself, and no other request. So every request of a run that is no read opens a connection of its own, in `send.ts`; reads keep the open ones.

The edge's rules block with an answer: a 403. A stranger's request whose connection closes before any answer says nothing of a rule or of the install. The run sends it once more and reads the second answer, and the log holds one line for it. A request that is cut off twice reaches its check as cut off, and so does a change asked of the API, which is never sent twice.

```text
a stranger's request was cut off before any answer, and was sent once more
```

## What a run skips

A check that cannot run is written to the step summary as skipped, with what it needs, and to the log as a warning. It never fails the run.

A run that cannot make the install answer, or cannot start the checks, fails: the log's error line and the step summary say what it needs. That covers a token with no permission for the zone, the bucket, the database, the Worker, the DNS record, or the route.

| Skipped: needs                                                      | Checks                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a token permission for a rule, the bot settings, the login, or the key | the piece of the install that permission makes, and the checks behind it |
| the token permission Billing: Read                                  | the reading of the account's subscriptions, before anything is made      |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`                  | `users-follow`, `duplicate-job`                                          |
| the Worker's Workflow, which Cloudflare did not make                | `duplicate-job`                                                          |
| the midnight run, or a run started by hand with the many-files check | `duplicate-job`: a copy of 113 files, so once a day and not on every green main |
| Access switched on for the account                                  | `L1`, `dashboard-login`: the edge's own redirect to the team's login from every path of the dashboard, and its own 401 to a script's call; `users-follow`: no login list exists |
| an install that sends a private site's address to its letter p form | `L1`, `L4`, `L5`                                                         |
| a Worker route for the public word's hostnames                      | `public-name`, `demo`                                                    |
| a public site named `demo`, which the reset publishes               | `demo`                                                                   |
| a plan whose bot settings the API can change                        | `crawler`, `assistant-fetch`                                             |
| the guard rule, the redirect rule, or the rate rule on the zone     | `L8-method`, `L8-scanner`, `L8-http`, `burst-rate-rule`                  |
| one data center that takes more than 300 of the runner's requests in ten seconds | `burst-rate-rule`                                           |
| a runner whose requests leave from one address                      | `burst-rate-rule`                                                        |
| a run started by hand with the many-files check switched on         | `L10`: two thousand uploads, so not on every green main                  |
| a person in a browser                                               | `L2`, `L3`, `L4-in`, `L5b`, `L6`, `L7`, `L9`, `download`: the checklist below        |
| a domain                                                            | on the install without one: `L8-method`, `L8-scanner`, `L8-http`, `crawler`, `assistant-fetch`, `burst-rate-rule` |

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
| Billing: Read                                               | the account | reading that every subscription is at a price of 0 |
| Notifications: Edit                                         | the account | the budget alert                                  |
| Account API Tokens: Edit                                    | the account | the two keys the install keeps                    |

The token of the account without a domain needs the rows whose scope is the account, without Notifications: Edit, and none of the zone. Workers Scripts: Edit also reads the account's free address and makes the two forwarders.

## What one request costs

No live check reads what a request cost: no address of an install answers it, to a visitor or to a token.

| What                                                        | Where it is held                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| the database queries, rows, and storage calls of a request  | `packages/providers/cloudflare/tests/shared/worker/request-budget.test.ts`: every route on the local Workers runtime, through the driver the deployed Worker uses  |
| the processing time of a request                            | the checks `L6` and `download` below, by hand: Cloudflare shows it in the Worker's metrics alone, and the local runtime reports none              |

The test's `About ms` column is time by the clock, the local database and storage included. It is no measure of processing time, and no test fails on it.

## The checklist a person makes

Before you start: Access is on for the test account, and the `POPLIN_LIVE_LOGIN` secret of the environment holds an email you can read. Run the workflow once, so the install lets that login in. Use a private browser window for every step that says logged out.

| Check   | Do                                                                                                                                                               | Look for                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| login   | Open the dashboard, logged out. Enter your email and the code Cloudflare sends.                                                                                  | Cloudflare's login page first, then the dashboard. An email that is no login gets no code that works.   |
| `login-free` | On the install without a domain, once after its first run: open a private sample site at its address under `poplin-private`, logged out, and log in. Then open the dashboard's address. | Cloudflare's login page first, then the site's page. The dashboard opens after a login, and lists the sample sites. |
| `setup` | On a Cloudflare account with no poplin, follow `docs/start/by-hand.md` from step 1 to step 5. Then open `/setup` on the dashboard and on the Worker's own address.     | Each step works as written: in step 2 the last button of the form deploys, and the page that opens has the `workers.dev` address at its top. The setup page lists the objects it made. After the first login, `/setup` answers on both addresses with the token's box alone.|
| `token` | Open the link "Make the token" on the setup page, or the one in step 3 of `docs/start/by-hand.md`, logged in to Cloudflare.                                            | The token form opens with the nine linked rights ticked.                                                                           |
| `link-rights` | Install with the link's nine rights only: on a Cloudflare account with no poplin, make the token from that link, add nothing to it, and press Repair on the setup page. Log in, then publish a site and open it. | The notice counts what was repaired and names no failure. No row says failed. The redirect, guard, and rate rows say `optional`, each with the right that switches it on. So does the bot row, or `left out` on a domain with other hostnames. The login works and the site opens. |
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
| `update` | With a release of poplin published, follow "Update the install" in `docs/upkeep/update.md` on the install of `setup`. Read the new build's log. | The log holds `poplin: deploying`, the release's version, and `(was asked for latest)`. The dashboard, its sites, and its settings are as before, and the account holds no second bucket or database. |
| `self-update` | With two releases of poplin published, deploy the older one on an install that holds its key, and publish a private and a public site. Press Update now on the dashboard. Then open the Worker's settings and its Deployments in the Cloudflare dashboard. | The foot of the side names the newer version, and Activity says `Started an update`. Both sites answer as before. The Worker has every variable it had, its secret `KEPT_KEY`, the same cron trigger, and its logs switched on. The newest deployment's message is `poplin <version>, by its own update`. A run of the workflow cannot prove this: the test install runs the main branch, never a release. |
| `pin`   | Set the build variable `POPLIN_VERSION` to an older release's version and build again. Then set it to `v1` and build again. | The first log names the older version. The second build fails with one line that starts with `poplin:` and holds `Nothing was deployed`, and the install still answers. |
| `alerts` | With a token that also holds Notifications: Edit, run the workflow. Then open Notifications in the Cloudflare dashboard. | The list holds `poplin: usage charges reached 1 dollar`, sent to the login. |

Delete the sites you published when you are done: `poplin delete <label> --no-trash`.
