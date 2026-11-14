# Poplin

Poplin lets an AI agent or a person publish a static site (a folder, or one HTML file) to their own Cloudflare account with one call.

**Status:** in development, not released. You cannot install or use it yet.

```text
poplin ./report   ->   https://page-report.example.com
```

**Who can open what you publish:**

| State                 | Who can open it             |
| --------------------- | --------------------------- |
| private (the default) | only you, after one login   |
| unlisted              | anyone with the secret link |
| public                | everyone                    |

The login screen is Cloudflare's. You can change a site's state at any time, and its address stays the same.

**What you need, and what it costs:**

- **A Cloudflare account.** Poplin runs inside it, so there is no server to run.
- **No money.** It fits Cloudflare's free tier.
- **No domain to start.** Sites start on the free `workers.dev` address every Cloudflare account has, and get an address like the one above once you add a domain.

Agents connect over MCP, and people use a command-line tool. The [documentation](docs/README.md) has the rest.
