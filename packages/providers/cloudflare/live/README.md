# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                                       | Needs                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./packages/providers/cloudflare/tests/live ./packages/providers/cloudflare/tests/scripts`                                                        | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                            | `POPLIN_LIVE_DOMAIN`, or `POPLIN_LIVE_ACCOUNT_ADDRESS` for an install without a domain, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the two test installs                       | the `Live Checks` and `Live Checks (account address)` workflows: after a push to main that reaches the install, or by hand | the `with-domain-ci-tests` and `without-domain-ci-tests` environments     |
| check that an install of the older build updates to main | the same two workflows, by hand, with `upgrade` ticked: [The upgrade](#the-upgrade) | the same environments |
| check that an install of the last release updates to the next one | the pull request of a release: the checks `live upgrade (domain)` and `live upgrade (account address)` of its `Release Live Upgrade` run | the same environments |
| check that a release publishes its built Worker   | a release's own run of main, then the `Release Feed` run that follows it: both `build the Worker` jobs green and the step that compares them; `poplin-<version>-worker.json`, `-worker.js`, and `-worker.js.map` on the release's page; `gh attestation verify` passes for each; `bundle` and `schema` under that version in the website's `releases.json`, and `schema` in `latest.json` | a published release |

```text
Live Checks workflows, one for each kind of install
  the `paths` list of each workflow                         the files of the push -> a run of that kind, or none
  .github/workflows/live-install.yml                       the steps below, which both workflows call
  packages/providers/cloudflare/scripts/live/gate.ts       the `all-green` check of the commit's CI: it ended green, or the run stops red; a job after it stops nothing
  build the Worker bundle
  packages/providers/cloudflare/scripts/live/converge.ts   the account's plans, then the install made to match the commit by the product's own commands, the caps
                                                           `poplin install` where the account holds no install; the commit's build by the upload of an update, then `poplin doctor --repair`, where it holds one
                                                           `poplin uninstall` first, on a run by hand with `start_over` ticked, and where another build made the install
  packages/providers/cloudflare/scripts/live/commands.ts   the three commands run in the step's own process, each answered with the commit's build where it asks for the newest release
                                                           `Install: none found, so poplin install ran` in the log: the bucket, the database, and the Worker's first upload are the command's
                                                           `Install: found, runs <version>`: the command found the install, and read its version from Cloudflare
                                                           `Sweep: last asked for a newer version <n> minutes ago`: the install's sweep trigger fires, since its sweep alone writes that moment
                                                           `Key: made` or `Key: left` in its log: the Worker has its key as a secret, and Cloudflare lists an active token of the key's name
                                                           `Upload key: made` or `Upload key: left`: the same for the key that sends files straight to the bucket
                                                           `New deployment: answered the run's token` in its log: the install answered a token whose row the database of this run's install holds, so the checks may start
  packages/providers/cloudflare/scripts/live/suite.ts      a token for the run -> bun test packages/providers/cloudflare/live/live.test.ts -> the token removed
  packages/providers/cloudflare/scripts/live/reset.ts      a token for the reset -> the install put back -> every token removed
  packages/providers/cloudflare/scripts/live/orphans.ts    after the reset: the files of the bucket no record of the database names, removed
  step summary                                             one table of the install's pieces, one of the checks, one of the reset
```

| Workflow                        | File                                                | Install                                  | Checks on the run                                             |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `Live Checks`                   | `.github/workflows/live-checks.yml`                 | on the account that holds a domain       | `live (domain) / checks`, `live (domain) / reset`, and by hand `live (domain) / upgrade` first |
| `Live Checks (account address)` | `.github/workflows/live-checks-account-address.yml` | on the account that holds none           | `live (account address) / checks`, `live (account address) / reset`, and by hand `live (account address) / upgrade` first |

Each workflow runs the same steps on its own install. A push starts the one whose install its files reach, or both. One that fails stops no other.

## What starts a run

| A push to main that changed                                                                  | Deploy and checks |
| -------------------------------------------------------------------------------------------- | ----------------- |
| only files of an install with a domain                                                       | that install      |
| only files of an install without a domain                                                    | that install      |
| any other file of `packages/**` that is no `.md` page, tests included                        | both installs     |
| any file of `demo/**` or `packages/providers/cloudflare/live/**` that is no `.md` page                               | both installs     |
| `wrangler.jsonc`, the root `package.json`, `bun.lock`, `.bun-version`, `tsconfig*`           | both installs     |
| `.github/workflows/live-install.yml`, `.github/actions/setup/**`, `.gitattributes`           | both installs     |
| the workflow file of one kind                                                                | that install      |
| a file no `!` line of either `paths` list names                                              | both installs     |
| only `website/**`, `docs/**`, `brand/**`, `skills/**`, a `.md` page in any folder            | no run            |
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
| a run started by hand with `start_over` ticked         | first removes the install with `poplin uninstall`, then the same     |
| a run started by hand with `upgrade` ticked            | first the job `upgrade`, then deploy and checks, whatever the upgrade came to |
| a run started by hand with `load` ticked               | the same, and [the load](#the-load) after the checks                 |
| a push that starts no run                              | no row in the list of runs, and no tick on the commit                |
| the commit's `all-green` check did not end green       | a red run: nothing deployed, no call to Cloudflare                   |
| a run ended red                                        | it stays red until it is run again by hand, or a later push starts a run |
| a newer push while an older push's run of the same workflow has not started | that older run is cancelled, and the newer one deploys the commits of both pushes |
| 00:00 UTC                                              | deploy and checks of main, with the copy the install's job finishes, and the reset; each waits its turn and replaces no run |
| a run of the other kind at the same time               | both go on side by side: each kind has an account and a lane of its own |

The install is made from the commit of the push, the one whose `all-green` check ended green. Running a red run again makes the install from that same commit.

One job touches a test install at a time. Each kind has a lane of its own, since the two installs are on two accounts: a run of one kind never waits for the other, and the two run side by side. Inside a lane the checks and the midnight reset each wait their turn, and every waiting job is kept.

## Start the test install over

On GitHub: Actions, the workflow of the install (`Live Checks`, or `Live Checks (account address)`), Run workflow, tick `start_over`, Run workflow.

```text
tick start_over -> poplin uninstall --dry-run -> poplin uninstall --confirm <what the dry run named>
                -> poplin install -> the checks -> the samples and the demo put back
```

The step that makes the install match the commit removes it first, with the product's own command, the sites' files and the database with it. It removes what `poplin uninstall` removes and nothing else: `docs/upkeep/remove.md` lists it.

| Stays on the account                                         | Why                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| the bucket `poplin-live-sites`                               | it marks a test account, and the command does not know it  |
| everything poplin did not make, and the zone's bot switches  | the command removes its own objects alone                  |
| a kind whose row says `stopped`, `failed`, or `not run`      | the run ends red and names it; the next start-over goes on |

The same removal runs with nobody asking where another build made the install, since `poplin install` and the repair leave such a thing as it is:

| What stands                                                              | The log says                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| a database with a schema step another build applied                      | `Start over: another build made it: a database that held schema step 1 as another build applied it` |
| a database with a schema step this commit lacks                          | `Start over: another build made it: a database that held a schema step this commit does not have` |
| a database whose settings this commit does not read                      | `Start over: another build made it: a database that held settings this commit does not read` |
| a Worker bound to another bucket than `poplin-sites`                     | `Start over: another build made it: a Worker bound to another bucket than the product's` |
| a Worker of an install that was started and never finished               | `Start over: another build made it: a Worker of an install that was never finished` |

On an account without the marking bucket the step makes, mends, and removes nothing: it stops red before its first command.

## The upgrade

An install the older build made and filled takes the run's build as an update, and is asked again for everything it held. The build it takes holds one schema step more than the product, so the install applies a step to its filled database. It runs on each of the two test installs.

| Started by | The build the install is updated to | Then |
| ---------- | ----------------------------------- | ---- |
| hand: Actions, the workflow of the install, Run workflow on `main`, tick `upgrade` | the build of main | the job `checks`, whatever the upgrade came to |
| the pull request of a release, once its checks are approved to run | the release as it would merge: the pull request's merge commit | the job `put back`, whatever the upgrade came to: [the put-back](#the-put-back-after-the-upgrade-of-a-release) |

Both run the job `upgrade` of `.github/workflows/live-upgrade.yml`, in the lane of the kind's live checks, so an upgrade and a run of main never touch one install together.

```text
job upgrade
  scripts/upgrade/older-build.ts   the older build in a folder of its own, its packages installed, its Worker built: no secret reaches this step
                                   this checkout told one patch above the older build's version and given the later step, then built
  scripts/upgrade/upgrade.ts       a test account alone -> the older build's own poplin uninstall and poplin install
                                   -> the older build's command line: 3 sites, a second version, a setting, a user; a token of its making
                                   -> the older build's own start of an update, fed the build of main as a release
                                   -> the Worker of the new build starts, and applies the later step to the filled database
                                   -> the install says the new version 12 times in a row -> one more site published -> one line a check
                                   -> the settings put back, the sites and the token's row removed
job checks                         by hand alone: its checkout holds no later step, so the install is started over, then every live check, the samples
```

| The older build                              | Is                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| once a release is among the ancestors of main | the highest `vX.Y.Z` tag                                                                 |
| before the first release                     | the commit `STAND_IN` of `older-build.ts`, which npm holds as a pre-release of the command |

The stand-in moves forward whenever the first schema step or a stored shape is edited in place: main takes over an install of the same step and settings row alone.

A pre-release on npm is the command alone: no built Worker and no line of the website's `releases.json` exists for one. So the Worker of the older build is built from its commit, and its own harness installs it.

| Check        | Holds when                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `Version`    | the install says the version the build of main was published under                                           |
| `Sites`      | each site is shown to its holder as before, a stranger is answered the same status, bytes, and media type, and a backup of it holds the same files in every version |
| `Token`      | the token made before the update read every site, the settings, and the log                                  |
| `Settings`   | every setting is as before, the changed one and the added user among them                                    |
| `Activity`   | every entry from before is there, and one `update_started` entry names both versions                         |
| `Database`   | core's own reading says every step of the build is marked with the build's fingerprint, the later step among them |
| `Later step` | its table, column, and index are there; each site from before holds its label and its row; the site published after holds the default and no row |
| `Publish`    | a site published after the update is shown to its holder, answered to a stranger as the unlisted one from before, and held by a backup with the page it was published with |
| `Doctor`     | `poplin doctor --repair --dry-run` would change nothing, once the two settings were put back                 |
| `Going back` | no version is offered: the update changed the database, which the version before cannot read                 |
| `Cleanup`    | the two settings were put back, and the sites and the token's row removed                                    |

```text
Older install: made by the older build's own poplin install, which says the version 0.0.0
Older install: filled with 3 sites, a second version, a setting, and a user
Update: the older build took 0.0.1 over 0.0.0, by its own start of an update
Bucket writes and lists the upgrade asked for: 23 of at most 40
Rows written this run: 212 of at most 300, 22 of them for the later step
Version: runs 0.0.1, and ran 0.0.0
Sites: 3 are shown, answered to a stranger, and stored in every version as before the update, byte for byte
Database: the 2 schema steps of this commit's build are marked as it applies them, step 0002 among them
Later step: the table, the column, and the index of step 0002 are there, and the 3 sites hold what it filled from them
Going back: not offered: the update changed the database, which the version before cannot read
Cleanup: the two settings put back, the sites and the token's row removed
```

A check that fails says `FAILED` and what differs, by a site's place and access or a setting's key: never a name, an address, or a value.

| What the start of the update is                  | Whose                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| the release picked, its files fetched and checked | the older build's code                                            |
| the `update_started` entry, the upload            | the older build's code, over the database's API                   |
| the key the upload is sent with                   | the run's token, where a deployed install uses the key it keeps   |
| the release                                       | the build of main, answered in the run's own process              |
| the count of starts a minute                      | left out: a binding of the Worker keeps it                        |

A deployed Worker reads releases from the project's website alone, which names no build of a commit. So no run shows a deployed Worker that fetches a release and uploads itself with its kept key: the `self-update` row of the checklist does, once two releases are out.

```text
the upgrade, as the harness counts it   212 rows and 23 bucket writes and lists on the local fake, of at most 300 and 40
of those, the later step                22 rows: 14 as it runs (5 for its mark, table, column, and index, and 3 for each of the 3 sites, as the Workers pool's database counts them)
                                        and 8 after it: 2 as each of the 3 sites is removed, and 2 for the site published after it
beside those                            about 20 rows: the older build's caps, two token rows in and out, the entry of the update
a run with upgrade ticked               about 212 + 20 + 1,018 (the checks) + 430 (a reset that keeps no sample) = about 1,680 rows, on each account it runs on
                                        and the first schema of the install the checks start over, which no meter counts
the pull request of a release           about 212 + 20 + 313 (the put-back) = about 545 rows, on each account, each time its checks run
```

The `Release Live Upgrade` workflow runs it. `.github/workflows/release-live-upgrade.yml` starts on every pull request, and calls `live-upgrade.yml` once for each kind of install on the pull request of a release alone. Its checks stand beside `all-green` on the pull request, two of the upgrade and two of the put-back, and `all-green` does not wait for them: read all four before merging a release.

It is no job of the release gate: GitHub hands a called workflow only the secrets its caller passes, and the gate's caller passes none.

### The put-back after the upgrade of a release

The upgrade removes the sample sites and the demo, and leaves a schema step main does not have. So the same workflow then puts each install back to what main's own run leaves.

```text
live upgrade (domain)           -> put back (domain) / checks
live upgrade (account address)  -> put back (account address) / checks

put back: main checked out and built -> the install made to match it -> no checks -> the samples and the demo put back
```

| Asked | Answer |
| ----- | ------ |
| which steps | the job `checks` of `live-install.yml`, called with `put_back_only`: the steps of main's run without the wait for a gate and without the checks |
| which build | the branch the pull request would merge into, `main`, and not the release: the install is the one main's next run finds as its own |
| what it does to the install | starts it over where it holds the later step, with `poplin uninstall` and `poplin install`; mends it where the upgrade stopped earlier |
| after a failed upgrade | it runs all the same |
| after a cancelled run | it does not run: main's next run puts the install back, the midnight one among them |
| which lane | the one of the kind's live checks, after its upgrade |

```text
the reset on an install made anew   299 rows and 102 bucket writes and lists on the local fake, of at most 600 and 150
the harness's own statements        about 14: two tokens in and out, and the caps
a put-back                          about 313 rows, and the first schema of the install made anew, which no meter counts
a put-back after an upgrade that stopped with its 3 sites on the install   338 rows by the reset: the 3 removed, 13 each
```

The reset's own ceilings hold it: 600 rows and 150 bucket writes and lists.

| A run reaches a test account when | Held by |
| --------------------------------- | ------- |
| it is a run of main | the `if:` of every job that names an environment, and `scripts/upgrade/admit.ts` as a step before the first one that is handed a secret |
| it is the pull request of a release: the branch `release-please--branches--main`, of this repository, opened by `github-actions[bot]` | the same two |
| its ref is `main` or `refs/pull/<number>/merge` | the environment's own rule, in `.github/settings.local.yml` |

GitHub judges a pull request's run by the ref `refs/pull/<number>/merge`, which names no branch. So the environments admit the run of every pull request from a branch of this repository, and the `if:` and the step are what keep the other pull requests out. A pull request from a fork reads no secret.

### The later step

`scripts/upgrade/later-step.ts` writes one step into the checkout of the run: a file beside the product's steps, numbered one above the last, and its line in `registry.ts`. No commit holds it, and no other build or run has it.

| It runs                                                                   | As a step of a release would                    |
| ------------------------------------------------------------------------- | ----------------------------------------------- |
| `CREATE TABLE upgrade_proof`, by a site's folder, removed with the site    | a new table                                     |
| `ALTER TABLE sites ADD COLUMN upgrade_label TEXT NOT NULL DEFAULT ''`      | a new column with a default, on a table of rows |
| `UPDATE sites SET upgrade_label = access \|\| '/' \|\| live_version`        | rows changed from what they held                |
| `CREATE INDEX sites_by_upgrade_label`                                      | a new index                                     |
| `INSERT INTO upgrade_proof`: each site's label and the count of its versions | rows filled from two tables                     |

| The run shows                                                                                       | It cannot show                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| the runner applies a step after the first, whole, to a database that holds rows, on the real provider | that a step written for a release is right: its own tests do |
| the Worker does so as it starts, after an update the install took by its own start                   | a step that fails half-way on the real provider              |
| every site, setting, token, and entry is as before, and a publish works on the changed tables        | a step over more rows than a test install holds              |

`upgrade.ts` stops before anything is installed where its checkout's last step is not this one. A step that fails half-way is held by the unit tests of the runner, on SQLite and on the Workers pool's database: nothing of it is kept, and the Worker does not start.

## The test install

One install on the Cloudflare test account, called staging. It stays up between runs.

|             | Staging                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| Runs        | the latest main that changed a file reaching it                                  |
| Who gets in | the owner alone, behind the login; a stranger opens the public and unlisted sample sites |
| Updated     | after a green main that changed such a file                                      |
| Put back    | after every run of the checks, whatever they came to, at 00:00 UTC every day, and after the upgrade on the pull request of a release |

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

Each site, its title, and who opens it come from one table, `packages/demo/src/preview/world/sample-sites.ts`. The demo's seed plays its whole history, and the reset publishes what it ends in, so the install's Sites screen and the demo's list the same sites.

The demo is what `bun run demo:build` writes, at `demo-<public word>.<domain>`. The install serves its files, and the demo's worker answers every address inside it.

The reset writes `sites.json` beside the demo's files: the address of each sample site outside the trash. The demo's links to those sites then lead to the install's own: a public or unlisted one opens, a private one shows the login. No line of a run names an address.

The owner sets these. Each test account has its own environment, and the secrets carry the same names in both. `live-install.yml` and `live-upgrade.yml` declare each name and each caller hands those names over; the value a step reads is the secret of its job's environment.

| Environment               | Its secrets are of                    | Read by                    |
| ------------------------- | ------------------------------------- | -------------------------- |
| `with-domain-ci-tests`    | the test account that holds a domain  | the `Live Checks` workflow, and `live upgrade (domain)` and `put back (domain)` of `Release Live Upgrade` |
| `without-domain-ci-tests` | the test account that holds no domain | the `Live Checks (account address)` workflow, and `live upgrade (account address)` and `put back (account address)` of `Release Live Upgrade` |

For each account:

| Set                     | Where                        | For                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| R2 switched on          | the Cloudflare account       | the bucket                                                                |
| a bucket named `poplin-live-sites`, empty | the Cloudflare account, made by hand | the mark of a test account: without it the step that makes the install match changes nothing, and no file is removed from the bucket. No script makes, fills, or removes it |
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
| the plans               | as on the other account, with no zone to read                            | `Account plans: free (...)`                                 |
| the install, the first time | `poplin install cloudflare --no-domain`: the bucket, the database, the first upload, the free address switched on, the two forwarders, the login, the keys, the budget alert, the Workflow | `Install: none found, so poplin install ran`, then a line a row |
| the install, every later run | the upload of an update, then `poplin doctor --repair --no-domain`, then the wait for it | `Install: found, runs <version>`, `Worker's code: this commit's build, by the upload of an update (...)`, then a line a row |
| the new deployment      | `awaitNewDeployment`, as on the other account                            | `New deployment: answered the run's token`                  |

A row prints its object and what the command did, and nothing else of it. One Cloudflare refused adds the status:

```text
Forwarder: left
Workflow: failed (refused with status 500): needs the Worker's Workflow, which Cloudflare did not make
```

| Differs from the other install                                   | So                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| no zone: no redirect rule, guard rule, rate rule, or bot switch  | `L8-method`, `L8-scanner`, `L8-http`, `crawler`, `assistant-fetch`, `burst-rate-rule` are skipped: needs a domain |
| a site answers under a path                                      | `relative-file` also asks the address without its last slash, which moves to the one with it |
| a site's address is no root of an origin                         | the demo gets no link to a sample site: `sites.json` is empty                   |
| `poplin install` finds the account by the token                  | the token must show its account in the list of its accounts                     |

Every other check runs on both installs, at the addresses of each one's layout. No run logs in: the checks of a person stay skipped on both.

## The files no record names

The install finds a site's files by a record of its database. A file whose record is gone stays in the bucket: one of a site the install was still removing, or of a database a person changed by hand. The reset removes them when it has put the install back.

| A folder of the bucket                                    | The reset                      |
| --------------------------------------------------------- | ------------------------------ |
| of a site, in the trash or not                            | leaves it                      |
| of an upload, on its way, given up, or finished           | leaves it                      |
| of a removed site whose files the install still removes   | leaves it                      |
| that no such record names                                 | removes its files, one a call  |
| a key that starts with no folder of a site                | leaves it                      |

One run lists the bucket, a thousand files a call, and removes at most what its 300 lists and deletes reach. R2 counts a list with the writes and bills no delete. What is left waits for the next run, the midnight reset among them.

It acts on a test account alone, as the start-over does, and on the bucket of the run's own install, `poplin-sites`: each of the two installs has its own bucket, guard, and ceiling.

```text
Files no site owns: removed 4 folders and 298 objects, 21 folders and 1457 objects remain
Bucket lists and deletes for them: 300 of at most 300
```

## The wait for the new deployment

Cloudflare answers some requests from the deployment before for a while after a deploy is at 100 percent. `converge.ts` ends with a wait, on both installs, so that no check meets one.

```text
poplin install, or where an install stands the upload of an update, then poplin doctor --repair
  -> the install answers, and its database holds this commit's schema    read through Cloudflare's API: after an install made anew or a new schema step, the new Worker alone leaves it so
  -> poplin doctor --repair once more, where the first refused a database a schema step behind
  -> a token for the run, its row written to that database
  -> the install answers the token with 200                             `awaitNewDeployment`
  -> the caps -> the token's row removed
```

| The run                                                  | The wait asks for                                              | Requests              |
| -------------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| left the build before able to answer                     | 1 answer of 200                                                | 1                     |
| made the install anew, or brought a new schema step      | 12 answers of 200 in a row, 3 s apart, each on its own connection | 12, over 33 s      |
| is met by an answer that is no 200                       | the row begins again from nothing                              | that one, and 12 more |
| gives no such row by 3 minutes                           | nothing more: the step fails, and no check runs                | 61                    |

| Who answers the token                                                      | Answer |
| -------------------------------------------------------------------------- | ------ |
| the new deployment, on the database that holds the row                     | 200    |
| the build before, bound to the database that was deleted                   | 503    |
| the build before, started anew on a database with a schema step it lacks   | 503    |
| the build before, started earlier, on that database                        | 200    |

After an install made anew, a 200 is the new deployment's. Twelve in a row say how long no request met an instance that fails; they do not say that no instance of the deployment before is left.

```text
New deployment: answered the run's token
New deployment: answered the run's token 12 times in a row over 33 seconds, after 2 requests that got no 200
The test install could not be made ready: the install did not answer the run's token within 180 seconds (needed in a row: 12; not a 200: 61; last status: 503).
```

A check sends nothing again because of this: a 503 inside a check fails it.

## What keeps the test account at no cost

Each account has its own allowances, and every ceiling below holds for each install by itself.


| Guard                                                                                  | Where                                         | At the limit                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| the zone's plan is Free, where the account holds a zone, and every subscription of the account that has not ended is at a price of 0 | `plan.ts`, before anything is made | the run stops red |
| a budget alert at 1 US dollar of usage charges, to the run's login | the repair, with the token permission Notifications: Edit; without it, the install's own key within a day | Cloudflare emails the login. Nothing is stopped |
| caps: 200MB stored, 20MB a site, 100 sites, 2,500 files a publish, 5,000 files a day   | `caps.ts`, on every run, once the install answers | the install refuses the publish                           |
| bucket writes and lists: 150 by the checks, 300 by the midnight run's, 2,300 with the many-files check, 80 more with the load, 150 by a reset, 40 by an upgrade | `budget.ts`, around every request to the install | the request is not sent, and the step stops red       |
| bucket lists and deletes: 300 together by the removal of the files no record names | `orphans.ts`, around every call to Cloudflare for the bucket | the removal stops, and the next run goes on |
| rows written to the database: 1,250 by the checks, 600 more with the load, 600 by a reset, 300 by an upgrade | `rows.ts`, around every request to the install | the request is not sent, and the step stops red |
| every site the checks make is removed for good                                         | the checks' own sweep, then the reset         | the reset runs after failed checks too                        |
| a site of a run that was killed                                                        | published with `--expires 1d`, trash of one day | the midnight reset removes it                               |
| the sample sites and the demo: 12 sites, 120 files, and 4 MB at most                   | `caps.test.ts`, from a reset of a local fake  | the self-test fails                                           |

A token without Billing: Read cannot read the subscriptions: the run goes on, with a warning and a skipped row. The zone's plan is checked all the same.

No name of a plan is read. Cloudflare lists the storage as a paid plan at a price of 0, and leaves the Workers plan out while it is Free. A subscription with no price stops the run like one with a price. The log holds one line of counts:

```text
Account plans: free (2 subscriptions: 2 at a price of 0, 0 ended)
```

```text
one run, at its ceilings         2 (the account's buckets listed) + 150 (checks) + 150 (reset) + 301 (the files no record names, were every call a list) = 603 bucket writes and lists
the midnight run, at its ceilings  2 + 300 (checks, with the copy the install's job finishes) + 150 (reset) + 301 = 753, and 113 writes by the job itself
a day of 40 such runs            40 x 603 + 753 + 113 + 451 (the midnight reset) = 25,437
31 such days                     25,437 x 31 = 788,547 of the 1,000,000 R2 takes for free in a month
with a bucket of 2,000 files     3 in place of the 301: 305 a run, 12,921 a day, 400,551 a month
a run with the many-files check  2 + 2,300 + 150 + 301 = 2,753, started by hand alone
a usual run                      about 97 (checks) + 0 (a reset that keeps every sample and the demo) + 2 (the account's buckets listed, and the install's listed once)
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
backup-drill             72, of which 34 make the install write to its bucket or list it
the waits                2 a usual run; 14 after an install made anew, where `poplin install` asks too, 13 after a new schema step, and more where a row begins again; 60 + 60 + 61 = 181 at their longest
a run, at its worst      1,140 + 700 + 72 + 181 = 2,093
the plan's day           100,000 requests to the Worker, reached at about 47 such runs
```

The runs of one day must stay under the plan's 100,000 requests to the Worker. The other checks send a few dozen more, and a reset that keeps the samples reads each of their files, about 130 requests. A stranger's request that gets no answer and is asked again is counted once here, though it may have reached the Worker each time.

```text
the install without a domain
a run, at its worst      700 (own-limit) + 72 (backup-drill) + 181 (the waits) = 953: no rate rule stands in front of it, so no burst is sent
a usual run              about 125 (own-limit, which ends at the first 429) + 72 + about 130 (the reset) and a few dozen more
a day of 45 runs         45 x 953 = 42,885 of its own account's 100,000
a request for a site     one request of a forwarder, which hands it to the Worker at no further request, by Cloudflare's documentation
```

## The rows a run writes

The database's free plan takes 100,000 rows written a day, every database of the account together. Past them it refuses each write until midnight UTC, and every run of that day fails.

| One request of a run                      | Rows, at most | Which are                                                                  |
| ----------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| a new site, from its begin to its finish  | 22            | the site 11, the upload 6, the day's counts 2, the version 2, the log 1    |
| a new site not told never to run out      | 23            | its entry in the index of expiries; one that names no expiry may take the install's |
| a new version that drops no older one     | 13            | 17 where it drops one, and 2 for each further one it drops                 |
| a new version that asks settings of its site |            | and what those settings cost as a change of the site, below                |
| a site put back from a backup             | 22            | 2 for each version more, and 1 where it runs out                           |
| a site removed for good                   | 13            | with three versions and a day's count; 6 to the trash, 9 out of it         |
| a change of who may open a site           | 4             | any other setting 2, a title 1 more and a name 2 more, and 1 where it is told an expiry |
| a new link                                | 12            | a rollback 2, a setting of the install 6 and 3 more for a setting of the guard rules, a computer's login 3 |
| a copy of a site                          | 24            | counted at the request that begins it; 19 for each request that goes on    |
| a copy the install's job finishes         | 24            | none for an ask while the job copies; 19 and 1 for each round of the job, with the answer that names the site |
| a listing of the bucket                   | 1             | the files of a version, and what an upload lacks                           |
| a page or a file a site answered          | 2             | the day's count of the site, and of all sites                              |

The database counts an index entry and a row a trigger writes as rows, so the one row of a new site is 11: a site outside the trash has an entry in the index of each order a listing offers. `rows.ts` holds the prices, and a test in the Workers pool sends each kind of request to a Worker on D1 and compares the two counts.

A product change that moves a row cost turns that test red, with the database's count beside the harness's for each kind of request.

| To measure the prices again | Then |
| --- | --- |
| `bun run --cwd packages/providers/cloudflare build`, then `bunx vitest run tests/shared/worker/worker.test.ts -t "the rows the live checks count"` there | set each price in `rows.ts` to the first number of its pair, and the pair in the test |
| `bun test ./packages/providers/cloudflare/tests/live ./packages/providers/cloudflare/tests/scripts/live` | set the totals it prints in `self.test.ts` and `reset.test.ts`, and the figures below |

```text
the checks, as the harness counts them   959 on the local fake, a few more with the demo's check: every site they publish, change, and remove
the midnight run's checks                1,062: the copy the install's job finishes, 103 more
a reset that keeps every sample          41: the trashed sample, published and trashed anew while the suite's trash holds a site for one day
a reset that keeps none                  about 430
a reset on an install made anew          299: no site to remove
the harness's own statements             18: three tokens in and out, and the caps
the wait for the new deployment          0: it asks with the token of the caps, and its request writes no row
a usual run                              about 1,018 counted; the sweep later drops each upload's row, 5 a publish, about 135 more
a day of 40 such runs                    about 46,000 of the 100,000
```

The install without a domain writes to the database of its own account: the same checks, the same ceilings, a count line of its own in each step of its workflow, and its own 100,000 a day.

The harness's count is the most each request writes for a site a run made, so it runs a little above the database's own. A refusal or a missing file of a served site writes two rows the count leaves out. Each step prints its count:

```text
Rows written this run: 959 of at most 1250
```

## The load

A run started by hand with `load` ticked adds one check after all the others: some of the requests of the [load test](../README.md), at small, fixed sizes. No push and no midnight run makes it.

| Step | Requests | Rows written, at most | Bucket writes and lists |
| --- | --- | --- | --- |
| publish 5 sites of one page | one publish each | 23 each | 2 each |
| publish one site of 20 files | one publish | 23 | 21 |
| open its page | 30 one after another, then 50 at once | 2 each | none |
| ask for a file it does not hold | 10 one after another, then 10 at once | 2 each | none |
| list the sites | 5 one after another | none | none |
| copy the site of 20 files | one command | 24 | 22 |
| the run's sweep removes the 7 sites | one removal each | 13 each | 1 each |

```text
load: at most 453 rows written of a ceiling of 600, 60 bucket writes and lists of a ceiling of 80, and 100 visits of one visitor's 120 a minute
```

| The load | What happens |
| --- | --- |
| says its plan before it sends anything | the first line above: the rows, the bucket writes and lists, and the visits it makes at the most |
| plans more than a ceiling, or more visits than one visitor's minute holds | it sends nothing, and the check fails with the number that is over |
| waits 61 seconds before its first visit | the checks of the edge before it used up its visitor's minute |
| is answered a visitor's refusal, status 429 with `Retry-After` and the install's own words | counted as refused, and no failure |
| is answered anything else that is not what the step asks for | the check fails, with the statuses alone |

The plan counts each file a copy writes; the run's own meter counts a copy as one request, so its line of bucket writes and lists reads 21 under the plan. The times are those of the runner's requests over the network, and no measure of the Worker's processing. `live/checks/load.ts` holds the sizes, and `tests/live/checks/load.test.ts` runs the load against the local fake of both kinds of install.

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

The line holds no name and no address. One drill is 72 requests when none is sent again.

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

## The check of the logs

`logs-follow` proves that Cloudflare keeps the Worker's logs as the setting `provider_logs` says, with the key the install keeps and no Repair.

| Step        | On the install                                                         | Then, at Cloudflare                                               |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| read        | `poplin config provider_logs`, after the run's changes of the settings | the Worker's observability is as the setting says within 20 s     |
| switch over | `poplin config provider_logs` with the other text                      | the Worker's observability is as the new setting says within 20 s |
| put back    | `poplin config provider_logs` with the first text                      | the Worker's observability is as it was at the start within 20 s  |

The observability is read with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The setting is put back whatever the check met.

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

The edge's rules block with an answer: a 403. A stranger's request that gets no answer, its connection closed or its 30 seconds run out, says nothing of a rule or of the install. The run asks it again, and the log holds one line for each asking.

| A stranger's request | Asked again |
| --- | --- |
| gets an answer, of any status | never: a wrong status fails its check |
| gets no answer | twice at most, after 1 second and then 2; the third failure reaches its check |
| is a change asked of the API | never: it is not sent twice |

```text
a stranger's request got no answer, asked again: 1
```

## What a run skips

A check that cannot run is written to the step summary as skipped, with what it needs, and to the log as a warning. It never fails the run.

A run that cannot make the install answer, or cannot start the checks, fails: the log's error line and the step summary say what it needs. That covers a token with no permission for the zone, the bucket, the database, the Worker, the DNS record, the route, or a forwarder.

| Skipped: needs                                                      | Checks                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a token permission for a rule, the bot settings, the login, or the key; an object `poplin install` or the repair left out | the piece of the install that permission makes, and the checks behind it |
| the token permission Billing: Read                                  | the reading of the account's subscriptions, before anything is made      |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`                  | `users-follow`, `logs-follow`, `duplicate-job`                           |
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
| a run started by hand with the load switched on                     | `load`: it is no row of any other run's table                            |
| a person in a browser                                               | `L2`, `L3`, `L4-in`, `L5b`, `L6`, `L7`, `L9`: the checklist below, which also holds `download` |
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
| Notifications: Edit                                         | the account | the budget alert, and the certificate alert       |
| Account API Tokens: Edit                                    | the account | the two keys the install keeps                    |

The token of the account without a domain needs the rows whose scope is the account, and none of the zone. Workers Scripts: Edit also reads the account's free address and makes the two forwarders.

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
| `setup` | On a Cloudflare account with no poplin, follow `docs/start/install.md` from step 1 to step 5.     | Each step works as written: the command prints a row for each object it made, then the dashboard's address. |
| `token` | Open the link `poplin install cloudflare` prints, or the one in step 3 of `docs/start/install.md`, logged in to Cloudflare.                                            | The token form opens with the nine linked permissions ticked.                                                                     |
| `link-rights` | Install with the link's nine permissions and the one the form's note names: on a Cloudflare account with no poplin, make the token from that link, add Workers R2 Storage: Edit and nothing else, and run `npx poplin install cloudflare`. Log in, then publish a site and open it. | The command ends with `is installed.` and names no failure. No row says failed. The redirect, guard, rate, and bot rows say `left out`, each with the permission that switches it on. The login works and the site opens. |
| `http`  | Switch the redirect rule off in the zone's Redirect Rules, then run `curl -i http://<a site's address>` and the same on the admin hostname and the Worker's own address.                 | Status 308 and a `Location` that is the same address over `https`, from the Worker: its address reaches the Worker as `http`. Switch the rule on again. |
| `L3`    | Publish two private sites. Open the first, then the second.                                                                                                      | Both open. The second asks for nothing.                                                                 |
| `L2`    | Publish private site B. Publish private site A whose page shows B in an `iframe`. Open A in Chromium, Firefox, and Safari. Then open B directly and reload A.    | In each engine: whether B shows inside A before B was opened directly, and after. Write both down.      |
| `L4-in` | Publish an unlisted site and copy its address. Run `poplin set <label> --private`. Open the copied address logged out, then log in.                              | Logged out: the login, and no part of the page. Logged in: the site, at the address `set` printed.      |
| `L7`    | Add a second login on the dashboard. Log in as it in another browser and open a private site. Remove that login. Reload the site within a minute, then after it. | After a minute at most, the reload shows no page of the site.                                           |
| `L5b`   | In Zero Trust, delete the Access application named `poplin`. Open a private site logged out. Run the workflow again.                                             | Status 404 and no part of the page. After the workflow, the application is back and the login works.    |
| `L6`    | Reload a private page twenty times. Open the Worker's metrics in the Cloudflare dashboard.                                                                       | CPU time per request under 10 ms, the Free plan's limit.                                                |
| `L9`    | Open an unlisted site in Chromium, Firefox, and Safari. Publish new content to it. Reload within five minutes, then after.                                       | Which reload first shows the new version in each engine, and that no page mixes files of both versions. |
| `download` | On an install whose Activity holds more than 2,000 entries, press Download, then CSV. Open the Worker's metrics in the Cloudflare dashboard. | The file is named `poplin-activity-<date>-1.csv`, holds the heading and 2,000 entries, and ends with the line that says the log holds more. CPU time of that request under 10 ms, the Free plan's limit. |
| `self-update` | With two releases of poplin published, on an install that runs the older one and holds its key, publish a private and a public site. Press Update now on the dashboard. Then open the Worker's settings and its Deployments in the Cloudflare dashboard. | The foot of the side names the newer version, and Activity says `Started an update`. Both sites answer as before. The Worker has every variable it had, its secret `KEPT_KEY`, the same cron trigger, and its logs switched on. The newest deployment's message is `poplin <version>, by its own update`. A run of the workflow cannot prove this: the test install runs the main branch, never a release. |
| `alerts` | With a token that also holds Notifications: Edit, run the workflow. Then open Notifications in the Cloudflare dashboard. | The list holds `poplin: usage charges reached 1 dollar`, sent to the login, and on the account with a domain `poplin: certificates of every domain of the account` too. |

Delete the sites you published when you are done: `poplin delete <label> --no-trash`.
