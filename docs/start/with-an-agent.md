---
title: With an agent
order: 10
---

# Install with an agent

What happens after you paste the line below, and what you do yourself; the agent follows [the skill's setup page](../../skills/poplin/references/setup.md), and the command it runs is the one of [Install](install.md).

```text
Look at https://github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

Paste it into an agent, such as Claude Code or Codex: an AI tool that runs in a terminal on your own computer and runs commands there. It is a separate tool that you install yourself, and it may cost money: poplin brings none. A chat in a browser cannot run commands, so it cannot publish.

**Have ready** what [What you need](install.md#what-you-need) lists. The domain is your choice: the agent asks.

| Step | What happens                                             | Who does it                                                             |
| ---- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | the agent says what it will do, and asks once            | you say yes                                                             |
| 2    | a check: Node.js, a saved login, an install              | the agent; you install Node.js when it is missing                       |
| 3    | with no install: two questions, a domain or none, and your email | you answer                                                      |
| 4    | what no command can switch on, and the account token     | you, in your browser; the agent gives you the link, and says what to choose |
| 5    | a dry run: what the install would make, and what blocks it | the agent reads it, and tells you what is left to switch on           |
| 6    | the install: `npx poplin install cloudflare`, with your two answers | the agent, or you in a terminal of your own: the second table below |
| 7    | with no saved login: `npx poplin login`                  | the agent runs it; you allow it in your browser                         |
| 8    | poplin's tools are added to the agent's configuration    | the agent; it may ask you to restart it, so that the tools show         |
| 9    | a last check                                             | the agent names your install                                            |

**The account token stays out of the chat.** Steps 5 and 6 need it, and it reaches the command one of two ways:

| The agent runs                               | Steps 5 and 6 are run by                                                                  | The token is given                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| on your computer, with you                   | you, in a terminal of your own: the agent gives you each line, and you paste back what it prints | at the command's question `Account token (not shown):`  |
| in a script or a CI job, with nobody to ask  | the agent                                                                                 | in `POPLIN_INSTALL_TOKEN`, which the job's secret store sets   |

What the command prints holds no token, so it is safe to paste. Do not type an `export` line with the token to hand it to the agent: the shell keeps that line in its history.

- **One yes, at the start.** It covers the setup, the tools of step 8 included, and nothing else: the agent publishes, shares, and deletes only when you ask.
- **Your agent's own questions are expected.** The tool may ask you to approve each command before it runs, such as `node --version`. That is the tool's own safety, apart from the one yes.
- **A restart** is closing the agent, opening a new terminal window, and starting the agent again there, in the same folder. The agent asks for one when its terminal, open since before Node.js was installed, does not find it, and when the tools of step 8 do not show. The chat may not come back: afterwards, say `Go on with the poplin setup.`
- **The dashboard's address** is asked only when you have an install and this computer has no login.
- **The agent acts as you**, with the login step 7 saves on this computer. It leaves a saved login as it is. When a login has run out, the agent asks you before it makes a new one.
- **It worked when** the agent names your install. To see for yourself, run `npx poplin doctor`: [step 5 of Install](install.md#5-log-this-computer-in-and-check) shows what it prints.

The tools reach the agent as an MCP server, which is how an agent gets tools.
