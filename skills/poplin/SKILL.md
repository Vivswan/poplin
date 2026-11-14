---
name: poplin
description: Use when the user asks to publish, share, host, or put online an HTML page, a report, a chart, a dashboard, or a folder of static files, to update, roll back, re-link, or delete a site published that way, or to set poplin up.
---

# Poplin

> Poplin publishes a folder, or one HTML file, as a static site on an install in the user's own Cloudflare account. Each site gets its own address, and a new site is private.

**Not set up yet, or asked to set poplin up?** Follow [`references/setup.md`](references/setup.md). It logs this computer in and adds the tools, and both wait for the user's yes.

## When to Apply

- The user asks to publish, share, host, or put online a page, a report, a chart, a dashboard, or a folder of static files
- The user asks to update, roll back, re-link, delete, or restore something published this way
- The user asks to set poplin up, or you have neither the tools below nor a login (`npx poplin whoami` prints `not logged in`)

## The tools

You publish with the MCP tools, or with the `poplin` command when the tools are not connected.

| MCP tool        | Does                                       | The same with the command                                 |
| --------------- | ------------------------------------------ | --------------------------------------------------------- |
| `publish_site`  | makes a new site from `path`               | `npx poplin publish ./report`                             |
| `publish_site`  | with `site`: new content for that site     | `npx poplin publish ./report --site report--k3f9x2ab71qz` |
| `get_site`      | shows one site and its versions            | `npx poplin show report--k3f9x2ab71qz`                    |
| `list_sites`    | lists the sites; with `trash`, the trash   | `npx poplin list`, `npx poplin list --trash`              |
| `update_site`   | changes who can open a site, by `access`   | `npx poplin set report--k3f9x2ab71qz --unlisted`          |
| `rollback_site` | goes back one version, or to `version`     | `npx poplin rollback report--k3f9x2ab71qz`                |
| `new_link`      | gives the site a new address               | `npx poplin new-link report--k3f9x2ab71qz`                |
| `delete_site`   | moves the site to the trash                | `npx poplin delete report--k3f9x2ab71qz`                  |
| `restore_site`  | takes it back out of the trash             | `npx poplin restore report--k3f9x2ab71qz`                 |

`site` names one site: its label (`report--k3f9x2ab71qz`), its bare id, or the public name of a public site. Add `--json` to a command to get the site as JSON.

## Publishing

1. **Find what to publish.** A folder with an `index.html` at its root, or one HTML file. If you made the page yourself, write it to a folder first.

2. **Decide: a new site, or an update.** If the user is revising something already published, find its label: earlier in the conversation, or with `list_sites`. Each site in the list carries its label, its `access`, and its `url`. If you are not sure which site is meant, ask before you publish over it: an update is live at once, at an address people may already hold.

3. **Publish.** With no `site` for a new site. With `site` for an update.

4. **Keep the label** the answer returns, and tell the user (see below).

## What to know, and why

**A publish with no `site` always makes a new site.** Poplin never guesses that two publishes belong together, even from the same folder. So pass the label as `site` whenever you revise. Without it every revision lands at a new address, the link the user already shared keeps showing the old page, and stale copies pile up.

**A new site is private.** Only the install's admins can open it, after they log in in the browser. That is the right default for a draft or a report with real numbers in it, so leave it unless the user asks for more.

**Ask before you widen who can open a site.** The user may not know what each state lets out:

| `access`   | Who can open it                                              | Command flag |
| ---------- | ------------------------------------------------------------ | ------------ |
| `private`  | the install's admins, after login                            | `--private`  |
| `unlisted` | anyone who has the address, with no login                    | `--unlisted` |
| `public`   | everyone, also at a public name: `report-page.example.com`   | `--public`   |

"Share this with my team" is not yet a yes to unlisted: say what unlisted means and let the user choose. Going public claims a public name, the site's name unless you pass `public_name` (`--public --name docs`).

Change `access` only when the user asks, in either direction. A public site that goes private or unlisted gives up its public name, and that address stops working.

**`new_link` changes the address at once, and the old one stops working.** Every link with the old label breaks, for everyone the user sent it to, and it cannot be put back. Use it only when the user asks for a new link.

If the user says a link leaked, name the ways to stop it and do the one they choose. A new link stops a leaked label address. Making the site private stops every address, the public name of a public site included, which a new link leaves working.

The answer carries the new label: use it from then on. For a private or unlisted site its `url` is the new address: give it to the user and say that the old one is dead. For a public site `url` is still the public name, which works as before: say that only the label address changed.

A private site needs no new link: its address opens nothing without a login.

**`delete_site` moves a site to the trash; `forever` cannot be undone.** From the trash, `restore_site` brings it back until the day it is gone for good. Delete only what the user named.

Leave `forever` to the user. With the command, `--forever` asks a person to type the label at a terminal, which you do not have.

**What is uploaded.** Every file under the folder, except hidden files (a name starting with a dot) and anything named `node_modules`, at any depth. One HTML file is published as the site's `index.html`.

Look at the folder first: what is in it will be on the site, and an unlisted or public site shows all of it. `npx poplin publish ./report --dry-run` lists the files and uploads nothing.

**The site is static.** Files are served as they are. Relative links between them work (`<a href="notes/q3.html">`, `<img src="chart.svg">`). There is no server code, no form handler, and no database, so build pages that need none.

**A wrong publish can be taken back.** `rollback_site` puts the version before it live again, when the install still keeps one. The address stays the same.

## After you publish, tell the user

Give three things: the address on a line of its own, who can open it, and how to change that.

```text
Published. It is private: only the admins of your install can open it, after login.

https://report--k3f9x2ab71qz-page.example.com

Say the word if you want a link that works for others without a login.
```

Take the address from `url` in the answer; do not build one yourself. After an update, say that the same address now shows the new version. Do not paste the address anywhere else, and do not open it to "check" a private site: you are not logged in to it.

## When poplin refuses

A refusal from a tool, or from a command run with `--json`, is one object with a `code`, a sentence, and often a hint. Without `--json` a command prints the sentence and the hint as text. Read the hint first, then look the code up in [`references/refusals.md`](references/refusals.md).

Two rules hold for every refusal. A refusal about the login (`no_login`, `not_logged_in`) or about what the login may do (`not_allowed`) goes to the user: do not log in again or look for a way around it unasked. And when no answer came back (`unreachable`, `timeout`, `internal`), check `list_sites` before you repeat a publish: it may have gone through, and a second one with no `site` makes a second site.

## References

| Open                                                               | When                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`references/setup.md`](references/setup.md)                       | the user asks to set poplin up, or there are no tools and no login      |
| [`references/mcp-server.md`](references/mcp-server.md)             | you add the MCP server to your own configuration, during the setup      |
| [`references/refusals.md`](references/refusals.md)                 | a tool or a command answers with a refusal `code`                       |
