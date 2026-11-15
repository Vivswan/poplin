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
| UTC, Your time                       | writes every time in UTC, or in the browser's time zone                      |
| When                                 | a press on the heading puts the oldest first                                 |
| `1 to 50 of 1,234`                   | at the foot: which entries the page shows, of how many                       |
| 50 per page                          | holds 100 or 200 entries a page; the browser keeps the choice                |
| First page, Previous page, Next page | go to the pages around the one shown; a new page shows from its first entry  |
| Search further                       | under a filtered list: looks through the next 5,000 entries                  |

The total is counted through the newest 10,000 entries. A longer log reads `1 to 50 of 10,000+`.

A filtered list looks through 5,000 entries at a time, and its total through the newest 5,000. Where it stopped before the log's end, the foot says `Searched the newest 5,000 entries.`, and Search further goes on from there.

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
