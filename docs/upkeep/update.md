---
title: Update
order: 10
---

# Update the install

How each kind of install updates, and the notice of a newer version; the steps it names are those of [By hand](../start/by-hand.md#the-steps).

Nothing updates on its own while the setting `auto_update` is off, as it is in a new install. An install says when a newer version is out, and how it updates depends on how it was made.

| The install was made      | It updates by                                                       |
| ------------------------- | ------------------------------------------------------------------- |
| with the button of step 2 | three clicks at Cloudflare: [Build again](#build-again)             |
| from a terminal           | two commands in its folder: [From a terminal](#from-a-terminal)     |
| with the OpenTofu module  | a new bundle and an apply: [With OpenTofu](../start/with-opentofu.md)        |

## Build again

For an install made with the button. Cloudflare's documentation gives these steps for building again:

| Step | In Cloudflare's dashboard                                              |
| ---- | ---------------------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker, `poplin`                 |
| 2    | select Deployments, then View build history at the bottom of the page  |
| 3    | select the ellipses next to the newest build, then select Retry build  |

**It worked when** the `version` row of `npx poplin doctor` names the new version. Your sites, settings, and logins stay: the build deploys under the name, the bucket, and the database your copy's `wrangler.jsonc` names.

Run in Cloudflare's build, poplin's deploy fetches a release of poplin from GitHub, checks it, and deploys that. Your copy on GitHub stays as it is.

```text
in the build's log:   poplin: deploying 0.3.1 (was asked for latest)
```

### What a build checks

A release is named by its version and taken by its content. The build runs no file of a release before every row below passed.

| Step | The build                                                                 | From                                   |
| ---- | ------------------------------------------------------------------------- | -------------------------------------- |
| 1    | reads which releases are published, each with a SHA-256 digest            | `releases.json` on poplin's website    |
| 2    | fetches the release's source files, one archive                           | the release's page on GitHub           |
| 3    | computes the archive's SHA-256 digest and compares it with the published  | the build itself                       |
| 4    | reads the version the files say they are                                  | the archive                            |

| What the build finds                                        | It prints, after `poplin:`                                           | Deployed |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| the website does not answer with the file                   | `poplin's website did not say which releases are published.`         | nothing  |
| no digest published for the version                         | `no digest is published for release 0.9.9, so its files cannot be checked.` | nothing |
| the archive cannot be fetched                               | `release 0.3.1 could not be fetched from github.com.`                | nothing  |
| a digest that differs, by one byte or by all                | `the files fetched for release 0.3.1 are not the files poplin published: their SHA-256 digest differs.` | nothing |
| files that say another version than the one asked for       | `the files published as release 0.3.1 say they are version "0.2.0".` | nothing  |
| `latest`, and a website that names no release               | `poplin's website names no release yet`                              | your copy's own files |
| `latest`, and a newest release older than your copy         | `the newest published release, 0.3.1, is older than your copy (0.4.0)` | your copy's own files |

Every line that deploys nothing holds `Nothing was deployed.` and says what to do. A build that deploys nothing leaves the running install as it was.

### What a release publishes

| On the release's page            | Holds                                                                         | Its SHA-256 digest is in      |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `poplin-<version>.tar.gz`        | the source files, which a build fetches                                       | `releases.json`, as `source`  |
| `poplin-<version>-worker.json`   | a manifest: the version, the schema, and the digest and size of each built file | `releases.json`, as `bundle`  |
| `poplin-<version>-worker.js`     | the built Worker: the one file a deploy of that release uploads               | the manifest                  |
| `poplin-<version>-worker.js.map` | the built Worker's source map                                                 | the manifest                  |

```json
{ "0.3.1": { "source": "<64 hex>", "bundle": "<64 hex>", "schema": 1 } }
```

- **Attested.** GitHub attests each of the four files as made by the project's release workflow, in a run of its main branch. The website names a release only when all four pass, and the built files are the ones the manifest states.
- **Built twice.** The release workflow builds the Worker two times from the release's commit. A release whose two builds differ by one byte is not made.
- **Schema.** `schema` counts the steps the release's database has been through. A release whose number differs from the running install's changes the database. `latest.json` carries the number too.

The website is built after a release is out, so a new release is named there, and in the notice of [A newer version](#a-newer-version), within a day of its release.

A deploy from Cloudflare's build or from a terminal uploads the Worker's source map with it, so an error in Cloudflare's log of the Worker names a source file and its line. No address serves the map.

## The command on your computer

`poplin doctor` names both versions. When they differ, the row says so:

```text
ok  version   install 0.2.0, this poplin 0.1.0: the install and this poplin are of two versions; update the older one
```

`npx poplin@latest doctor` runs the newest command.

## Optional: update with one command

`poplin update` has the install start that build itself, at its update link. The update link is a secret address your host gives. poplin calls it to update itself. Nothing else needs it. Cloudflare calls it a Deploy Hook, and its documentation gives these steps for making one:

| Step | In Cloudflare's dashboard                                  |
| ---- | ---------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker               |
| 2    | go to Settings, then Builds, then Deploy Hooks             |
| 3    | enter a name and select the branch to build: `main`        |
| 4    | select Create and copy the generated URL: the update link  |

```sh
export POPLIN_UPDATE_ADDRESS="paste the update link here"
npx poplin update --save-address
npx poplin update
```

In PowerShell on Windows the first line is this one, and the other two are the same:

```powershell
$env:POPLIN_UPDATE_ADDRESS = "paste the update link here"
```

| Line                           | Does                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `poplin update --save-address` | saves the update link in the install, once; the install never shows it again                 |
| `poplin update`                | starts the build when a newer version is out; `--anyway` starts it whatever the version      |
| `poplin update --check`        | says which version is out and whether an update link is saved; starts nothing                |
| `poplin update --forget-address` | removes the saved update link                                                              |

The dashboard does the same in Settings, under Updates: beside Update link, press Add, paste it, and press Save. Remove takes it out.

The install takes an update link of this form alone, and only an admin's login saves it or starts an update. One update a minute can be started. [Security](../about/security.md#who-holds-which-credential) says what the link can do.

```text
https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<DEPLOY_HOOK_ID>
```

Cloudflare builds neither an install made from a terminal nor one the OpenTofu module made, so neither has an update link unless you connect a build of your own. With none saved, `poplin update` answers `no_update_address` and starts nothing.

## Optional: update by itself

With the setting `auto_update` on, the install starts that build itself. It is off in a new install.

```sh
npx poplin config auto_update on
```

| It starts an update when all of these hold               | Otherwise                                             |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `auto_update` and `update_check` are both on             | nothing starts by itself                              |
| the project's website answered that day                  | nothing starts that day                               |
| a version newer than the install's is out                | nothing starts                                        |
| the release does not change the database                 | it never starts by itself: you start it               |
| 3 days passed since the install first knew of the version | it waits                                             |
| an update link is saved                                  | nothing starts                                        |
| it has not started that version, or a newer one, before  | it never starts one version twice                     |

| Question                 | Answer                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| When it looks            | once a UTC day, right after it asked which version is the newest: a start comes 3 to 4 days after the version was first seen |
| A release that changes the database | waits for you: press Update now in the dashboard, or run `poplin update`                    |
| A start Cloudflare did not take     | tried again the next UTC day, once a day at most                                            |
| A start with no answer from Cloudflare | not started again by itself, since it may have been taken: run `poplin update`           |
| A build that failed after it started | not started again by itself: build again, or run `poplin update`                           |
| Which version is built   | the newest release at the moment the build runs, as every build of the install: [Choose the version](#choose-the-version) |
| Where it shows           | under Activity in the dashboard: `Started an update to 0.2.0 by itself`, by `sweep@poplin.invalid`    |
| Switching it off         | `poplin config auto_update off`                                                                        |

## Choose the version

The build reads one build variable, `POPLIN_VERSION`. Cloudflare's documentation puts build variables in your Worker's Settings, under Build, in Build variables and secrets.

| `POPLIN_VERSION`     | The build deploys                                                            |
| -------------------- | ---------------------------------------------------------------------------- |
| not set, or `latest` | the newest release, never one older than your copy. While the website names no release, the files of your copy |
| a version: `0.2.0`   | that release, checked the same way. This keeps an install on one version, or takes it back to one |
| `this`               | the files of your copy as they are, for changing poplin in your own copy     |

A release refuses a database whose schema a newer release changed. The install then answers `This install's database is newer than its code: update poplin.` until a release that knows that schema is deployed again.

## From a terminal

An install made from a terminal updates with the two commands below. They deploy the files in that folder: nothing is fetched, and `POPLIN_VERSION` is not read. What step 4 gave the Worker stays.

```sh
git -C poplin pull
bun run --cwd poplin deploy
```

## A newer version

While the setting `update_check` is on, the install says when a newer version is out. `poplin update --check` says the same on every kind of install.

```text
$ poplin doctor
ok  install   https://poplin.example.com answers
ok  version   install 0.1.0, this poplin 0.1.0
ok  update    0.2.0 is out (this install runs 0.1.0): https://example.com/changelog/#v0-2-0
ok  login     admin token 3f9a1c07b2d84e65, saved on this machine, expires 2026-12-15
ok  settings  20 settings read
ok  sites     4 sites
ok  trash     0 sites
nothing was changed
```

| Question             | Answer                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| What is checked      | one file on the project's website, `latest.json`, which names the newest release a build can take  |
| How often            | once a UTC day, by the install itself; a day with no answer is tried again the next day            |
| What is sent         | a plain request for the file: no version, no id, and no address of the install is put in it        |
| What Cloudflare adds | a `CF-Worker` header on every request a Worker sends, which names the install's domain             |
| Where it shows       | the foot of the dashboard's side, on every page: `0.2.0 is out` and a link, What changed           |
| Where else           | the `update` row of `poplin doctor`, and `update` under `--json`; no row when nothing newer is out |
| Switching it off     | `poplin config update_check off`: nothing is asked, and a release learned before is not shown      |
| Updating to it       | `poplin update`, once an update link is saved; [Update the install](#update-the-install) has the way of every kind of install |
