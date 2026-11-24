---
title: With an agent
order: 10
---

# Install with an agent

What happens after you paste the line below, and what you do yourself. The agent follows [its own setup file](../../skills/poplin/references/setup.md), which counts the same steps, and the command is the one of [Install](install.md).

```text
Look at github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

Paste it into an agent, such as Claude Code or Codex: an AI tool that runs in a terminal on your own machine and runs commands there. It is a separate tool that you install yourself, and it may cost money: poplin brings none. A chat in a browser cannot run commands, so it cannot publish.

**Or install the skill yourself**, then ask the agent to set poplin up: the steps below are the same. Have Node.js 24 or higher on the machine first, as poplin needs:

```sh
npx skills add Vivswan/poplin
```

It asks what it needs, such as which agents get the skill, and whether for this folder or for you. `npx skills add Vivswan/poplin -g -y` skips those questions: `-g` installs for you, in every folder, and `-y` takes the defaults for the rest.

The skill is enough for an agent that runs commands: without poplin's MCP server, it publishes with `npx poplin` itself.

**Have ready** what [What you need](install.md#what-you-need) lists. The domain is your choice: the agent asks.

```text
the agent   asks, checks, says what to choose, and gives you each line to run
you         choose in your browser, run two lines in a terminal of your own, and paste back what they print
the token   goes from Cloudflare's page into the command's question, and never into the chat
```

| Step | What happens                                                        | Who does it                                                                  |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | the agent says what it will do, and asks once                       | you say yes                                                                  |
| 2    | a check: Node.js, a stored login, an install                         | the agent; you install Node.js when it is missing                            |
| 3a   | two questions: a domain or none, and your email                     | you answer                                                                   |
| 3b   | what no command can switch on                                       | you, in your browser; the agent says what to open                            |
| 3c   | the account token                                                   | you, in your browser; the agent gives you the link, and says what to choose  |
| 3d   | a dry run: what the install would make, and what blocks it          | you run the agent's line, and paste back what it prints: [the table below](#you-run-steps-3d-and-3e) |
| 3e   | the install: `npx poplin install cloudflare`, with your two answers | you, the same way; then you press Enter at `Log this machine in now?`        |
| 4    | the login of this machine                                          | you, at the end of step 3e. With an install that was there: the agent runs `npx poplin login`, and you approve it in your browser |
| 5    | poplin's tools are added to the agent's configuration               | the agent; it may ask you to restart it, so that the tools show              |
| 6    | a last check                                                        | the agent names your install                                                 |

Step 3 makes the install, in parts a to e. With an install that is there already, the agent leaves it out. Where a run left something undone, the agent names the one line that goes on: its part f.

## You run steps 3d and 3e

**The agent never sees the account token.** On your own machine you run the two lines yourself, in a terminal the agent does not run in:

| You                                               | What happens                                         |
| ------------------------------------------------- | ---------------------------------------------------- |
| open a second terminal, as the lines below say    | a new window, beside the agent's                     |
| paste the agent's line there, and press Enter     | the command asks `Open the form in your browser?`    |
| press Enter for the form, or `n` with a token     | the command asks `Account token (hidden):`           |
| paste the token at that question, and press Enter | a row of small marks shows, never the letters        |
| copy all that the command printed into the chat   | it holds no token, so it is safe to paste. The login's code in it is used up once the command says `logged in` |

```text
Mac:      press Command and Space, type Terminal, press Enter; then press Command and N for a new window
Windows:  press the Windows key, type Command Prompt, press Enter
Linux:    open a new window of the program named Terminal
```

**The token is asked for twice:** by the dry run of step 3d, and by the install of step 3e. Cloudflare shows it once, and what you copy for the agent takes its place on the clipboard.

| The token                     | Do                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| is still on Cloudflare's page | leave that page open until the install is made, and copy the token from it again for step 3e           |
| is gone                       | at Cloudflare, open My Profile, then API Tokens, and choose Roll in the token's menu: it shows a new text |

**The login of step 4** is the last question of step 3e. On the page `Approve this login?`, choose Admin under Can change, on a machine of your own: [step 5 of Install](install.md#5-log-this-machine-in-and-check) says what each choice gives. The agent uses that login.

A script or a CI job has nobody to ask, so the agent runs both lines itself there:

| The agent runs                               | Steps 3d and 3e are run by | The token is given                                             |
| -------------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| on your machine, with you                   | you                        | at the command's question `Account token (hidden):`            |
| in a script or a CI job, with nobody to ask  | the agent                  | in `POPLIN_INSTALL_TOKEN`, which the job's secret store sets   |

Do not type an `export` line with the token to hand it to the agent: the shell keeps that line in its history.

After the install, three things ask for a token again, and one of them is a page: the Domain screen of your own dashboard. [Step 4 of Install](install.md#4-read-what-it-made) names all three. Nothing else takes it.

## What to expect

- **One yes, at the start.** It covers the setup, the tools of step 5 included, and nothing else: the agent publishes, shares, and deletes only when you ask.
- **Your agent's own questions are expected.** The tool may ask you to approve each command before it runs, such as `node --version`. That is the tool's own safety, apart from the one yes.
- **A restart** is closing the agent, opening a new terminal window, and starting the agent again there, in the same folder. The agent asks for one when its terminal, open since before Node.js was installed, does not find it, and when the tools of step 5 do not show. The chat may not come back: afterwards, say `Go on with the poplin setup.`
- **The dashboard's address** is asked only when you have an install and this machine has no login.
- **The agent acts as you**, with the login step 4 stores on this machine. It leaves a stored login as it is. When a login has run out, the agent asks you before it makes a new one.
- **It worked when** the agent names your install. To see for yourself, run `npx poplin doctor`: [step 5 of Install](install.md#5-log-this-machine-in-and-check) shows what it prints.
