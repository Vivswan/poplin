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

The login screen is Cloudflare's. You can change a site's state at any time: between private and the other two the letter in the address changes, and the old address sends visitors on. The 12 random characters are the site's id: hard to guess, and the link itself. The name in front is a label, and several sites may share it.

**What you need, and what it costs:**

- **A Cloudflare account.** Poplin runs inside it, so there is no server to run.
- **No money.** It fits Cloudflare's free tier.
- **No domain to start.** Sites start on the free `workers.dev` address every Cloudflare account has, and get an address like the one above once you add a domain.

Agents use an MCP server that runs on their own machine, and people use a command-line tool. The [documentation](docs/README.md) has the rest.
