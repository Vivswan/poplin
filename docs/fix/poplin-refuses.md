---
title: When poplin refuses
order: 20
---

# When poplin refuses

Every code poplin refuses with, what it means, and what to do; a failure of an install's steps is in [When a step fails](an-install-step-fails.md).

A refused command prints one sentence and often a hint. With `--json` it prints an object with a `code`. A tool answers with the same object. Every example runs as the first does, with `npx` before `poplin`.

**Logging in, and reaching the install**

| Code                                           | Means                                              | What to do                                                    |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `no_login`, `no_server`                        | this computer has no login                         | `npx poplin login --server https://poplin.example.com`        |
| `not_logged_in`                                | the login ran out                                  | `poplin login`                                                |
| `login_denied`, `login_expired`, `interrupted` | the login was not allowed; nothing was saved       | `poplin login` again, and allow it in the browser             |
| `bad_login`                                    | the saved login cannot be used                     | `poplin login` again                                          |
| `bad_server`                                   | `--server` takes an `https://` address, host only  | `--server https://poplin.example.com`                         |
| `wrong_server`                                 | the login is for another install                   | log in to this one with `--server`                            |
| `not_allowed`                                  | this login may not do that                         | `poplin whoami` shows the login; use an admin's               |
| `not_set_up`                                   | the install has stored no settings                 | try again; if it stays, deploy the install again              |
| `no_working_login`                             | the new logins would let nobody log in             | keep one email that is a login now in the list                |
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
| `no_update`          | there is no newer version the install can take              | `poplin update --check` says which version the install runs    |
| `update_unreachable` | Cloudflare did not answer; the new version may be in         | wait a minute, then `poplin update --check`                    |
| `no_key`, `key_refused` | the install holds no key, or Cloudflare no longer takes it | press Repair on the dashboard's Domain screen                  |
| `lacks_right`        | the install's key lacks the right shown                     | press Repair on the dashboard's Domain screen: it makes a key with the right |
| `release_refused`    | the release cannot be taken, for the reason shown; nothing was changed | [With the kept key](../upkeep/update.md#with-the-kept-key) has each reason |
| `version_refused`    | Cloudflare refused the new version; the install runs the version it ran | try again; if it comes back, report it             |

**Setting up an install**

| Code                    | Means                                                       | What to do                                                    |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `no_setup_server`       | `poplin setup` was given no address                         | `poplin setup --server https://poplin.your-name.workers.dev`  |
| `no_setup_token`        | `POPLIN_SETUP_TOKEN` holds no account token                 | put the token of [by hand](../start/by-hand.md#the-steps), step 3, in it |
| `setup_token_refused`   | the account token was refused, or it is of another account  | make one with the rights [step 3](an-install-step-fails.md#step-3-the-form-opens-empty) lists, in the install's account |
| `setup_provider_silent` | Cloudflare gave the install no answer, or asked it to wait  | try again in a minute                                         |
| `setup_no_domain`       | the account token shows no such domain                      | give `--domain` a domain that is Active in the token's account |
| `setup_bad_domain`      | `--domain` holds more than a domain, or one over 50 characters | the domain alone: `--domain example.com`                   |
| `setup_bad_address`     | no `--domain`, and `--server` is not the Worker's own `workers.dev` address | give `--server` that address, or add `--domain <domain>`     |
| `setup_bad_login`       | `--login` holds no email address                            | a new install needs `--login <email>`, and `--domain <domain>` with a domain |
| `setup_closed`          | nothing at that address takes a setup                       | check the address; after the first login, leave out `--check` |

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
| `no_terminal`                 | `--forever` needs a terminal to ask on        | delete without it: the site goes to the trash                 |

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
