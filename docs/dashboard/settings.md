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
| a warning mark after the field  | follows the number as it is typed; [Limits and cost](../upkeep/cost/what-can-cost-money.md) says what earns one |
| a sentence under the field      | Save refused that value; every refused row gets one at the first Save    |
| `Use a whole number, 1 or more.` | such a sentence, for a number typed with a fraction, such as `1.5`      |
| `Needs poplin's key to work. Open Domain and press Repair.` | under Update automatically, on an install that holds no key |

| Heading    | Settings                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| New sites  | `default_expires`, `default_search_engines`, `versions_kept`, `trash_days`                         |
| Visitors   | `search_engines_allowed`, `outside_pages`, `block_bots`                                            |
| Storage    | `max_total_size`, `max_site_size`, `max_sites`                                                     |
| Publishing | `max_files_per_publish`, `max_files_per_day`, `max_storage_writes_per_day`                         |
| Traffic    | `requests_per_day`, `site_share_of_day`, `site_requests_per_minute`, `visitor_requests_per_minute` |
| Updates    | `update_check`, `auto_update`                                                                      |

`logins` is the list under Access, Users: [Add a user](access.md#add-a-user).

A saved `search_engines_allowed` or `outside_pages` also changes its rule at Cloudflare by itself, with [the key poplin keeps](../about/security.md#the-kept-key); `block_bots` changes there at the next Repair on [Domain](domain.md), and so do all three on an install that holds no key.

On an install [without a domain](../start/without-a-domain.md), the control of `block_bots` is disabled and says `Needs a domain.`: what it asks for is a switch of a domain at Cloudflare. `search_engines_allowed` and `outside_pages` work there through the Worker alone, and nothing is sent to Cloudflare for them.

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

`poplin update` works on an install that holds its key: [Update the install](../upkeep/update.md#with-the-kept-key) shows what it does. An install that holds none answers `no_key`, and updates as [Update the install](../upkeep/update.md#update-the-install) says.

`poplin setup` reads the account token from `POPLIN_SETUP_TOKEN` in the environment. A new install needs `--domain` and `--login`. On an install that has them, `--login` alone corrects a first login that was mistyped. It needs no login, and it works only until the first login to the install. [From a terminal instead](../start/from-a-terminal.md) shows where it fits.

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
| `auto_update`                                                                           | whether the install starts an update by itself: off in a new install, [Update](../upkeep/update.md#optional-update-by-itself) |

Every command that talks to the install also takes `--json`, for the answer as JSON, and `--server`, to name the install.
