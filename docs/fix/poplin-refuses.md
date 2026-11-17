---
title: When poplin refuses
order: 20
---

# When poplin refuses

Every code poplin refuses with, what it means, and what to do. The lines a command stops at are on its own page: [When the install stops](an-install-step-fails.md) for `poplin install`, [I cannot log in](cannot-log-in.md#when-it-stops) for `poplin doctor --repair`, and [Remove](../upkeep/remove.md#when-it-stops) for `poplin uninstall`.

A refused command prints one sentence and often a hint. With `--json` it prints an object with a `code`. A tool answers with the same object. Every example runs as the first does, with `npx` before `poplin`.

**Logging in, and reaching the install**

| Code                                           | Means                                              | What to do                                                    |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `no_login`, `no_server`                        | this machine has no login                         | `npx poplin login --server https://poplin.example.com`        |
| `not_logged_in`                                | the login ran out                                  | `poplin login`                                                |
| `login_denied`, `login_expired`, `interrupted` | the login was not allowed; nothing was stored       | `poplin login` again, and allow it in the browser             |
| `bad_login`                                    | the stored login cannot be used                     | `poplin login` again                                          |
| `bad_server`                                   | `--server` takes an `https://` address, host only  | `--server https://poplin.example.com`                         |
| `wrong_server`                                 | the login is for another install                   | log in to this one with `--server`                            |
| `not_allowed`                                  | this login may not do that                         | `poplin whoami` shows the login; use an admin's               |
| `not_set_up`                                   | the install has stored no settings                 | try again; if it stays, run `npx poplin doctor --repair`       |
| `no_working_login`                             | the new logins would let nobody log in             | keep one email that is a login now in the list                |
| `needs_update_check`                           | `auto_update` would be on with `update_check` off  | `poplin config update_check on` first, or `auto_update off` first |
| `already_a_login`, `not_a_login`               | the email is a login already, or is none           | `poplin config logins` shows the logins                       |
| `unreachable`, `timeout`                       | no answer came                                     | check the address and the network; `poplin list` before a retry |
| `not_json`, `unexpected_answer`                | the answer is not a poplin install's               | `poplin whoami` shows the address in use                      |
| `method_not_allowed`, `unsupported_media_type` | the install and this poplin are of two versions    | update the older one                                          |
| `too_many_requests`                            | asked too often                                    | wait a minute                                                 |
| `allowance_spent`                              | a day's allowance is used up: the database's, or `max_storage_writes_per_day` | wait until 00:00 UTC; asking sooner is refused the same way  |
| `internal`, `crashed`                          | something failed                                   | try again; `poplin doctor` reports on the install             |
| `logins_not_ended`                             | Cloudflare did not end the dashboard's logins, or gave no answer | open Domain in the dashboard and press Repair, then ask again |

**Updating an install**

| Code                 | Means                                                       | What to do                                                     |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `no_update`          | there is no newer version the install can take              | `poplin update --dry-run` says which version the install runs    |
| `update_unreachable` | Cloudflare did not answer; the new version may be in         | wait a minute, then `poplin update --dry-run`                    |
| `no_key`, `key_refused` | the install holds no key, or Cloudflare no longer takes it | press Repair on the dashboard's Domain screen                  |
| `lacks_right`        | the install's key lacks the permission shown                | press Repair on the dashboard's Domain screen: it makes a key with the permission |
| `release_refused`    | the release cannot be taken, for the reason shown; nothing was changed | [With the kept key](../upkeep/update.md#with-the-kept-key) has each reason. Where its hint says the install cannot take this release by itself, run `npx poplin doctor --repair --update` |
| `version_refused`    | Cloudflare refused the new version; the install runs the version it ran | try again; if it comes back, [report it](https://github.com/Vivswan/poplin/issues) |

**Making, mending, and removing an install**

Three commands work at Cloudflare with an account token: `poplin install`, `poplin doctor --repair`, and `poplin uninstall`. With `--json` each prints one object. A run that stopped before its work names why in `problem`, where the other commands write `code`.

A run's object, and a stopped run's, names what to run next in `next`: [Install](../start/install.md#every-answer-as-an-option) has its words.

| Problem             | Means                                                              | What to do                                                      |
| ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `missing_answer`    | a run that asks nothing lacks an answer; `missing` lists each: where, user, token, account, provider, confirm | give its option or variable: [Every answer as an option](../start/install.md#every-answer-as-an-option) |
| `usage`             | the line is written wrong; `words` says how                        | the command's own help: `npx poplin install --help`             |
| `already_installed` | the account holds an install; `found` has its version, its address, and in `mend` whether it needs mending | nothing was changed: run what `next` names, the login for `mend` nothing, and for the rest the repair as `next.command` writes it |
| `leftover`          | a bucket or a database named like poplin's, and no install         | run again with `--adopt` to use it; or delete it at `address`    |
| `name_held`         | a Worker named poplin that is not poplin's own, or an install's Worker that lost a binding; `words` says which | do what `words` says at `address`, then run what `next` names |
| `blocked`           | a person must act first; `blocked` lists what, with the address to open | the table below                                            |
| `token_refused`     | Cloudflare refused the token, or it shows no such account          | make the token again, for the account the install goes to       |
| `no_domain`         | the token shows no active domain of that name                      | correct `--domain`, or the token's Zone Resources               |
| `no_provider`       | this build of poplin carries no provider to install at             | run the published package: `npx poplin install`                 |
| `unreachable`       | Cloudflare or poplin's website gave no answer                      | run it again in a minute                                        |
| `stopped`, `crashed` | the command was stopped, or failed with no word for it            | run it again                                                    |

`poplin doctor --repair` and `poplin uninstall` stop with some of those, and with these:

| Problem           | From               | Means                                                                    | What to do                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `no_install`      | both               | the account holds no install; or a removal with `--keep-data` found kept data alone | make the token in the account the install is in; for kept data, run the removal without `--keep-data` |
| `other_place`     | both, and `install` | the install is of another place than the line named; for `install` and the removal, also one that was started and not finished | give `--domain` and its domain, or `--no-domain`, as `words` says: `next.command` holds no place |
| `changed`         | both               | the account changed between the look and the work; nothing was done      | run it again                                                      |
| `unfinished`      | the repair         | an install was started and never set, so there is nothing to mend        | finish it with `next.command`: the install at the place of the line. Where it was started for another place than the line named, `next.command` has that place's option |
| `another_version` | the repair         | the install's records are of another version than this command, or the install runs a newer release than the newest this command reads           | `next.command`: `npx poplin@latest doctor --repair`, with the option of the install's place, and `--update` where the line had it. For an install that is behind, with records older than this command reads: `npx poplin doctor --repair --update`, and `words` also names the poplin of the install's version, which mends without updating |
| `not_confirmed`   | the removal        | the address typed, or given with `--confirm`, is not the install's own; nothing was removed | give the address a run with `--dry-run` prints |

A repair or a removal that worked through its rows prints them, with `ready` false where a row is left undone. A removal lists in `unlooked` each kind its token could not look for. After a run that lists one, `next` names the removal again: with the permission added to the token, the same line looks for that kind.

Each entry of `blocked` names what blocks in `what`:

| What            | Means                                                           | What to do                                                       |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `storage_off`   | R2 is not switched on, or the token may not use it              | switch R2 on; check the token has Workers R2 Storage: Edit       |
| `login_off`     | Zero Trust is not switched on: nobody could log in              | pick the Free plan at `address`, before the run                  |
| `right_lacking` | the token lacks the permission in `right`                       | [add it to the token](an-install-step-fails.md#add-a-permission-to-the-token) |
| `no_address`    | without a domain: the account has no `workers.dev` subdomain, or one of more than 36 characters | set one of 36 characters at most, under Workers & Pages |
| `no_release`    | poplin's website names no version to install: none is out, or one came out minutes ago | run it again in a few minutes |
| `newer_release` | the newest version needs a newer command                        | `npx poplin@latest install cloudflare`                           |
| `bad_release`   | the release's files are not the ones poplin's website names; nothing was uploaded | run it again; if it comes back, [report it](https://github.com/Vivswan/poplin/issues) |

**Naming a site**

| Code                          | Means                                         | What to do                                                    |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `not_found`                   | no site with that label or public name        | `poplin list`                                                 |
| `in_trash`                    | the site is in the trash                      | `poplin restore report--k3f9x2ab71qz`                         |
| `not_in_trash`                | the site is not in the trash                  | nothing                                                       |
| `no_such_version`             | the site keeps no such version                | `poplin show report--k3f9x2ab71qz` lists them                 |
| `copy_gone`                   | a copy stopped                                | `poplin list`; if the site is not there, `poplin duplicate report--k3f9x2ab71qz` |
| `name_taken`, `reserved_name` | the public name is held                       | `poplin set report--k3f9x2ab71qz --public --public-name docs` |
| `bad_name`                    | the name breaks the rules                     | 3 to 40 lowercase letters, digits, and single dashes          |
| `bad_argument`                | an argument is missing or malformed           | `poplin help set` shows what a command takes                  |
| `usage-error`                 | the command line names something unknown      | `poplin help` lists every command                             |
| `not_confirmed`               | the label you typed is not the site's         | nothing was deleted; run it again                             |
| `no_terminal`                 | `--no-trash` needs a terminal to ask on        | delete without it: the site goes to the trash                 |

**Publishing**

| Code                                              | Means                                            | What to do                                                   |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `unreadable`                                      | the path cannot be published                     | check the path                                               |
| `no_index`                                        | the folder has no `index.html` at its top        | add one, or publish one HTML file                            |
| `no_name`                                         | the path gives no name                           | `poplin ./report --name q3-report`                           |
| `root_links`                                      | the install has no domain, and a page links with a path that starts with `/`; nothing was sent | write the link from its own page: `css/site.css` for `/css/site.css` |
| `bad_path`                                        | a file's path cannot be served                   | rename or remove that file                                   |
| `too_large`                                       | a size limit is passed                           | `poplin config` shows the limits                             |
| `too_many_sites`                                  | the install holds as many sites as it may        | `poplin config max_sites`; `poplin list --trash` still counts |
| `size_mismatch`, `stale_version`, `missing_files` | the publish did not complete; nothing went live  | publish again                                                |
| `hash_mismatch`                                   | a file changed after it was read, or was damaged on its way; nothing went live | publish again once the folder is still |
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
