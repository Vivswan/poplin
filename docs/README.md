---
title: Poplin
order: 10
---

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

**The pages:**

| Page                        | What it covers                                    |
| --------------------------- | ------------------------------------------------- |
| [Comparison](comparison.md) | what poplin and four other tools do               |
| [Security](security.md)     | what poplin protects against and what it does not |
