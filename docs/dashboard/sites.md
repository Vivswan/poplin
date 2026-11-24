---
title: Sites
order: 10
---

# Sites

| Press                         | Does                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| a site's title                | opens the site in a new tab; not for a site in the trash   |
| the rest of its row           | opens its panel; a second press, or one beside it, closes  |
| the eye after the link        | shows the id, which is hidden as dots, and hides it again  |
| Copy the link                 | copies the whole link, a hidden id included                |
| Open the site                 | opens the site in a new tab                                |

Find a site, over the list, keeps the sites whose title, name, or public name holds the text anywhere in it. The letters A to Z match in either case. A site's link, its whole address, or its id, pasted there, finds that one site.

In a window a little too narrow for the table, the name in a site's link is cut short. The dots of the id and the three buttons after it stay.

| Over the list            | Does                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| All sites                | narrows the list to Private, Unlisted, or Public, or shows the Trash              |
| Refresh the list         | reads the list again; beside it, how long ago it was read                         |
| Columns                  | shows or hides a column; Reset the widths and Reset the layout put the table back |
| New site                 | shows the command that publishes a folder, with a button that copies it           |
| a heading of the table   | a press on Site, Who can open it, Updated, or Name puts the list in that order    |
| By updated, on a phone   | the same orders as a menu: By updated, By title, By name, Who can open it         |

The table starts with the columns Site, Who can open it, Link, and Updated. Columns adds Name, Published by, `Visits, 7 days`, Size, Versions, and Expires.

Every heading but Site is dragged to another place, and a heading's edge to another width. Site is always shown. The browser keeps the layout.

For a site that is not in the trash, the panel has the link, who can open it, the versions, the files of the live version, and two switches under Settings: Show in search engines, and Allow embedding. It also says the site's Visits, Size, and Updated, and when it Expires. At its foot are New link, Duplicate, and Delete.

| In the panel                  | Does, or says                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Private, Unlisted, or Public  | asks first, as the next table shows; Cancel leaves the site as it is             |
| a Public name that is refused | says why at the field, and keeps what was typed                                  |
| Show in search engines        | on any site, while Let search engines in is off: `Off for every site in Settings.` |
| Show in search engines        | on a site that is not public, while it is on: `Only a public site is listed.`    |
| Allow embedding               | on, as a new site has it: `Other pages may show this site in a frame and load its files.` Off stops both; [Between sites](../about/between-sites.md) has the rows |
| Change, after Expires         | opens a menu; a choice is saved at once, with Undo                               |

| In the menu           | The site expires                                                                     |
| --------------------- | ------------------------------------------------------------------------------------ |
| 1 day, 7 days, 30 days | at the day and time the menu shows beside it: that long after the menu opened        |
| On a day...           | when the day you pick starts, in the time zone the dashboard shows; shown before Save |
| Never                 | never                                                                                |

For a site that expires, the panel then shows the day and time, and `Then its link stops working, and it moves to the trash.`

Files, under the versions, is folded until you press it. It shows the live version alone, as a tree: the folders first, then the files, each with its size. Once it was opened, the number after Files is how many files that version holds; Size counts every kept version.

| Under Files           | Does                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| a folder              | opens it, and reads what is in it the first time; a second press closes it        |
| a file                | opens that file of the site in a new tab                                          |
| Show more             | reads the next rows of a folder that holds more, up to 200 at a time                |
| the arrow keys        | move from row to row; Right opens a folder, Left closes it, and Enter opens a file |

Nothing is read while Files is folded, and what was read is kept while the dashboard stays open. A new link starts the site's files over. [What one action costs](../upkeep/cost/what-one-action-costs.md) has the numbers of a read.

Where a site was deleted for good and imported again, a folder of its live version that was read before does not read on: Show more says `This list is out of date. Load the page again.`

| From                | To       | The question says                                                                  | Its button       |
| ------------------- | -------- | ---------------------------------------------------------------------------------- | ---------------- |
| Unlisted            | Private  | `Only users who can log in here can open it.`                                      | Make it private  |
| Private             | Unlisted | `Anyone with the link can open it. No login.`                                      | Make it unlisted |
| Public              | Private  | `Its public link stops working.`                                                   | Make it private  |
| Public              | Unlisted | `Its public link stops working. Anyone with its other link can open it. No login.` | Make it unlisted |
| Private or Unlisted | Public   | `Everyone can open it, at a public link. No login.`, over the field Public name    | Make it public   |

The field Public name starts with the site's name. Under it, `Its link will be` shows the address the site gets for the name typed, such as `docs-page.example.com`.

Duplicate, in the panel, makes a private copy of the site, with a new link. The copy's title is the site's, with `(copy)` after it; [Manage sites](../sites/manage.md) has the whole rule.

| After Duplicate               | You see                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| at first                      | a question with the field Name, which starts with the site's name                 |
| a Name that is refused        | why, at the field; what was typed stays                                           |
| a small site                  | `Duplicated.`, with Open, which opens the copy's panel                            |
| a site of more files          | `Duplicating. Ready in a few seconds.`, with Cancel, then `Duplicated.`           |
| Cancel                        | `Cancelled. No copy was made.`, or `Duplicated.` if the copy was whole by then    |

The copy goes on while you use other screens. A site of more than 112 files is copied by a background job of the install: closing the tab leaves it running, and the copy is in the list when it is done. Cancel ends the job. A copy that fails makes no site, and Usage shows `A copy of a site was not made` under Problems.

A copy whose job stops without a word is removed about a day after it began, and Problems shows `A copy of a site was not made` then. Until that day is over the line `Duplicating` stays; Cancel ends it sooner.

A Worker with no Workflow has no background job: [What one action costs](../upkeep/cost/what-one-action-costs.md) says which. There the page copies, and a tab closed half way makes no site; the files are removed in about a day, and Problems shows `A copy of a site was not made`.

For a site in the trash, the panel has Restore and Delete for good. Its row has Restore alone.

The table of the trash has the column Leaves the trash: the day the site is gone for good. On a phone the row says it, as `Leaves the trash on 20 Nov 2026`.

| Delete for good       | Does, or says                                                             |
| --------------------- | ------------------------------------------------------------------------- |
| the question          | `This cannot be undone, and the site's files go too.`                     |
| its button            | stays off until you type the site's label, which the question shows: its name, two dashes, and its id, as `poplin delete` asks for it with `--no-trash` |
| once it is done       | the site leaves the list; nothing restores it                             |

[Who can open a site](../sites/who-can-open.md) says what a public name is. Let search engines in is in [Settings](settings.md#change-a-setting), under Visitors.

The theme button in the header moves to the next look at each press: System, Light, Dark. System follows your device. The browser keeps the choice.
