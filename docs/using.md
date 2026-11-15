---
title: Using
order: 20
---

# Using poplin

Every command, every agent tool, and every refusal, each with one example. To get an install first, see [Install](install.md).

```text
You:    Put this report online.           ->  the agent calls publish_site
You:    Share it with anyone I send it.   ->  the agent calls update_site, access unlisted
You:    Take it down.                     ->  the agent calls delete_site
```

An agent uses the tools. A person uses the commands. Both do the same things.

The examples write `poplin`. Type `npx poplin` in its place, as [Install](install.md) does, unless poplin is installed on the computer. `example.com` stands for your own domain.

## How a site is named

```text
report--k3f9x2ab71qz
|       |
|       the id: 12 random characters
the name: taken from the folder or the file
```

That is the label. Every command and tool takes it to name one site. The bare id (`k3f9x2ab71qz`) works too, and so do the public name of a public site (`docs`) and the site's address, pasted whole (`https://report--k3f9x2ab71qz-p-poplin.example.com/`).

## Publish

| Example                                        | Does                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `poplin ./report`                              | makes a new site, private, from a folder            |
| `poplin ./report.html`                         | makes a new site from one HTML file                 |
| `poplin ./report --site report--k3f9x2ab71qz`  | puts new content on that site; the address stays    |
| `poplin ./report --name q3-report`             | makes a new site with that name                     |
| `poplin ./demo --unlisted --expires 7d`        | makes a new site with settings (see below)          |
| `poplin ./report --dry-run`                    | lists the files and the name, and uploads nothing   |

```text
$ poplin ./report
uploaded 3 files, 48 kB
made  report--k3f9x2ab71qz  private
https://report--k3f9x2ab71qz-p-poplin.example.com
```

- **No `--site` means a new site, every time.** Keep the label and pass it to update.
- **A folder needs an `index.html` at its top.**
- **Not uploaded:** hidden files (a name that starts with a dot) and anything named `node_modules`.
- **A name** is 3 to 40 lowercase letters, digits, and single dashes.
- **Ctrl-C** stops a publish, an import, or a copy: the upload on its way is given up, so its site is not made or changed, and the command exits 1. A second Ctrl-C ends it at once.

## Who can open a site

| Access   | Who can open it         | Set it with                                |
| -------- | ----------------------- | ------------------------------------------ |
| private  | only you, after a login | `poplin set report--k3f9x2ab71qz --private`  |
| unlisted | anyone who has the link | `poplin set report--k3f9x2ab71qz --unlisted` |
| public   | everyone                | `poplin set report--k3f9x2ab71qz --public`   |

| Example                                                 | Does                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `poplin set report--k3f9x2ab71qz --public`              | public at its own name: `report-page.example.com`      |
| `poplin set report--k3f9x2ab71qz --public --public-name docs` | public at another name: `docs-page.example.com`  |

