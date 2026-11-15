---
title: Manage sites
order: 30
---

# Manage sites

The commands that change a site's other settings, look at it, go back a version, re-link, copy, delete, and restore it; [Publish](publish.md) makes a site.

## Other settings of a site

A publish takes these flags too.

| Example                                                 | Does                                              |
| ------------------------------------------------------- | ------------------------------------------------- |
| `npx poplin set report--k3f9x2ab71qz --name q3-report`  | renames it; its id stays, and [every older address still opens it](who-can-open.md) |
| `poplin set report--k3f9x2ab71qz --title "Q3 sales"`    | sets the title your dashboard shows               |
| `poplin set report--k3f9x2ab71qz --expires 7d`          | moves it to the trash in 7 days                   |
| `poplin set report--k3f9x2ab71qz --expires 2026-12-01`  | moves it to the trash on that day                 |
| `poplin set report--k3f9x2ab71qz --expires never`       | keeps it                                          |
| `poplin set report--k3f9x2ab71qz --search-engines on`   | lets search engines list it, once it is public and Let search engines in is on |
| `poplin set report--k3f9x2ab71qz --embeddable off`      | stops other pages from showing it in a frame      |

Every other example runs the same way, with `npx` before `poplin`.

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

## In the dashboard

| Press                         | Does                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| a site's title                | opens the site in a new tab; not for a site in the trash   |
| the rest of its row           | opens its panel; a second press, or one beside it, closes  |
| the eye after the link        | shows the id, which is hidden as dots, and hides it again  |
| Copy the link                 | copies the whole link, a hidden id included                |
| Open the site                 | opens the site in a new tab                                |

Find a site, over the list, keeps the sites whose title, name, or public name holds the text anywhere in it. The letters A to Z match in either case.

In a window a little too narrow for the table, the name in a site's link is cut short. The dots of the id and the three buttons after it stay.

For a site that is not in the trash, the panel has the link, who can open it, the versions, and two switches under Settings: Show in search engines, and Allow embedding.

| In the panel                  | Does, or says                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Private, Unlisted, or Public  | asks first, as the next table shows; Cancel leaves the site as it is             |
| a Public name that is refused | says why at the field, and keeps what was typed                                  |
| Show in search engines        | on any site, while Let search engines in is off: `Off for every site in Settings.` |
| Show in search engines        | on a site that is not public, while it is on: `Only a public site is listed.`    |
| Change, after Deletes itself  | opens a menu; a choice is saved at once, with Undo                               |

| In the menu           | The site deletes itself                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| 1 day, 7 days, 30 days | at the day and time the menu shows beside it: that long after the menu opened        |
| On a day...           | when the day you pick starts, in the time zone the dashboard shows; shown before Save |
| Never                 | never                                                                                |

For a site that deletes itself, the panel then shows the day and time, and `Then its link stops working, and it moves to the trash.`

| From                | To       | The question says                                                                  | Its button       |
| ------------------- | -------- | ---------------------------------------------------------------------------------- | ---------------- |
| Unlisted            | Private  | `Only users who can log in here can open it.`                                      | Make it private  |
| Private             | Unlisted | `Anyone with the link can open it. No login.`                                      | Make it unlisted |
| Public              | Private  | `Its public link stops working.`                                                   | Make it private  |
| Public              | Unlisted | `Its public link stops working. Anyone with its other link can open it. No login.` | Make it unlisted |
| Private or Unlisted | Public   | `Everyone can open it, at a public link. No login.`, over the field Public name    | Make it public   |

The field Public name starts with the site's name. Under it, `Its link will be` shows the address the site gets for the name typed, such as `docs-page.example.com`.

For a site in the trash, the panel has Restore and Delete for good. Its row has Restore, and Delete for good in the menu after it.

| Delete for good       | Does, or says                                                             |
| --------------------- | ------------------------------------------------------------------------- |
| the question          | `This cannot be undone, and the site's files go too.`                     |
| its button            | stays off until you type the site's name, which the question shows        |
| once it is done       | the site leaves the list; nothing restores it                             |

[Who can open a site](who-can-open.md) says what a public name is. Let search engines in is in [Settings](../run/settings.md#change-a-setting), under Visitors.

The sun or moon in the header switches between the light and the dark look, and the browser keeps the choice.
