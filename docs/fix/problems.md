---
title: Problems
order: 30
---

# Problems

An install remembers what went wrong in it, and the dashboard shows it where it is fixed.

```text
Problems                                   Last 7 days
What                               Last               How often   Where
A request failed                   15 Nov 2026, 17:17 12+ times
The clean-up did not finish        15 Nov 2026, 14:59 3 times
The login could not be checked     15 Nov 2026, 11:59 once        Domain
```

## Where a problem shows

| Where                                   | What it shows                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| a warning sign at Usage, Domain, or Settings, at the side | that screen holds a problem of the last 24 hours; its name says how many |
| the same sign at Domain                 | also what the [last check of the domain](../dashboard/domain.md#the-last-check-of-the-domain) left to do |
| the sections button, on a phone         | the same sign, for all sections together                                         |
| an arrow in a circle at Settings        | no problem: [a newer version is out](../upkeep/update.md#a-newer-version)        |
| Problems, on the Usage screen           | every problem of the last 7 or 30 days; a press on a row opens it                |
| the Domain screen                       | a problem of the login, the users, the rules, or the upload key, with what to do |
| Settings, under Updates                 | an update that did not go as it should, with what to do                                    |
| `poplin doctor`                         | the `problems` row: `failed` for a problem of today, `ok` for none or an older one |

An opened problem says when it came, how often, and what to do. Copy the details copies its kind, its times, the version, and the failure for a report.

`poplin doctor` prints one of these as its `problems` row:

| The row                                                         | When                                |
| --------------------------------------------------------------- | ----------------------------------- |
| `ok  problems  none in 7 days`                                  | no problem came in 7 days           |
| `ok  problems  none today, in 7 days: sweep_failed`             | none came today; older kinds follow |
| `failed  problems  2 types today: request_failed, sweep_failed` | a problem came today                |

## What is noted

| Kind                     | It says                                         | What to do                                          |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| `request_failed`         | A request failed                                | try again; if it comes back, [report it](https://github.com/Vivswan/poplin/issues) |
| `api_failed`             | A publish or a command failed                   | run it again; `poplin doctor` checks the install    |
| `sweep_failed`           | The clean-up did not finish                     | nothing yet: it runs again by itself                |
| `count_unwritten`        | The day's count of storage writes was not saved | nothing, unless it comes back                       |
| `login_unwritten`        | A login was not written to Activity             | nothing: the login itself worked                    |
| `login_unchecked`        | The login could not be checked                  | open Domain and press Check                         |
| `update_failed`          | An update did not go as it should               | the details say what went wrong; to try again, press Update now |
| `update_went_back`       | An update could not change the database, so poplin went back | nothing is lost; [report it](https://github.com/Vivswan/poplin/issues), and update again once a later release is out |
| `users_not_carried`      | A change of the users or the alerts did not take effect | open Domain and press Repair            |
| `rules_not_carried`      | A changed setting did not reach every rule of the domain | open Domain and press Repair               |
| `copy_failed`            | A copy of a site was not made                   | duplicate the site again                            |
| `direct_upload_refused`  | The store refused files sent straight to it, so they went through the install | open Domain and press Repair |
| `login_not_repaired`     | The install could not repair its own login      | open Domain and press Repair                        |
| `files_limit_reached`    | The daily limit of files was reached            | wait for midnight UTC, or raise `max_files_per_day` |
| `writes_limit_reached`   | The daily limit of storage writes was reached   | wait for midnight UTC, or raise `max_storage_writes_per_day` |
| `requests_limit_reached` | The daily limit of requests was reached         | wait for midnight UTC, or raise `requests_per_day`  |

A full minute of requests is never noted: it is the limit at work. A database whose free allowance for the day is used up is not noted either: it takes no note, and the dashboard says so itself.

A daily limit of files or of storage writes is noted once the day has none left. A publish too large for what is left is refused, names the limit, and is not noted: a smaller one still goes through.

## What is kept

| Question            | Answer                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| What is kept        | one entry per kind and UTC day: how often, the first and the last time, the failure's name and message |
| For how long        | 30 days                                                                                             |
| What ends sooner    | of today and the day before: `login_unchecked` and `login_not_repaired` once a check or a repair finds the login standing; `users_not_carried`, `rules_not_carried`, and `direct_upload_refused` once a repair leaves nothing to repair |
| What is never kept  | the address asked, headers, bodies, tokens, emails, visitors' addresses, files                      |
| The message         | only its plain words and short numbers; everything else reads `...`, and it is cut to 200 characters |
| Where it is kept    | in the install's own database; nothing is read from Cloudflare's logs, and nothing is sent anywhere |
| How often it writes | once an hour for each kind, and once a day for a daily limit, so a storm of failures costs 315 written rows a day at the most |
| `12+ times`         | the kind came more often than it was written down: the count is the least it can be                 |

A message can still hold a word that is a name, such as a site's name made of letters alone.
