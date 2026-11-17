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
| `poplin set report--k3f9x2ab71qz --title "Q3 sales"`    | sets the title your dashboard shows: one line, 200 characters at most |
| `poplin set report--k3f9x2ab71qz --expires 7d`          | moves it to the trash in 7 days; a span is 36,500 days at the most |
| `poplin set report--k3f9x2ab71qz --expires 2026-12-01`  | moves it to the trash on that day                 |
| `poplin set report--k3f9x2ab71qz --expires never`       | keeps it                                          |
| `poplin set report--k3f9x2ab71qz --search-engines on`   | lets search engines list it, once it is public and Let search engines in is on |
| `poplin set report--k3f9x2ab71qz --embeddable off`      | stops other pages from showing it in a frame and from loading its files |

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
| `poplin duplicate report--k3f9x2ab71qz`       | makes a private copy, with a new address and `(copy)` after its title |
| `poplin delete report--k3f9x2ab71qz`          | moves the site into the trash                                 |
| `poplin restore report--k3f9x2ab71qz`         | takes it back out of the trash                                |
| `poplin delete report--k3f9x2ab71qz --no-trash` | removes it now, after you type its label; nothing restores it |

## Try a change first

`--dry-run` after a command that changes a site says what it would do, and changes nothing.

| Example                                                   | Says                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `poplin set report--k3f9x2ab71qz --public --dry-run`      | the address the site would have, or that its name is taken |
| `poplin rollback report--k3f9x2ab71qz --dry-run`          | the version that would be live                             |
| `poplin new-link report--k3f9x2ab71qz --dry-run`          | the address that would stop                                |
| `poplin duplicate report--k3f9x2ab71qz --dry-run`         | the copy's name and files, or the limit that refuses it    |
| `poplin delete report--k3f9x2ab71qz --dry-run`            | the day the site would be gone for good                    |
| `poplin delete report--k3f9x2ab71qz --no-trash --dry-run` | what would be removed; it asks for no label                |
| `poplin restore report--k3f9x2ab71qz --dry-run`           | the site as it would come back                             |

- **The install answers a dry run,** so it is refused where the run would be: the same sentence, the same exit code.
- **`--json` with `--dry-run`** prints what the run prints, with `"dry_run": true` first.
- **A new link's address** is not in a dry run: the install draws the new id when it makes the link.

## What to know

- **Versions:** an install keeps a few per site. `poplin config versions_kept` shows how many.
- **Trash:** a deleted site waits some days, then it is gone. `poplin config trash_days` shows how many.
- **A new link** is for an address that reached the wrong person. A public site keeps its public name.
- **A copy's title** is the one the site shows, with `(copy)` after it: `Q3 sales (copy)`. A title that ends that way already stays as it is, and a site with no title gives a copy with none. A long title is cut, so that both fit in 200 characters.
- **Visits:** `poplin show report--k3f9x2ab71qz` says about how often a site's pages were opened, today and in the last 7 days. The numbers come from a sample, so they read `about 120`. A page a browser shows from its own copy, inside 5 minutes, is not counted.
