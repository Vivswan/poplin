---
order: 1
---

# Get your own install

One command makes an install of your own. Choose one of two first:

| You install       | The command                                           | A site answers at                                                    |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| under your domain | `npx poplin install cloudflare --domain example.com`  | a hostname of its own: `report--k3f9x2ab71qz-p-poplin.example.com`   |
| without a domain  | `npx poplin install cloudflare --no-domain`           | a path: `poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/` |

**Which to choose:** a domain, if you have one at Cloudflare. With none, install without one.

| The kind          | Two sites in one browser                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| under your domain | are kept apart: a page of one site cannot read another                                     |
| without a domain  | a page of one site can read the other sites of its kind: an open one the open ones, a private one the private ones. Publish only pages you trust |

An open site is an unlisted or a public one. [What differs](without-a-domain.md#what-differs-from-an-install-under-a-domain) has every row. The kind is chosen once: poplin has no command and no screen that changes it on an install that is made.

| Page                                    | What it covers                                                  |
| --------------------------------------- | --------------------------------------------------------------- |
| [With an agent](with-an-agent.md)       | paste the prompt; the agent runs the command with you           |
| [Install](install.md)                   | what you need, the command, the account token, what it prints   |
| [Without a domain](without-a-domain.md) | what differs at the address Cloudflare gives                    |
