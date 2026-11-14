---
title: Poplin
order: 10
---

# Poplin

Poplin lets an AI agent or a person publish a static site (a folder, or one HTML file) to their own Cloudflare account with one call.

**Status:** in development, not released. You cannot install or use it yet.

```text
poplin ./report                               ->  a new site, every time: report--k3f9x2ab71qz
                                                  https://report--k3f9x2ab71qz-page.example.com
poplin ./report --site report--k3f9x2ab71qz   ->  the same site, new content
```

**Who can open what you publish:**

| State                 | Who can open it            | Address                                                             |
| --------------------- | -------------------------- | ------------------------------------------------------------------- |
| private (the default) | only you, after one login  | the one above                                                       |
| unlisted              | anyone who has the address | the same one, with no login                                         |
| public                | everyone                   | the same one, and a name the site claims: `report-page.example.com` |

**The address:**

```text
report--k3f9x2ab71qz-page.example.com
|       |            |
|       |            the marker every site address ends in, -page by default
|       the id: 12 random characters, hard to guess; it is the link
the name: a label of 3 to 40 characters; several sites may share it
```

```text
poplin new-link report--k3f9x2ab71qz   ->  the site gets a new id; the old address stops at once
```

The owner's private page that lists every site is the dashboard. [Security](security.md) says what an unlisted site's address covers.

**The pages:**

| Page                        | What it covers                                    |
| --------------------------- | ------------------------------------------------- |
| [Security](security.md)     | what poplin protects against and what it does not |
