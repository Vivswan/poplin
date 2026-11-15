---
title: Publish
order: 10
---

# Publish a site

How to publish a site, name it, and put new content on it; [who can open it](who-can-open.md) and [its other settings](manage-sites.md#other-settings-of-a-site) have their own pages.

## How a site is named

```text
report--k3f9x2ab71qz
|       |
|       the id: 12 random characters
the name: taken from the folder or the file
```

That is the label. Every command and tool takes it to name one site. The bare id (`k3f9x2ab71qz`) works too, and so do the public name of a public site (`docs`) and the site's address, pasted whole (`https://report--k3f9x2ab71qz-p-poplin.example.com/`).

## Publish

| Example                                        | Does                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `npx poplin ./report`                          | makes a new site, private, from a folder            |
| `poplin ./report.html`                         | makes a new site from one HTML file                 |
| `poplin ./report --site report--k3f9x2ab71qz`  | puts new content on that site; the address stays    |
| `poplin ./report --name q3-report`             | makes a new site with that name                     |
| `poplin ./demo --unlisted --expires 7d`        | makes a new site with [settings](manage-sites.md#other-settings-of-a-site)     |
| `poplin ./report --dry-run`                    | lists the files and the name, and uploads nothing   |

Every other example runs the same way, with `npx` before `poplin`.

```text
$ npx poplin ./report
uploaded 3 files, 48 kB
made  report--k3f9x2ab71qz  private
https://report--k3f9x2ab71qz-p-poplin.example.com
```

- **No `--site` means a new site, every time.** Keep the label and pass it to update.
- **A folder needs an `index.html` at its top.**
- **Not uploaded:** hidden files (a name that starts with a dot) and anything named `node_modules`.
- **A name** is 3 to 40 lowercase letters, digits, and single dashes, with no dash first or last.
- **A file the install fails on,** or gives no answer to, is sent up to 4 times, with a pause of seconds before each new try, shown while it waits. After the fourth the publish is given up.
- **Ctrl-C** stops a publish, an import, or a copy: the upload on its way is given up, so its site is not made or changed, and the command exits 1. A second Ctrl-C ends it at once.
