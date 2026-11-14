---
title: Poplin
order: 10
---

# Poplin

Your AI agent, or you at the command line, publish a static site (a folder, or one HTML file) to your own Cloudflare account and get a link.

```text
You:    Put this report online.

Agent:  Published. It is private: only you can open it, after you log in.

        https://report--k3f9x2ab71qz-p-poplin.example.com
```

**The pages:**

| Page                    | What it covers                                     |
| ----------------------- | -------------------------------------------------- |
| [Using](using.md)       | every command, every agent tool, and every error   |
| [Install](install.md)   | getting your own install                           |
| [Security](security.md) | what poplin protects against and what it does not  |

**Who can open what you publish:**

| Access                | Who can open it            | Address                                                               |
| --------------------- | -------------------------- | --------------------------------------------------------------------- |
| private (the default) | only you, after a login    | `report--k3f9x2ab71qz-p-poplin.example.com`                           |
| unlisted              | anyone who has the address | `report--k3f9x2ab71qz-u-poplin.example.com`                           |
| public                | everyone                   | the unlisted one, and a name the site claims: `docs-page.example.com` |

**The address:**

```text
report--k3f9x2ab71qz-p-poplin.example.com
|       |            | |
|       |            | the marker: always -poplin
|       |            the letter: p for a private site, u for an unlisted or a public one
|       the id: 12 random characters, hard to guess; it is the link
the name: a label of 3 to 40 characters; several sites may share it

docs-page.example.com
|    |
|    the public word: page
the public name: a name one public site claims
```

| What changes                           | What happens to the address                           |
| -------------------------------------- | ----------------------------------------------------- |
| private to unlisted or public, or back | the letter changes; the old address sends visitors on |
| unlisted to public, or back            | nothing; a public site also answers at its public name |
| new content, a rollback                | nothing                                               |

Only the id finds a site. Any name before it, or none, opens the same site: `k3f9x2ab71qz-u-poplin.example.com` works too. Commands take the label without the letter: `report--k3f9x2ab71qz`.

```text
poplin new-link report--k3f9x2ab71qz   ->  the site gets a new id; the old address stops at once
```

The owner's private page that lists every site is the dashboard, at `poplin.example.com`. [Security](security.md) says what an unlisted site's address covers.
