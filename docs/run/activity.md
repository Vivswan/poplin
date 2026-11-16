---
title: Activity
order: 35
---

# Activity

The dashboard's Activity screen lists every change of a site, a token, or a setting, the newest first, and saves the list as files. [Security](../about/security.md#hardening) names the actions it holds.

## Read the log

| On the screen                        | Does                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| All activity                         | narrows the list to Sites, Access, or Settings                               |
| Find by site                         | keeps the entries about the sites the text finds: [the search](#find-by-site) |
| Only this site, at the end of a row  | shows that site's entries, also those from before a rename or a new link    |
| `Only Q3 sales`, beside the search   | names the one site whose entries are shown; Show every site, on it, takes it away |
| UTC, Your time                       | writes every time in UTC, or in the browser's time zone                      |
| When, or When (UTC) while UTC is on  | the heading of the times; a press on it puts the oldest first                |
| `1 to 50 of 1,234`                   | at the foot: which entries the page shows, of how many                       |
| 50 per page                          | holds 100 or 200 entries a page; the browser keeps the choice                |
| First page, Previous page, Next page | go to the pages around the one shown; a new page shows from its first entry  |
| Search further                       | under a filtered list: looks through the next 5,000 entries                  |

The total is counted through the newest 10,000 entries. A longer log reads `1 to 50 of 10,000+`.

A filtered list looks through 5,000 entries at a time, and its total through the newest 5,000. Where it stopped before the log's end, the screen says how far it looked, and Search further goes on from there.

| The list stopped                                 | The screen says                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| with some entries found                          | `Searched the newest 5,000 entries.`                                                       |
| with none found                                  | `Nothing in the newest 5,000 entries.`, then `Older entries are not searched yet.`         |
| again, after Search further from the first page  | the count of all it looked through, as in `Nothing in the newest 10,000 entries.`          |
| on a page that Next page or Previous page led to | `Searched 5,000 more entries.`, or `Nothing in 5,000 more entries.`                        |

With none found, Show all activity stands beside Search further. With the oldest first, the first stop says `oldest` for `newest`. The second line names the side the search has not reached: `Older entries are not searched yet.`, or `Newer entries are not searched yet.`

## Find by site

| The text is in                                   | Found |
| ------------------------------------------------ | ----- |
| the site's title or its name, as they are now    | yes   |
| the name the site had when the entry was written | yes   |
| a public site's public name                      | yes   |

- **The text is matched** as [Find a site](../use/manage-sites.md#in-the-dashboard) matches it: `Sales` finds `q3-sales`.
- **The Site column shows the title the site has now**, as a link to the site. A site with no title shows the name it had then.
- **An entry from before a site's New link** shows its site the same way.
- **A site that is gone for good** stays in grey, under the name it had then.

## Save the log as files

Download, at the top of the screen, saves what the filters keep, the newest first.

| In the menu | The file                           | Holds                                                                   |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------- |
| CSV         | `poplin-activity-2026-11-15.csv`   | the columns `When (UTC)`, `Who`, `What`, `Site`, `Title`, `Action`      |
| JSON Lines  | `poplin-activity-2026-11-15.jsonl` | one JSON object a line: the same six, and `detail`, what the action set |

- **`Site` is the name the site had then, `Title` the title it has now.** A site with no title, or one that is gone for good, has none.
- **A file holds 2,000 entries at the most.** After a full file of the whole log that is not the last, the screen says `Downloaded 2,000.`, with the button Download the next 2,000. The menu has Next 2,000 too.
- **A file that is not the last says so** in its last line: `2,000 entries. The log holds more: download the next part.`
- **After a file of a filtered log that is not the last** the screen says `Downloaded a part.`, with the button Download the next part, and the menu has Next part.
- **A filtered file can end sooner:** where its search stopped. Its last line is then `Searched 5,000 entries of the log. It holds more: download the next part.`
- **The files of a longer log are numbered:** `poplin-activity-2026-11-15-1.csv`, then `-2`. The day in the name is the day of the download, in UTC.
- **In the CSV file** a field that starts with `=`, `+`, `-`, or `@` has an apostrophe before it.

## The Worker's log at Cloudflare

The Activity screen holds what people did. What went wrong inside the Worker is in Cloudflare's own log: in the Cloudflare dashboard, Workers & Pages, the Worker, Observability.

| Cloudflare's Free plan | Until 30 November 2026 | From 1 December 2026                                        |
| ---------------------- | ---------------------- | ----------------------------------------------------------- |
| keeps a line           | 3 days                 | 7 days                                                      |
| takes in a day         | 200,000 lines          | 0.5 GB, shared with the account's other logs                |
| past that              |                        | stores no further line until midnight UTC, and charges none |

On Cloudflare's Workers Paid plan, lines past the plan's own allowance are charged.

| A line holds                                                          | Written when                                                              | Then holds                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| `poplin: a request failed`                                            | a request met an error and was answered a 503                             | the error's kind, places in code   |
| `poplin: an API request failed`                                       | a call of the API met an error and was answered a 500                     | the error's kind, places in code   |
| `poplin: a login was refused:`                                        | a login came with no valid proof from Access, or for an email not allowed | the kind of refusal                |
| `poplin: a request for a private site was refused:`                   | the same, at a private site                                               | the kind of refusal                |
| `poplin: a login was not written to the audit log`                    | the database took no write, and the person was let in                     | the error's kind, places in code   |
| `poplin: the day's count of writes to the bucket was not written`     | the database took no write after a request                                | the error's kind, places in code   |
| `poplin: the stored settings are not the ones this build reads, at`   | another build of poplin wrote the settings                                | the names of the settings          |
| `poplin: step`                                                        | a step of the database was applied by another build, or failed            | the step, and a failure's kind     |
| `poplin: the sweep did not run.`                                      | a scheduled run found the variables or the database not ready             | the names of the variables, if any |
| `poplin: the sweep failed`                                            | a scheduled run met an error                                              | the error's kind, places in code   |

- **An error the Worker caught is written by its kind, never by its message.** `RangeError`, then the places in the code it passed through; for a scheduled run that failed, Cloudflare names them by the source's file and line. a message could repeat a site's id or a file's path.
- **poplin writes into no line** a token, the dashboard's cookie, a login code, an email, a visitor's address, a site's id, or a value of a setting or a variable.
- **Cloudflare's own record of each request is off.** It would hold the request's address, and the address of an unlisted or a private site is its link.
- **Cloudflare adds fields of its own to every line.** The log is in your Cloudflare account, and whoever can open the account can read it.
- **A request that goes well writes no line.**