- **You** is every login of the install: yourself, and anyone [Install](install.md#add-a-login) adds.
- **To or from private changes the address:** the letter before `-poplin` turns from `p` to `u`, or back. The old address sends visitors on.
- **A public site keeps its unlisted address too.**
- **Leaving public gives the public name up.** That address stops working.

[The address](README.md) shows each part of an address. [Security](security.md) says what each access protects.

## Other settings of a site

A publish takes these flags too.

| Example                                                 | Does                                              |
| ------------------------------------------------------- | ------------------------------------------------- |
| `poplin set report--k3f9x2ab71qz --name q3-report`      | renames it; its id and every address stay         |
| `poplin set report--k3f9x2ab71qz --title "Q3 sales"`    | sets the title your dashboard shows               |
| `poplin set report--k3f9x2ab71qz --expires 7d`          | moves it to the trash in 7 days                   |
| `poplin set report--k3f9x2ab71qz --expires 2026-12-01`  | moves it to the trash on that day                 |
| `poplin set report--k3f9x2ab71qz --expires never`       | keeps it                                          |
| `poplin set report--k3f9x2ab71qz --search-engines on`   | lets search engines list it, once it is public    |
| `poplin set report--k3f9x2ab71qz --embeddable off`      | stops other pages from showing it in a frame      |

## Look, go back, re-link, delete

| Example                                       | Does                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| `poplin list`                                 | lists every site                                              |
| `poplin list --trash`                         | lists the deleted sites                                       |
| `poplin show report--k3f9x2ab71qz`            | shows one site: its address, its settings, its kept versions  |
| `poplin rollback report--k3f9x2ab71qz`        | makes the version before live again                           |
| `poplin rollback report--k3f9x2ab71qz --to 3` | makes version 3 live again                                    |
| `poplin new-link report--k3f9x2ab71qz`        | gives the site a new id; the old address stops at once        |
| `poplin duplicate report--k3f9x2ab71qz`       | makes a private copy, with a new address                      |
| `poplin delete report--k3f9x2ab71qz`          | moves the site into the trash                                 |
| `poplin restore report--k3f9x2ab71qz`         | takes it back out of the trash                                |
| `poplin delete report--k3f9x2ab71qz --forever` | removes it now, after you type its label; nothing restores it |

- **Versions:** an install keeps a few per site. `poplin config versions_kept` shows how many.
- **Trash:** a deleted site waits some days, then it is gone. `poplin config trash_days` shows how many.
- **A new link** is for an address that reached the wrong person. A public site keeps its public name.
- **Pages opened:** `poplin show report--k3f9x2ab71qz` says about how often a site's pages were opened, today and in the last 7 days. The numbers come from a sample, so they read `about 120`. A page a browser shows from its own copy, inside 5 minutes, is not counted.

## Back up and put back

| Example                                              | Does                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `poplin export`                                      | downloads every site and the settings as one zip        |
| `poplin export --all-versions --out backup.zip`      | adds the kept versions, and names the zip               |
| `poplin export report--k3f9x2ab71qz`                 | downloads one site                                      |
| `poplin export --out backup.zip --overwrite`         | replaces a zip that is already there                    |
| `poplin import backup.zip`                           | puts the sites of a zip back                            |
| `poplin import backup.zip --dry-run`                 | checks the zip, lists its sites, and imports nothing    |
| `poplin import backup.zip --site report--k3f9x2ab71qz` | puts one site back                                    |
| `poplin import backup.zip --settings`                | replaces the install's settings too, but for the logins |
| `poplin import backup.zip --settings --logins`       | replaces the logins as well                             |

- **The zip holds plain files.** It holds no token and no signing key.
- **Nothing is overwritten.** A site the install already has is skipped.

## This computer

| Example                                              | Does                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `poplin login --server https://poplin.example.com`   | logs this computer in: you allow it in your browser           |
| `poplin login --publisher --name ci-runner`          | saves a publisher's login, for a computer that should only publish            |
| `poplin login --no-browser`                          | prints the address and opens no browser                       |
| `poplin whoami`                                      | prints the install, the role, and when the login runs out     |
| `poplin logout`                                      | revokes the login and forgets it                              |

```text
$ poplin login --server https://poplin.example.com
  ->  prints an address and a short code
  ->  you open the address, check that the code is the same, and allow it
  ->  the login is saved on this computer
```

An install begins five logins a minute for all computers together. In a minute that is full, `poplin login` waits and asks again.

A computer keeps one saved login: a new `poplin login` replaces it. An agent on the computer uses that login and does not log in itself. `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment stand in for a saved login.

`POPLIN_CONFIG_DIR` in the environment names another folder for the saved login, read when the two names above are not set. Set for an agent's tools alone, it gives the agent a login of its own, which shows under its own name: [the skill's page](../skills/poplin/references/mcp-server.md#optional-a-login-of-your-own) has the step.

`--publisher` is for a computer or a script that should only publish, such as a build server or a shared machine.

| A publisher's login | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| can                 | publish, and for the sites it published: list, show, update, change who can open, roll back, re-link, copy, delete, and restore |
| cannot              | reach a site another login published, or the install's settings, logins, backups, and updates                                   |

## The install

| Example                                                              | Does                                              |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `poplin config`                                                      | shows every setting                               |
| `poplin config versions_kept`                                        | shows one setting                                 |
| `poplin config versions_kept 10`                                     | changes one setting                               |
| `poplin doctor`                                                      | checks that the install answers, and prints its version beside this poplin's, as `install 0.1.0, this poplin 0.1.0`; changes nothing |
| `poplin update`                                                      | starts an update of the install to the newest version; `--check` says what it would do |
| `poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com` | finishes a new install, as its setup page does |
| `poplin setup --check --server https://poplin.your-name.workers.dev` | lists what that would change, with the same flags; changes nothing |
| `poplin help rollback`                                               | shows the help of one command                     |

`poplin update` needs a Deploy Hook saved in the install once: [Install](install.md#update-the-install) shows how. It is read from `POPLIN_UPDATE_ADDRESS` in the environment, and no command prints it.

An install made with the Deploy button has a build at Cloudflare to make the Deploy Hook for. One made from a terminal or with the OpenTofu module has none: with no URL saved it answers `no_update_address`, and updates as [Install](install.md#update-the-install) says.

`poplin setup` reads the Cloudflare API token from `POPLIN_SETUP_TOKEN` in the environment. A new install needs `--domain` and `--login`. On an install that has them, `--login` alone corrects a first login that was mistyped. It needs no login, and it works only until the first login to the install. [Install](install.md#from-a-terminal-instead) shows where it fits.

The settings `poplin config` takes:

| Setting                                                                                 | Holds                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `default_expires`, `default_search_engines`                                             | what a new site starts with                              |
| `versions_kept`, `trash_days`                                                           | how much is kept, and for how long                       |
| `logins`                                                                                | the emails that may log in                               |
| `dashboard_title`                                                                       | the dashboard's title                                    |
| `outside_pages`, `search_engines_allowed`, `block_bots`                                 | what the install lets in                                 |
| `max_total_size`, `max_site_size`, `max_sites`                                          | size limits                                              |
| `max_files_per_publish`, `max_files_per_day`                                            | how many files one publish holds, and all publishes begun in one UTC day |
| `max_storage_writes_per_day`                                                            | how many times a day the storage is written to or listed |
| `requests_per_day`, `site_share_of_day`, `site_requests_per_minute`, `visitor_requests_per_minute` | request limits                                |
| `update_check`                                                                          | whether the install asks which version is the newest     |

An import and a copy count as a publish, with every version an import holds. A publish that is given up or runs out gives none of the day's files back.

The day's writes to the storage are counted like this:

| What                                              | Counts                          |
| ------------------------------------------------- | ------------------------------- |
| a publish or an import, when it begins            | 1 for each file it declares     |
| a copy, when it begins                            | 2 for each file                 |
| a listing of the storage, when it is made         | 1                               |
| a file whose write fails                          | 1                               |
| a file the storage already holds, sent again      | nothing                         |
| a read, a delete                                  | nothing                         |

On the free Workers plan, a month at the settings a new install starts with stays inside what R2 takes for free:

| R2 operations         | Free a month | At most, in a month of 31 full days |
| --------------------- | ------------ | ----------------------------------- |
| writes and listings   | 1,000,000    | 991,000                             |
| reads                 | 10,000,000   | 9,765,000                           |

A finish, a look at an upload, a delete, a copy, and a backup's list of files each list the storage. At the limit they answer `allowance_spent` until 00:00 UTC; a delete still removes the site, and its files go later.

Every command that talks to the install also takes `--json`, for the answer as JSON, and `--server`, to name the install.

## A newer version

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
| Updating to it       | `poplin update`, once a Deploy Hook is saved; [Install](install.md#update-the-install) has the way of every kind of install |

## The last check of the domain

```text
$ poplin doctor
ok  domain    The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.
```

| Question          | Answer                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What is kept      | the last Check or Repair of the Domain tab: when it ran, who ran it, and how each piece stood            |
| What is not kept  | the token, which is used for the one request                                                             |
| What the row says | the most serious thing to act on: the login first, then records and routes, then any other piece         |
| When there is one | only when that run left something to act on, and only for an admin; `domain` under `--json` has the same |
| After 30 days     | the row only asks for a new Check: the install does not look at the domain between runs                  |
| Optional pieces   | a rule that was left out, or that only lacks an optional right, raises no row                            |

## The agent tools

`poplin mcp` runs the MCP server on this computer. An agent starts it and calls these tools:

| Tool            | Example input                                              | Same as                                       |
| --------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `publish_site`  | `{ "path": "./report" }`                                   | `poplin ./report`                             |
| `publish_site`  | `{ "path": "./report", "site": "report--k3f9x2ab71qz" }`   | `poplin ./report --site report--k3f9x2ab71qz` |
| `update_site`   | `{ "site": "report--k3f9x2ab71qz", "access": "unlisted" }` | `poplin set report--k3f9x2ab71qz --unlisted`  |
| `get_site`      | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin show report--k3f9x2ab71qz`            |
| `list_sites`    | `{ "trash": true }`                                        | `poplin list --trash`                         |
| `rollback_site` | `{ "site": "report--k3f9x2ab71qz", "version": 3 }`         | `poplin rollback report--k3f9x2ab71qz --to 3` |
| `new_link`      | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin new-link report--k3f9x2ab71qz`        |
| `delete_site`   | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin delete report--k3f9x2ab71qz`          |
| `restore_site`  | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin restore report--k3f9x2ab71qz`         |
| `duplicate_site` | `{ "site": "report--k3f9x2ab71qz" }`                      | `poplin duplicate report--k3f9x2ab71qz`       |

- **`publish_site` and `update_site` take the site settings:** `name`, `access`, `public_name`, `title`, `search_engines`, `embeddable`, `expires`.
- **`delete_site` with `"forever": true`** removes the site at once, with no trash.
- **The agent's rules** are in the skill: [`skills/poplin/SKILL.md`](../skills/poplin/SKILL.md).

## What a visitor sees

| A visitor opens                                  | Sees                                         |
| ------------------------------------------------ | -------------------------------------------- |
| an unlisted or a public site                     | the site                                     |
| a private site, logged in as you                 | the site                                     |
| a private site, not logged in                    | the login                                    |
| a page a site does not have                      | the `404.html` at the site's root; `Not found` for a site without one |
| the `-poplin` address of a deleted or expired site, or one from before a new link | the login; `Not found` once logged in |
| a public name no site holds                      | `Not found`                                  |
| any site, too often in a minute                  | `Too many requests. Try again in 60 seconds.` |
| any site, once the day's free allowance of the database for reading is used up | `This site is paused until midnight UTC.` |

A site whose files without an extension have over 16,384 characters of names between them answers `Not found` for a missing page without an extension, even when it has a `404.html`.

## When poplin refuses

A refused command prints one sentence and often a hint. With `--json` it prints an object with a `code`. A tool answers with the same object.

**Logging in, and reaching the install**

| Code                                           | Means                                              | What to do                                                    |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `no_login`, `no_server`                        | this computer has no login                         | `poplin login --server https://poplin.example.com`            |
| `not_logged_in`                                | the login ran out                                  | `poplin login`                                                |
| `login_denied`, `login_expired`, `interrupted` | the login was not allowed; nothing was saved       | `poplin login` again, and allow it in the browser             |
| `bad_login`                                    | the saved login cannot be used                     | `poplin login` again                                          |
| `bad_server`                                   | `--server` takes an `https://` address, host only  | `--server https://poplin.example.com`                         |
| `wrong_server`                                 | the login is for another install                   | log in to this one with `--server`                            |
| `not_allowed`                                  | this login may not do that                         | `poplin whoami` shows the login; use an admin's               |
| `not_set_up`                                   | the install has stored no settings                 | try again; if it stays, deploy the install again              |
| `no_working_login`                             | the new logins would let nobody log in             | keep one email that is a login now in the list                |
| `unreachable`, `timeout`                       | no answer came                                     | check the address and the network; `poplin list` before a retry |
| `not_json`, `unexpected_answer`                | the answer is not a poplin install's               | `poplin whoami` shows the address in use                      |
| `method_not_allowed`, `unsupported_media_type` | the install and this poplin are of two versions    | update the older one                                          |
| `too_many_requests`                            | asked too often                                    | wait a minute                                                 |
| `allowance_spent`                              | a day's allowance is used up: the database's, or `max_storage_writes_per_day` | wait until 00:00 UTC; asking sooner is refused the same way  |
| `internal`, `crashed`                          | something failed                                   | try again; `poplin doctor` reports on the install             |

**Updating an install**

| Code                 | Means                                                       | What to do                                                     |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `no_update_address`  | the install has no Deploy Hook saved                        | put its URL in `POPLIN_UPDATE_ADDRESS`, then `poplin update --save-address`; an install with no Deploy Hook updates as [Install](install.md#update-the-install) says |
| `no_address_to_save` | `POPLIN_UPDATE_ADDRESS` holds no URL                        | put the Deploy Hook's URL in it for this one command           |
| `no_update`          | no newer version is known to the install                    | `poplin update --anyway` rebuilds all the same                 |
| `update_refused`     | Cloudflare refused to start the build, with the status shown | make a new Deploy Hook and save it                             |
| `update_unreachable` | Cloudflare did not answer in time; the build may have started | wait a minute, then try again                                |

**Setting up an install**

| Code                    | Means                                                       | What to do                                                    |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `no_setup_server`       | `poplin setup` was given no address                         | `poplin setup --server https://poplin.your-name.workers.dev`  |
| `no_setup_token`        | `POPLIN_SETUP_TOKEN` holds no token                         | put the token of [Install](install.md), step 3, in it         |
| `setup_token_refused`   | the token was refused, or it is of another account          | make one with the rights step 3 lists, in the install's account |
| `setup_provider_silent` | Cloudflare gave the install no answer, or asked it to wait  | try again in a minute                                         |
| `setup_no_domain`       | the token shows no such domain                              | give `--domain` a domain that is Active in the token's account |
| `setup_bad_domain`      | `--domain` holds more than a domain, or one over 50 characters | the domain alone: `--domain example.com`                   |
| `setup_bad_login`       | `--login` holds no email address                            | a new install needs both: `--domain <domain> --login <email>` |
| `setup_closed`          | nothing at that address takes a setup                       | after the first login, use the dashboard's Domain tab         |

**Naming a site**

| Code                          | Means                                         | What to do                                                    |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `not_found`                   | no site with that label or public name        | `poplin list`                                                 |
| `in_trash`                    | the site is in the trash                      | `poplin restore report--k3f9x2ab71qz`                         |
| `not_in_trash`                | the site is not in the trash                  | nothing                                                       |
| `no_such_version`             | the site keeps no such version                | `poplin show report--k3f9x2ab71qz` lists them                 |
| `name_taken`, `reserved_name` | the public name is held                       | `poplin set report--k3f9x2ab71qz --public --public-name docs` |
| `bad_name`                    | the name breaks the rules                     | 3 to 40 lowercase letters, digits, and single dashes          |
| `bad_argument`                | an argument is missing or malformed           | `poplin help set` shows what a command takes                  |
| `usage-error`                 | the command line names something unknown      | `poplin help` lists every command                             |
| `not_confirmed`               | the label you typed is not the site's         | nothing was deleted; run it again                             |
| `no_terminal`                 | `--forever` needs a terminal to ask on        | delete without it: the site goes to the trash                 |

**Publishing**

| Code                                              | Means                                            | What to do                                                   |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `unreadable`                                      | the path cannot be published                     | check the path                                               |
| `no_index`                                        | the folder has no `index.html` at its top        | add one, or publish one HTML file                            |
| `no_name`                                         | the path gives no name                           | `poplin ./report --name q3-report`                           |
| `bad_path`                                        | a file's path cannot be served                   | rename or remove that file                                   |
| `too_large`                                       | a size limit is passed                           | `poplin config` shows the limits                             |
| `too_many_sites`                                  | the install holds as many sites as it may        | `poplin config max_sites`; `poplin list --trash` still counts |
| `size_mismatch`, `stale_version`, `missing_files` | the publish did not complete; nothing went live  | publish again                                                |
| `upload_finished`                                 | the publish is already live                      | nothing                                                      |
| `stopped`                                         | you stopped the command with Ctrl-C              | run it again; an upload not given up runs out in about a day |

**Backups**

| Code             | Means                                            | What to do                                   |
| ---------------- | ------------------------------------------------ | -------------------------------------------- |
| `file_exists`    | the zip is already there                         | `poplin export --out backup.zip --overwrite` |
| `unwritable`     | the zip cannot be written                        | name another place with `--out`              |
| `other_format`   | the install's backups are newer than this poplin | update poplin                                |
| `site_changed`   | a site changed while it was exported             | export again                                 |
| `bad_backup`     | the file is not a backup; nothing was sent       | pass a zip that `poplin export` made         |
| `backup_too_new` | the backup is newer than the install             | update the install, then import again        |
| `no_settings`    | the zip is one site's backup: it has no settings | import it without `--settings`               |
| `not_in_backup`  | the zip holds no such site                       | `poplin import backup.zip --dry-run`         |
| `id_taken`       | the install already has that site                | `poplin show report--k3f9x2ab71qz`           |
