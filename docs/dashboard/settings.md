---
title: Settings
order: 60
---

# Settings

The settings of an install; a site's own settings are in [Manage sites](../sites/manage.md#other-settings-of-a-site).

## Change a setting

```sh
npx poplin config
npx poplin config trash_days 30
```

The dashboard's Settings screen changes the same settings, all but `logins`: change them, then press Save in the bar at the foot. Each setting is a row.

| In a row                        | Means                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ |
| `(Default: 9,000 MB)`           | the setting's default                                                    |
| Reset                           | beside a default the row differs from: puts it back                      |
| a warning under the field, in plain words after a mark | follows the number as it is typed. A number above a free limit earns one: [Limits and cost](../upkeep/cost/what-can-cost-money.md). So does One site above All sites together: `More than all sites together may hold, so that limit is reached first.` And One visitor per minute above One site per minute: `More than one site answers in a minute, so that limit is reached first.` |
| a sentence under the field      | Save refused that value; every refused row gets one at the first Save    |
| `Use a whole number from 1 to 1,000,000,000.` | such a sentence, for a number typed with a fraction, such as `1.5`, or above its top. A count goes up to 1,000,000,000, but Files per publish to 10,000 and One site's share to 100. A size goes up to 1,000,000,000 MB, days and a span of time to 36,500 days |
| `Needs poplin's key to work. Open Domain and press Repair.` | under Update automatically, on an install that holds no key |
| `Takes effect at the next update or Repair.` | under Keep logs, on an install that holds no key |
| `Switch on the check above first.` | under Update automatically while Check for new versions is off. Switching the check off switches Update automatically off with it, and its switch takes no change until the check is on again |

The line after Save says when the change takes effect:

| The line says | Means |
| ------------- | ----- |
| `Saved.` | in effect |
| `Saved. Takes effect at the next Repair.` | a setting under Visitors whose rule only a Repair writes: `block_bots` on every install under a domain, and the other two on one that holds no key. On Domain, press Repair |
| `Saved. Takes effect at the next update or Repair.` | Keep logs, on an install that holds no key |
| `Saved. 1 setting takes effect at the next Repair.` | one such setting, saved together with others that are in effect |

| Heading    | Settings                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| New sites  | `default_expires`, `default_search_engines`, `versions_kept`, `trash_days`                         |
| Visitors   | `search_engines_allowed`, `outside_pages`, `block_bots`                                            |
| Storage    | `max_total_size`, `max_site_size`, `max_sites`                                                     |
| Publishing | `max_files_per_publish`, `max_files_per_day`, `max_storage_writes_per_day`                         |
| Traffic    | `requests_per_day`, `site_share_of_day`, `site_requests_per_minute`, `visitor_requests_per_minute` |
| Logs       | `provider_logs`                                                                                    |
| Updates    | `update_check`, `auto_update`                                                                      |

`logins` is the list under Access, Users: [Add a user](access.md#add-a-user).

A saved `search_engines_allowed` or `outside_pages` also changes its rule at Cloudflare by itself, with [the key poplin keeps](../about/security.md#the-kept-key); `block_bots` changes there at the next Repair on [Domain](domain.md), and so do all three on an install that holds no key.

A saved `provider_logs` changes the Worker's logs at Cloudflare by itself, with the same key, on an install of either kind: [Switch the logs off](activity.md#switch-the-logs-off).

On an install [without a domain](../start/without-a-domain.md), the control of `block_bots` is disabled and says `Needs a domain.`: what it asks for is a switch of a domain at Cloudflare. `search_engines_allowed` and `outside_pages` work there through the Worker alone, and nothing is sent to Cloudflare for them.

## The install

| Example                                                              | Does                                              |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `poplin config`                                                      | shows every setting                               |
| `poplin config versions_kept`                                        | shows one setting                                 |
| `poplin config versions_kept 10`                                     | changes one setting                               |
| `poplin config versions_kept 10 --dry-run`                           | says what the setting would be, or why the install refuses it; changes nothing |
| `poplin doctor`                                                      | checks that the install answers, and prints its version beside this poplin's, as `install 0.1.0, this poplin 0.1.0`; changes nothing |
| `poplin update`                                                      | starts an update of the install to the newest version; `--dry-run` says what it would do |
| `poplin update --to 0.2.0`                                           | takes that version in place of the newest: a lower one [goes back](../upkeep/update.md#go-back) |
| `poplin install cloudflare --domain example.com --login you@example.com` | makes a new install under a domain; `--no-domain` makes one without. Where an install is, it says so and changes nothing: [Install](../start/install.md) |
| `poplin install cloudflare --no-domain --login you@example.com --dry-run` | lists what that would make, with the same options; changes nothing |
| `poplin doctor --repair`                                             | mends the install at Cloudflare, the way back in when nobody can log in; `--dry-run` lists what it would change: [I cannot log in](../fix/cannot-log-in.md) |
| `poplin doctor --repair --add-user new@example.com`                  | the same, and lets one more email log in          |
| `poplin uninstall cloudflare --domain example.com --dry-run`         | lists what a removal would remove; changes nothing |
| `poplin uninstall cloudflare --no-domain`                            | removes the install, after you type its address; `--keep-data` leaves the sites' files and the database: [Remove](../upkeep/remove.md) |
| `poplin help rollback`                                               | shows the help of one command                     |
| `poplin --full-help`                                                 | shows the help of every command on one page       |

`poplin update` works on an install that holds its key: [Update the install](../upkeep/update.md#with-the-kept-key) shows what it does. An install that holds none answers `no_key`, and updates as [Update the install](../upkeep/update.md#update-the-install) says.

`poplin install`, `poplin doctor --repair`, and `poplin uninstall` work at Cloudflare and need no login of poplin. Each asks for an account token, without showing it; a script gives it in `POPLIN_INSTALL_TOKEN`. `poplin doctor` without `--repair` works with this computer's login, and only reads.

The settings `poplin config` takes:

| Setting                                                                                 | Holds                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `default_expires`, `default_search_engines`                                             | what a new site starts with                              |
| `versions_kept`, `trash_days`                                                           | how much is kept, and for how long                       |
| `logins`                                                                                | the emails that may log in                               |
| `outside_pages`, `search_engines_allowed`, `block_bots`                                 | what the install lets in                                 |
| `max_total_size`, `max_site_size`, `max_sites`                                          | size limits                                              |
| `max_files_per_publish`, `max_files_per_day`                                            | how many files one publish holds, and all publishes begun in one UTC day |
| `max_storage_writes_per_day`                                                            | how many times a day the storage is written to or listed |
| `requests_per_day`, `site_share_of_day`, `site_requests_per_minute`, `visitor_requests_per_minute` | request limits                                |
| `update_check`                                                                          | whether the install asks which version is the newest     |
| `auto_update`                                                                           | whether the install starts an update by itself: off in a new install, and on only while `update_check` is on, [Update](../upkeep/update.md#optional-update-by-itself) |
| `provider_logs`                                                                         | whether Cloudflare keeps the lines the Worker writes: on in a new install, [Switch the logs off](activity.md#switch-the-logs-off) |

Every command that talks to the install also takes `--json`, for the answer as JSON, and `--server`, to name the install. The three that work at Cloudflare take `--json` and no `--server`.
