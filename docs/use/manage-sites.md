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
| `poplin set report--k3f9x2ab71qz --search-engines on`   | lets search engines list it, once it is public    |
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
| the rest of its row           | opens its panel; a second press closes it                  |
| the eye after the link        | shows the id, which is hidden as dots, and hides it again  |
| Copy the link                 | copies the whole link, a hidden id included                |
| Open the site                 | opens the site in a new tab                                |

Find a site, over the list, keeps the sites whose title, name, or public name holds the text anywhere in it. The letters A to Z match in either case.

In a window a little too narrow for the table, the name in a site's link is cut short. The dots of the id and the three buttons after it stay.

For a site that is not in the trash, the panel has the link, who can open it, the versions, and two switches under Settings: Show in search engines, and Allow embedding.

| In the panel                  | Does, or says                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Private                       | changes the site at once                                                         |
| Unlisted, on a private site   | asks first: `Anyone with the link can open it. No login.`                        |
| Public                        | asks for a Public name, filled with the site's name, then Make it public         |
| a Public name that is refused | says why at the field, and keeps what was typed                                  |
| Show in search engines        | on a site that is not public: `Only a public site is listed.`                    |
| Show in search engines        | on a public site, while Let search engines in is off: `Off for every site in Settings.` |

[Who can open a site](who-can-open.md) says what a public name is. Let search engines in is in [Settings](../run/settings.md#change-a-setting), under Visitors.

The sun or moon in the header switches between the light and the dark look, and the browser keeps the choice.
