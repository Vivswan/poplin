---
title: From a terminal
order: 30
---

# From a terminal instead

The terminal form of two of [the six steps](by-hand.md#the-steps); every other step is as that page has it.

Two steps have a terminal form.

**Step 2, without a GitHub account.** It needs git and bun. The last command opens Cloudflare in your browser to ask for access, then deploys.

```sh
git clone https://github.com/Vivswan/poplin
bun install --cwd poplin
bun run --cwd poplin deploy
```

**Step 4, without the page.** `poplin setup` sends the same three values and prints the same rows. It works only until the first login.

```sh
export POPLIN_SETUP_TOKEN="paste the token here"
npx poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com
```

In PowerShell on Windows the first line is this one, and the second is the same:

```powershell
$env:POPLIN_SETUP_TOKEN = "paste the token here"
```
