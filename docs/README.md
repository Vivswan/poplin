---
title: Poplin
order: 10
---

# Poplin

Poplin lets an AI agent or a person publish a static site (a folder, or one HTML file) to their own Cloudflare account with one call.

**Status:** in development, not released. You cannot install or use it yet.

```text
poplin ./report                               ->  a new site, every time: report--k3f9x2ab71qz
                                                  https://report--k3f9x2ab71qz-p-poplin.example.com
poplin ./report --site report--k3f9x2ab71qz   ->  the same site, new content
```

**Who can open what you publish:**

| State                 | Who can open it            | Address                                                                 |
| --------------------- | -------------------------- | ----------------------------------------------------------------------- |
| private (the default) | only you, after one login  | `report--k3f9x2ab71qz-p-poplin.example.com`                             |
| unlisted              | anyone who has the address | `report--k3f9x2ab71qz-u-poplin.example.com`                             |
| public                | everyone                   | the unlisted one, and a name the site claims: `report-page.example.com` |

**The address:**

```text
report--k3f9x2ab71qz-p-poplin.example.com
|       |            | |
|       |            | the marker: always -poplin
|       |            the letter: p for a private site, u for an unlisted or a public one
|       the id: 12 random characters, hard to guess; it is the link
the name: a label of 3 to 40 characters; several sites may share it

report-page.example.com
|      |
|      the public word: page, or the word the installer chose once at install
the public name: a name one public site claims
```

| What changes | What happens to the address |
| --- | --- |
| private to unlisted or public, or back | the letter changes; the old address sends visitors to the new one |
| unlisted to public, or back | nothing; a public site also answers at its public name |
| new content, a rollback | nothing |

Only the id finds a site. Any name before it, or none, opens the same site: `k3f9x2ab71qz-u-poplin.example.com` works too. Commands take the label without the letter: `report--k3f9x2ab71qz`.

```text
poplin new-link report--k3f9x2ab71qz   ->  the site gets a new id; the old address stops at once
```

The owner's private page that lists every site is the dashboard. [Security](security.md) says what an unlisted site's address covers.

**The pages:**

| Page                        | What it covers                                    |
| --------------------------- | ------------------------------------------------- |
| [Security](security.md)     | what poplin protects against and what it does not |
