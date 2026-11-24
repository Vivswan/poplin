# Live checks

The checks of a deployed install: a stranger's requests over HTTPS, and a token holder's commands through the CLI and the MCP server.

| To                                                | Run                                                                       | Needs                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| check the checks themselves, against a local fake | `bun test ./packages/providers/cloudflare/tests/live ./packages/providers/cloudflare/tests/scripts ./packages/providers/cloudflare/tests/migrations`                                                        | nothing                                                                   |
| check an install of your own                      | `bun run live`                                                            | `POPLIN_LIVE_DOMAIN`, or `POPLIN_LIVE_ACCOUNT_ADDRESS` for an install without a domain, and `POPLIN_LIVE_TOKEN` for the checks that publish |
| check the two test installs                       | the `Live Checks` and `Live Checks (account address)` workflows: every night, or by hand | the `with-domain-ci-tests` and `without-domain-ci-tests` environments     |
| check that an install of the older build updates to main | the same two workflows, by hand, with `upgrade` ticked: [The upgrade](#the-upgrade) | the same environments |
| check that an install of the last release updates to the next one | the pull request of a release: the checks `release-gate / live upgrade from the last release (domain) / upgrade` and `(account address)` of its `CI` run | the same environments |
| check the two test installs before a release      | the pull request of a release: the checks `release-gate / live checks (domain) / checks` and `(account address)` of the same run | the same environments |
| keep the two test installs at the newest green commit of main | nothing: the checks `post-green / test install (domain) / checks` and `(account address)` of main's `CI` run, after every merge: [The put-back](#the-put-back) | the same environments |
| check that a release publishes its built Worker   | a release's own run of main, its `site` job last: both `build the Worker` jobs green and the step that compares them; `poplin-<version>-worker.json`, `-worker.js`, and `-worker.js.map` on the release's page; `gh attestation verify` passes for each; `bundle` and `schema` under that version in the website's `releases.json`, and `schema` in `latest.json` | a published release |

```text
Live Checks workflows, one for each kind of install
  midnight UTC                                             a run of each kind, on main; a push starts none, and puts each install at its commit without the checks
  a run by hand                                            a run of the one workflow it was started from
  .github/workflows/live-install.yml                       the steps below, which both workflows call, and the pull request of a release after its upgrades
                                                           with `put_back_only`: the same steps without suite.ts, for the newest green commit of main
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

Each workflow runs the same steps on its own install, every night. One that fails stops no other.

## What starts a run

| Started by                                     | What runs                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| 00:00 UTC, every night                         | deploy and checks of main, with the copy the install's job finishes, and the reset; each waits its turn and replaces no run |
| hand                                           | deploy and checks                                                            |
| hand, with `start_over` ticked                 | first removes the install with `poplin uninstall`, then the same             |
| hand, with `upgrade` ticked                    | first the job `upgrade`, then deploy and checks, whatever the upgrade came to |
| hand, with `load` ticked                       | the same, and [the load](#the-load) after the checks                         |
| the pull request of a release                  | both upgrades, then deploy and checks of main: [the checks of a release](#the-checks-after-the-upgrades-of-a-release) |
| a push to main, once its gate ended green      | no checks: [the put-back](#the-put-back) of both installs, from `post-green.yml`     |
| the end of any run of the checks above         | the same put-back, whatever the checks came to, and after a cancelled run    |

| Also                                                   | What happens                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| a midnight run ended red, or was cancelled, its put-back among it | one open issue, labelled `live-nightly-domain` or `live-nightly-account-address`, with the run's link |
| the next midnight run of that kind ended green         | that issue is closed                                                 |
| a run by hand ended red                                | it stays red until it is run again; no issue                         |
| a newer run by hand while an older one of the same workflow has not started | that older run is cancelled                     |
| a run of the other kind at the same time               | both go on side by side: each kind has an account and a lane of its own |

A run of a night or by hand checks the install made from the commit it started on, and running it again makes the install from that same commit. The pull request of a release takes main's tip as its checks start, each time they run. The put-back after each takes the newest green commit of main.

One job touches a test install at a time. Each kind has a lane of its own, since the two installs are on two accounts: a run of one kind never waits for the other, and the two run side by side. Inside a lane the checks, the put-backs, and the midnight reset each wait their turn, and every waiting job is kept.

## The put-back

Each test install runs the newest commit of main whose gate, the `all-green` check of its push, ended green.

```text
before   a merge                        -> the installs stay at the commit of the last night, up to a day
         live checks that stop half-way -> the install, and the demo, stay as the checks left them
after    a merge, its gate green        -> post-green.yml -> both installs at that commit, minutes later
         live checks, however they end  -> a put-back as their last job -> both installs at the newest green commit
```

| Caller | Job | Runs |
| ------ | --- | ---- |
| `post-green.yml`, which `ci.yml` calls after `all-green` on a push to main | `post-green / test install (<kind>) / checks` | on a push to main of this repository; never on a pull request, a schedule, or a fork |
| the two `Live Checks` workflows | `put back (<kind>) / checks` | after the checks of a night or of a run by hand: green, red, or cancelled |
| `release-gate.yml` | `release-gate / put back (<kind>) / checks` | after the live checks on the pull request of a release, the same way: main's build, never the release's |

All three call the job `checks` of `live-install.yml` with `put_back_only`, in the lane of the kind's live checks.

```text
admitted -> scripts/newest-green.ts: the runs of main's pushes, newest first, the first whose `all-green` job ended success
  -> that commit checked out, where the job holds another -> built -> converge.ts -> no suite.ts -> reset.ts
```

| The step `Find the newest green commit of main` prints | Then |
| ------------------------------------------------------ | ---- |
| `Newest green commit of main: 1a2b3c4, the one checked out: installing it` | the steps go on |
| `Newest green commit of main: 1a2b3c4, not the one checked out (5d6e7f8): taking it` | that commit is checked out, its packages installed, and the steps go on. Never on a push |
| `Newest green commit of main: 1a2b3c4, newer than this run's 5d6e7f8: its own run installs it, nothing is made here` | a push alone: the job ends green in a minute, and no step calls Cloudflare |
| a warning: GitHub did not say, or none of the last 100 runs holds a green gate | the commit checked out is installed |

A push's job asks once it holds the lane. So of a row of merges that wait, the newest green one is installed and each older one ends at that step. No waiting job is cancelled: the release leg of `ci.yml` runs after this hook ended green, so a put-back that fails holds that commit's release leg back until its failed jobs are run again.

| Asked | Answer |
| ----- | ------ |
| the version the install then says | the one in the commit's `packages/cli/package.json`: the Worker is built from the commit, and the commands are answered with that build as the newest release |
| right after the commit of a release | the new version, before the tag and the published release exist: the commit holds it |
| on the pull request of a release | the last release's version: the checks and the put-back take main, which does not hold the new one yet |
| a put-back that fails | its job is red: the run of main, the night's issue, or the release's gate shows it |

```text
a put-back, as the harness counts it    about 55 rows: 14 for two tokens in and out and the caps, 41 for a reset that keeps every sample
where the demo's files changed          16 more: about 71 rows
on an install it starts over            14 + 299 = about 313 rows, and the first schema, which no meter counts
requests to the Worker                  about 150: the reset reads each sample's files, about 130; 330 at the waits' longest
bucket writes and lists                 2, and the demo's files where they changed; 453 at the ceilings
a day's 100,000 rows                    about 1,300 merges at 71 rows beside a night's run; about 300 at 313
a day's 100,000 requests                about 600 merges at 150
a push's job that was overtaken         nothing on the account
```

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
| the pull request of a release, once its checks are approved to run | the release as it would merge: the pull request's merge commit | the job `live checks`, whatever the upgrade came to: [the checks of a release](#the-checks-after-the-upgrades-of-a-release) |

Both run the job `upgrade` of `.github/workflows/live-upgrade.yml`, in the lane of the kind's live checks, so an upgrade and a run of main never touch one install together.

Each runs it twice for a kind, one after the other, since the two share one install:

| From | The older build is | A failure | With no such build |
| ---- | ------------------ | --------- | ------------------ |
| `release` | the last release: the highest `vX.Y.Z` tag among the ancestors | fails the check | the run fails: a checkout with no release tag is told to fetch the tags |
| `next` | the newest pre-release on npm that is an earlier build of the commit | is a warning, `Advisory: this upgrade starts from a pre-release, so its failure blocks nothing.`, and the check passes | one line that says which pre-release is the newest and why it is none, and the check passes |

A job that finds no build to start from touches no install.

```text
job upgrade
  migrations/older-build.ts        the older build in a folder of its own, its packages installed, its Worker built: no secret reaches this step
                                   this checkout told one patch above the older build's version and given the later step, then built
  migrations/upgrade.ts            a test account alone -> the older build's own poplin uninstall and poplin install
                                   -> the older build's command line: 3 sites, a second version, a setting, a user; a token of its making
                                   -> the older build's own start of an update, fed the run's build as a release
                                   -> the Worker of the new build starts, and applies the later step to the filled database
                                   -> the install says the new version 12 times in a row -> one more site published -> one line a check
                                   -> the settings put back, the sites and the token's row removed
job checks                         its checkout holds no later step, so the install is started over, then every live check, the samples
```

A pre-release says its commit in its version, `0.1.0-main.<count>.<date>.g<commit>`. `migrations/older-from.ts` takes the newest one whose commit is an earlier build:

| A pre-release is passed over when its commit is | Since |
| ----------------------------------------------- | ----- |
| the commit of the run | the older build and the newer one would be one |
| a commit the run's commit joins, on a pull request | the run is of the commit that joins the branch to main's tip, so that tip is the code under test |
| no ancestor of the run's commit, or not in its history | the run does not come after it |
| the last release's, or no descendant of it | the upgrade from the release covers it |

```text
Older build: 0.1.0-main.812.20261119.g1a2b3c4 (1a2b3c4), 3 commits behind this one
The older build says the version 0.1.0
```

An install made by a pre-release whose first schema step, stored shapes, or parts differ from the commit's is not one the commit takes over, so such an upgrade fails as advice until a pre-release with them is an earlier build.

A pre-release on npm is the command alone: no built Worker and no line of the website's `releases.json` exists for one. So the Worker of the older build is built from its commit, and its own harness installs it.

| Check        | Holds when                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `Version`    | the install says the version the run's build was published under                                             |
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
Older install: made by the older build's own poplin install, which says the version 0.1.0
Older install: filled with 3 sites, a second version, a setting, and a user
Update: the older build took 0.1.1 over 0.1.0, by its own start of an update
Bucket writes and lists the upgrade asked for: 23 of at most 40
Rows written this run: 212 of at most 300, 22 of them for the later step
Version: runs 0.1.1, and ran 0.1.0
Sites: 3 are shown, answered to a stranger, and stored in every version as before the update, byte for byte
Database: the 2 schema steps of this commit's build are marked as it applies them, step 0.1.0/upgrade-proof among them
Later step: the table, the column, and the index of step 0.1.0/upgrade-proof are there, and the 3 sites hold what it filled from them
Going back: not offered: the update changed the database, which the version before cannot read
Cleanup: the two settings put back, the sites and the token's row removed
```

A check that fails says `FAILED` and what differs, by a site's place and access or a setting's key: never a name, an address, or a value.

| What the start of the update is                  | Whose                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| the release picked, its files fetched and checked | the older build's code                                            |
| the `update_started` entry, the upload            | the older build's code, over the database's API                   |
| the key the upload is sent with                   | the run's token, where a deployed install uses the key it keeps   |
| the release                                       | the run's build, answered in the run's own process                |
| the count of starts a minute                      | left out: a binding of the Worker keeps it                        |

A deployed Worker reads releases from the project's website alone, which names no build of a commit. So no run shows a deployed Worker that fetches a release and uploads itself with its kept key: the `self-update` row of the checklist does, once two releases are out.

```text
the upgrade, as the harness counts it   212 rows and 23 bucket writes and lists on the local fake, of at most 300 and 40
of those, the later step                22 rows: 14 as it runs (5 for its mark, table, column, and index, and 3 for each of the 3 sites, as the Workers pool's database counts them)
                                        and 8 after it: 2 as each of the 3 sites is removed, and 2 for the site published after it
beside those                            about 20 rows: the older build's caps, two token rows in and out, the entry of the update
a run with upgrade ticked               about 212 + 20 + 1,018 (the checks) + 430 (a reset that keeps no sample) = about 1,680 rows, on each account it runs on
                                        and about 71 for the put-back after it, as after every run of the checks
                                        and the first schema of the install the checks start over, which no meter counts
the pull request of a release           the same sum: about 1,680 rows, on each account, each time its checks run
where both upgrades find a build        about 232 rows more, and one more install started over, in either run
where neither finds one                 the checks and the reset alone, in either run: about 1,018 rows, and the reset's
```

The release gate runs it. `.github/workflows/release-gate.yml` calls `live-upgrade.yml` twice for each kind of install on the pull request of a release, and then the live checks. `all-green` waits for all eight jobs: a release cannot merge while the upgrade from the last release, a live check, or a put-back is red. A failed step of the two that only advise is a warning, and the job passes.

GitHub hands a called workflow only the secrets its caller passes. `ci.yml` hands the gate every secret, and the gate hands the three names on. No other workflow calls the gate, and a dispatch of `ci.yml` runs no live job.

### The checks after the upgrades of a release

The upgrade removes the sample sites and the demo, and leaves a schema step main does not have. So the same workflow then runs the live checks of a night on each install, which also puts it back to what main's own run leaves.

```text
live upgrade from the last release (domain)           -> live upgrade from a pre-release, as advice (domain)           -> live checks (domain) / checks           -> put back (domain) / checks
live upgrade from the last release (account address)  -> live upgrade from a pre-release, as advice (account address)  -> live checks (account address) / checks  -> put back (account address) / checks

live checks: main checked out and built -> the install made to match it -> every live check -> the samples and the demo put back
put back:    the newest green commit of main -> the install made to match it -> the samples and the demo put back
```

| Asked | Answer |
| ----- | ------ |
| which steps | the job `checks` of `live-install.yml`: the steps of a night's run, without the copy the midnight run alone makes |
| which build | the branch the pull request would merge into, `main`, and not the release: the upgrade before it is what takes the release, and the install is the one main's next run finds as its own |
| what it does to the install | starts it over where it holds the later step, with `poplin uninstall` and `poplin install`; mends it where the upgrade stopped earlier |
| after a failed upgrade | it runs all the same |
| after two upgrades that found no build to start from | it runs all the same: every release is checked |
| a check that fails | the check `live checks (<kind>) / checks` is red |
| after a cancelled run, as when a newer push to the pull request takes its place | it does not run, and [the put-back](#the-put-back) after it does: an upgrade or a check cut short does not stay on the install |
| which lane | the one of the kind's live checks, once, after both upgrades |

```text
the reset on an install made anew   299 rows and 102 bucket writes and lists on the local fake, of at most 600 and 150
the checks of a release             about 1,018 rows (the checks) + 430 (a reset that keeps no sample), and the first schema of the install made anew, which no meter counts
a reset after an upgrade that stopped with its 3 sites on the install   338 rows: the 3 removed, 13 each
```

The ceilings of the checks and of the reset hold it: 1,250 rows and 150 bucket writes and lists by the checks, 600 and 150 by the reset.

| A run reaches a test account when | Held by |
| --------------------------------- | ------- |
| it is a run of main | the `if:` of every job that names an environment, and `scripts/admit.ts` as a step before the first one that is handed a secret |
| it is the pull request of a release: the branch `release-please--branches--main`, of this repository, opened by `github-actions[bot]` | the same two |
| its ref is `main` or `refs/pull/<number>/merge` | the environment's own rule, in `.github/settings.local.yml` |

GitHub judges a pull request's run by the ref `refs/pull/<number>/merge`, which names no branch. So the environments admit the run of every pull request from a branch of this repository, and the `if:` and the step are what keep the other pull requests out. A pull request from a fork reads no secret.

### The later step

`migrations/later-step.ts` adds one step to the checkout of the run: the last step of the file named for the older build's version among the product's steps, called `upgrade-proof`. Where the checkout has no such file, it is made and listed in `registry.ts`. No commit holds it, and no other build or run has it.

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
| Runs        | the newest commit of main whose gate ended green                                 |
| Who gets in | the owner alone, behind the login; a stranger opens the public and unlisted sample sites |
| Updated     | minutes after each merge to main turns green, and after every run of the checks: [the put-back](#the-put-back) |
| Put back    | with every update, after every run of the checks, whatever they came to, and at 00:00 UTC every day |

| A reset removes                               | A reset leaves                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| every site that is no sample and not the demo | the users and every other setting                                                     |
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
| `with-domain-ci-tests`    | the test account that holds a domain  | the `Live Checks` workflow, `live upgrade (domain)`, `live checks (domain)`, and `put back (domain)` of the release gate, and `test install (domain)` of `post-green.yml` |
| `without-domain-ci-tests` | the test account that holds no domain | the `Live Checks (account address)` workflow, `live upgrade (account address)`, `live checks (account address)`, and `put back (account address)` of the release gate, and `test install (account address)` of `post-green.yml` |

For each account:

| Set                     | Where                        | For                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| R2 switched on          | the Cloudflare account       | the bucket                                                                |
| a bucket named `poplin-live-sites`, empty | the Cloudflare account, made by hand | the mark of a test account: without it the step that makes the install match changes nothing, and no file is removed from the bucket. No script makes, fills, or removes it |
| Zero Trust switched on  | the Cloudflare account       | the login                                                                 |
| `CLOUDFLARE_API_TOKEN`  | a secret of the environment  | every step that calls Cloudflare                                          |
| `CLOUDFLARE_ACCOUNT_ID` | a secret of the environment  | the same                                                                  |
| `POPLIN_LIVE_LOGIN`     | a secret of the environment  | the login the install lets in                                             |
| `DEMO_URL`              | a variable of the repository | the demo's whole https address on the install under a domain, for the website |
| `DEMO_URL_NO_DOMAIN`    | a variable of the repository | the same on the install without a domain. Both set: Demo is a menu of the two. One set: a plain link. Neither: no link |

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
| no zone: no redirect rule, guard rule, rate rule, or bot switch  | `L8-method`, `L8-scanner`, `L8-http`, `crawler`, `assistant-fetch` are skipped: needs a domain |
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

A run of the checks starts at midnight, by hand, or on the pull request of a release, so 40 a day is far above what happens. A put-back after a merge runs no check: [its price](#the-put-back) is beside these. The count is the harness's own, one for each request that makes the install write or list; the install lists once more for every thousand files.

The copy the install's job finishes is a site of 113 files: one more than the first request of a copy takes. It costs a run 226 files of the day and over two hundred bucket writes, so the midnight run alone makes it, and a run started by hand with the many-files check.

```text
backup-drill             72, of which 34 make the install write to its bucket or list it
the waits                2 a usual run; 14 after an install made anew, where `poplin install` asks too, 13 after a new schema step, and more where a row begins again; 60 + 60 + 61 = 181 at their longest
a run, at its worst      72 + 181 = 253
the plan's day           100,000 requests to the Worker, reached at about 395 such runs
```

The runs of one day must stay under the plan's 100,000 requests to the Worker. The other checks send a few dozen more, and a reset that keeps the samples reads each of their files, about 130 requests. A stranger's request that gets no answer and is asked again is counted once here, though it may have reached the Worker each time.

```text
the install without a domain
a run, at its worst      72 (backup-drill) + 181 (the waits) = 253
a usual run              72 + about 130 (the reset) and a few dozen more
a day of 45 runs         45 x 253 = 11,385 of its own account's 100,000
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

A run started by hand with `load` ticked adds one check after all the others: some of the requests of the [load test](../README.md), at small, fixed sizes. No midnight run and no pull request of a release makes it.

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
| waits 61 seconds before its first visit | the checks before it spent a part of its visitor's minute |
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
| add    | `poplin config users` with one more email, at `example.com`  | the policy `poplin logins` names the email within 20 s  |
| remove | `poplin config users` with the list as it was                | the policy names the same emails as before              |

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
| the midnight run, or a run started by hand with the many-files check | `duplicate-job`: a copy of 113 files, so once a day, and at no release |
| Access switched on for the account                                  | `L1`, `dashboard-login`: the edge's own redirect to the team's login from every path of the dashboard, and its own 401 to a script's call; `login-page`: the team's login page offers the Cloudflare login, the email code, and passkeys, each where the account has the method; `users-follow`: no login list exists |
| the token permission that makes a login method                      | `login-page`                                                             |
| an install that sends a private site's address to its letter p form | `L1`, `L4`, `L5`                                                         |
| a Worker route for the public word's hostnames                      | `public-name`, `demo`                                                    |
| a public site named `demo`, which the reset publishes               | `demo`                                                                   |
| a plan whose bot settings the API can change                        | `crawler`, `assistant-fetch`                                             |
| the guard rule or the redirect rule on the zone                     | `L8-method`, `L8-scanner`, `L8-http`                                     |
| a run started by hand with the many-files check switched on         | `L10`: two thousand uploads, so on no run that starts by itself                    |
| a run started by hand with the load switched on                     | `load`: it is no row of any other run's table                            |
| a person in a browser                                               | `L2`, `L3`, `L4-in`, `L5b`, `L6`, `L7`, `L9`: the checklist below, which also holds `download` |
| a domain                                                            | on the install without one: `L8-method`, `L8-scanner`, `L8-http`, `crawler`, `assistant-fetch` |

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
| Access: Organizations, Identity Providers, and Groups: Edit | the account | the team domain the Worker checks a login against, and the login methods |
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
| `token` | With a domain, open the form `poplin install cloudflare` offers, or the link in step 3 of `docs/start/install.md`, logged in to Cloudflare.                            | The token form opens with the ten linked permissions ticked, Workers R2 Storage among them.                                       |
| `link-rights` | Install with the link's ten permissions and no other: on a Cloudflare account with no poplin, make the token from that link, add nothing, and run `npx poplin install cloudflare`. Log in, then publish a site and open it. | The command says `is installed` and names no failure. No row says failed. The redirect, guard, rate, and bot rows say `skipped`. The login works and the site opens. |
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
