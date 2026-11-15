---
title: Update
order: 10
---

# Update the install

How each kind of install updates, and the notice of a newer version; the steps it names are those of [By hand](../start/by-hand.md#the-steps).

Nothing updates on its own. An install says when a newer version is out, and how it updates depends on how it was made.

| The install was made      | It updates by                                                       |
| ------------------------- | ------------------------------------------------------------------- |
| with the button of step 2 | three clicks at Cloudflare: [Build again](#build-again)             |
| from a terminal           | two commands in its folder: [From a terminal](#from-a-terminal)     |
| with the OpenTofu module  | a new bundle and an apply: [With OpenTofu](with-opentofu.md)        |

## Build again

For an install made with the button. Cloudflare's documentation gives these steps for building again:

| Step | In Cloudflare's dashboard                                              |
| ---- | ---------------------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker, `poplin`                 |
| 2    | select Deployments, then View build history at the bottom of the page  |
| 3    | select the ellipses next to the newest build, then select Retry build  |

**It worked when** the `version` row of `npx poplin doctor` names the new version. Your sites, settings, and logins stay: the build deploys under the name, the bucket, and the database your copy's `wrangler.jsonc` names.

Run in Cloudflare's build, poplin's deploy fetches a release of poplin from GitHub and deploys that. Your copy on GitHub stays as it is.

```text
in the build's log:   poplin: deploying 0.3.1 (was asked for latest)
```

When it cannot find or fetch the release it deploys nothing, and prints one line that starts with `poplin:`, holds `Nothing was deployed`, and says what to do.

## The command on your computer

`poplin doctor` names both versions. When they differ, the row says so:

```text
ok  version   install 0.2.0, this poplin 0.1.0: the install and this poplin are of two versions; update the older one
```

`npx poplin@latest doctor` runs the newest command.

## Optional: update with one command

`poplin update` has the install start that build itself, at a Deploy Hook you make once. Nothing else needs it. Cloudflare's documentation gives these steps for making one:

| Step | In Cloudflare's dashboard                                  |
| ---- | ---------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker               |
| 2    | go to Settings, then Builds, then Deploy Hooks             |
| 3    | enter a name and select the branch to build: `main`        |
| 4    | select Create and copy the generated URL                   |

```sh
export POPLIN_UPDATE_ADDRESS="paste the URL here"
npx poplin update --save-address
npx poplin update
```

In PowerShell on Windows the first line is this one, and the other two are the same:

```powershell
$env:POPLIN_UPDATE_ADDRESS = "paste the URL here"
```

| Line                           | Does                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `poplin update --save-address` | saves the URL in the install, once; the install never shows it again                         |
| `poplin update`                | starts the build when a newer version is out; `--anyway` starts it whatever the version      |
| `poplin update --check`        | says which version is out and whether a URL is saved; starts nothing                         |
| `poplin update --forget-address` | removes the saved URL                                                                      |

The install takes a URL of this form alone, and only an admin's login saves it or starts an update. One update a minute can be started. [Security](../about/security.md#who-holds-which-credential) says what the URL can do.

```text
https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<DEPLOY_HOOK_ID>
```

Cloudflare builds neither an install made from a terminal nor one the OpenTofu module made, so neither has a Deploy Hook unless you connect a build of your own. With no URL saved, `poplin update` answers `no_update_address` and starts nothing.

## Choose the version

The build reads one build variable, `POPLIN_VERSION`. Cloudflare's documentation puts build variables in your Worker's Settings, under Build, in Build variables and secrets.

| `POPLIN_VERSION`     | The build deploys                                                            |
| -------------------- | ---------------------------------------------------------------------------- |
| not set, or `latest` | the newest release. With no release published, the files of your copy        |
| a version: `0.2.0`   | that release. This keeps an install on one version, or takes it back to one  |
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
ok  settings  19 settings read
ok  sites     4 sites
ok  trash     0 sites
nothing was changed
```

| Question             | Answer                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| What is checked      | one file on the project's website, `latest.json`, which names the newest release                   |
| How often            | once a UTC day, by the install itself; a day with no answer is tried again the next day            |
| What is sent         | a plain request for the file: no version, no id, and no address of the install is put in it        |
| What Cloudflare adds | a `CF-Worker` header on every request a Worker sends, which names the install's domain             |
| Where it shows       | the foot of the dashboard's side, on every page: `0.2.0 is out` and a link, What changed           |
| Where else           | the `update` row of `poplin doctor`, and `update` under `--json`; no row when nothing newer is out |
| Switching it off     | `poplin config update_check off`: nothing is asked, and a release learned before is not shown      |
| Updating to it       | `poplin update`, once a Deploy Hook is saved; [Update the install](#update-the-install) has the way of every kind of install |
