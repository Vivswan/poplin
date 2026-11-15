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
| Find by site                         | keeps the entries about a site whose name then held the text                 |
| UTC, Your time                       | writes every time in UTC, or in the browser's time zone                      |
| When                                 | a press on the heading puts the oldest first                                 |
| `1 to 50 of 1,234`                   | at the foot: which entries the page shows, of how many                       |
| 50 per page                          | holds 100 or 200 entries a page; the browser keeps the choice                |
| First page, Previous page, Next page | go to the pages around the one shown                                         |
| Search further                       | under a filtered list: looks through the next 5,000 entries                  |

The total is counted through the newest 10,000 entries. A longer log reads `1 to 50 of 10,000+`.

A filtered list looks through 5,000 entries at a time, and its total through the newest 5,000. Where it stopped before the log's end, the foot says `Searched the newest 5,000 entries.`, and Search further goes on from there.

## Save the log as files

Download, at the top of the screen, saves what the filters keep, the newest first.

| In the menu | The file                           | Holds                                                                   |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------- |
| CSV         | `poplin-activity-2026-11-15.csv`   | the columns `When (UTC)`, `Who`, `What`, `Site`, `Action`               |
| JSON Lines  | `poplin-activity-2026-11-15.jsonl` | one JSON object a line: the same five, and `detail`, what the action set |

- **A file holds 2,000 entries at the most.** After a full file that is not the last, the screen says `Downloaded 2,000.`, with the button Download the next 2,000. The menu has Next 2,000 too.
- **A file that is not the last says so** in its last line: `2,000 entries. The log holds more: download the next part.`
- **A filtered file can end sooner:** where its search stopped. Its last line is then `Searched 5,000 entries of the log. It holds more: download the next part.`
- **The files of a longer log are numbered:** `poplin-activity-2026-11-15-1.csv`, then `-2`. The day in the name is the day of the download, in UTC.
- **In the CSV file** a field that starts with `=`, `+`, `-`, or `@` has an apostrophe before it.
