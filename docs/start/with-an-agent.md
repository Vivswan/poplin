---
title: With an agent
order: 10
---

# Install with an agent

What happens after you paste the line below, and what you do yourself; the agent follows [the skill's setup page](../../skills/poplin/references/setup.md), and the clicks are those of [By hand](by-hand.md).

```text
Look at https://github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

Paste it into an agent, such as Claude Code or Codex: an AI tool that runs in a terminal on your own computer and runs commands there. It is a separate tool that you install yourself, and it may cost money: poplin brings none. A chat in a browser cannot run commands, so it cannot publish.

**Have ready** what [What you need](by-hand.md#what-you-need) lists. With no install yet, allow about an hour and twenty minutes.

| Step | What happens                                          | Who does it                                                      |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | the agent says what it will do, and asks once         | you say yes                                                      |
| 2    | a check: Node.js, a saved login, an install           | the agent; you install Node.js when it is missing                |
| 3    | with no install: steps 1 to 5 of By hand              | you click in your browser; the agent says what, and checks each  |
| 4    | with no saved login: `npx poplin login`               | the agent runs it; you allow it in your browser                  |
| 5    | poplin's tools are added to the agent's configuration | the agent; it may ask you to restart it, so that the tools show  |
| 6    | a last check                                          | the agent names your install                                     |

- **One yes, at the start.** It covers the setup, the tools of step 5 included, and nothing else: the agent publishes, shares, and deletes only when you ask.
- **Your agent's own questions are expected.** The tool may ask you to approve each command before it runs, such as `node --version`. That is the tool's own safety, apart from the one yes.
- **A restart** is closing the agent, opening a new terminal window, and starting the agent again there, in the same folder. The agent asks for one when its terminal, open since before Node.js was installed, does not find it, and when the tools of step 5 do not show. The chat may not come back: afterwards, say `Go on with the poplin setup.`
- **The dashboard's address** is asked only when you have an install and this computer has no login.
- **The Cloudflare API token stays out of the chat.** You paste it into the setup page, in your own browser.
- **The agent acts as you**, with the login step 4 saves on this computer. It leaves a saved login as it is. The login lasts 30 days: after that the agent asks you before it makes a new one.
- **It worked when** the agent names your install. To see for yourself, run `npx poplin doctor`: [step 6](by-hand.md#the-steps) shows what it prints.

The tools reach the agent as an MCP server, which is how an agent gets tools.
