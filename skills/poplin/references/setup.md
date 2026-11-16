# Set up poplin with the user

Open this when the user asks you to set poplin up, or when you have no poplin tools and no login. It is the whole script: a first install from nothing, or connecting yourself to an install that exists.

**You act as the user, with their own login, and you ask before you change your own configuration.** The login is the one saved on this computer. You leave a saved login as it is.

Poplin publishes a static site (a folder, or one HTML file) to an install: the user's own copy of poplin, in their own Cloudflare account. Once you are set up, the user can ask you to put a page online and you hand back its address.

| Step | What happens                                          | Who does it                                 |
| ---- | ----------------------------------------------------- | ------------------------------------------- |
| 1    | Say what is about to happen, and ask                  | you                                         |
| 2    | Check what exists: Node.js, a saved login, an install | you                                         |
| 3    | Make the install, when there is none                  | the user clicks; you say what, and check    |
| 4    | Log this computer in, when no login is saved          | you run it; the user allows it in a browser |
| 5    | Add the MCP server to your own configuration          | you                                         |
| 6    | Confirm that it works, and tell the user              | you                                         |

`example.com` stands for the user's own domain, and `https://poplin.example.com` for the address of their dashboard, here and below. The poplin repository and the place you read this page from are neither. `npx` may ask to download the `poplin` package the first time it runs: answer yes.

## 1. Say what is about to happen, and ask

Tell the user first, in a sentence or two, and wait for a yes before you go on.

Something like this, in your own words:

> Poplin lets me publish pages to your own Cloudflare account and give you a link. I will check what is set up, take you through making an install if you have none, and add poplin's tools to my own configuration. Shall I go ahead?

If the user says no, stop.

Your own tool may ask the user to approve each command you run, such as `node --version`. Say so with the question: those prompts are expected, and they are apart from this one yes.

A yes here covers the setup and nothing else. It is no permission to publish, share, or delete anything.

## 2. Check what exists

```sh
node --version
npx poplin whoami
```

The first line prints the version of Node.js, which must be 24 or higher. When it prints an error or a lower version, ask the user to run the LTS installer from <https://nodejs.org> and to tell you when it is done. Then run both lines again: do not install it yourself.

If the new Node.js is still not found, the terminal you run in is older than the install, and starting you again inside it changes nothing. Ask the user to restart you in a new terminal window, the way step 5 has it.

| `npx poplin whoami` prints                      | Means                      | Next                                             |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------ |
| lines for `install`, `role`, `token`, `expires` | this computer is logged in | tell the user which install; go to step 5        |
| `not logged in`                                 | there is no login          | ask the question below                           |
| `no token was sent, or it expired`              | the saved login ran out    | tell the user, and ask whether to log in again   |
| `the install could not be reached`              | the address or the network | tell the user and stop until it is sorted        |
| any other sentence                              | a refusal                  | read its hint, then [`refusals.md`](refusals.md) |

A last line names where the login comes from: saved on this machine, or `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment. Either is the user's own login, and you use it as it is.

If it is logged in to an install the user did not expect, say so and ask before you go on. Do not log out: the saved login is the user's to change. A login that ran out is replaced only on the user's yes, in step 4.

With no login, ask: "Do you already have a poplin install? If so, what is the address of its dashboard?" Do not guess an address, and do not search the computer for one.

| The user answers                         | Next   |
| ---------------------------------------- | ------ |
| an address, `https://poplin.example.com` | step 4 |
| no install yet                           | step 3 |

## 3. Make the install

The user makes the install in their browser, in five parts. You give one part at a time: the address to open, what to click, and what to tell you back. You check it before the next part.

| Part | What                                    | The user tells you back                   |
| ---- | --------------------------------------- | ----------------------------------------- |
| a    | switch on two things in Cloudflare      | that both show their overview             |
| b    | make the Worker, with the Deploy button | the address ending in `workers.dev`       |
| c    | make a Cloudflare API token             | that they hold it; never the token itself |
| d    | finish on the setup page                | the lines the page shows above its table  |
| e    | log in to the dashboard                 | that the dashboard is open                |

Before part a, ask what the user has. Say which of these is missing, and stop until they have it.

| The user needs                                    | For                                       |
| ------------------------------------------------- | ----------------------------------------- |
| a Cloudflare account                              | the Free plan is enough                   |
| a domain on that account                          | Cloudflare's home page lists it as Active |
| an email inbox they can read                      | the login's code goes there               |
| a payment method on the account                   | part a asks for one, at a price of 0      |
| a GitHub account, or git and bun on this computer | part b                                    |

Say when the payment method can be charged, in the words of [What can cost money](https://github.com/Vivswan/poplin/blob/main/docs/run/limits-and-cost.md#what-can-cost-money).

**Never take the Cloudflare API token in the chat.** The token of parts c and d changes the user's Cloudflare account. The user pastes it into the setup page in their own browser, where it goes to the install and nowhere else.

If the user pastes it to you all the same, do not repeat it. Ask them to open My Profile, then API Tokens, at Cloudflare, to choose Roll in that token's menu, and to use the new text in part d.

### a. Switch on two things in Cloudflare

Ask the user to open <https://dash.cloudflare.com> and log in.

| Open                                        | Do                                 |
| ------------------------------------------- | ---------------------------------- |
| Zero Trust, in the left menu                | pick a team name and the Free plan |
| Storage & databases, then R2, then Overview | finish the checkout it shows       |

The team name can be any word. Each sign-up asks for the payment method and names its price. Each is done when Cloudflare shows its overview instead of the sign-up. While one still shows the sign-up, ask what the page asks for, and have the user finish it.

### b. Make the Worker

Ask the user to open this address and sign in to GitHub when asked:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/Vivswan/poplin
```

Where the form asks for an account, they pick their own. They change nothing else: the project stays `poplin`, the bucket `poplin-sites`, the database `poplin`. Then they press the button at the bottom of the form, the one that starts the deploy.

| The form or GitHub asks                           | The user                                                     |
| ------------------------------------------------- | ------------------------------------------------------------ |
| whether Cloudflare may reach their GitHub account | allows it: Cloudflare puts the copy there and builds from it |
| whether the copy is private or public             | picks either. The copy holds poplin's code and no token      |

The user keeps the tab open. After a few minutes it shows the Worker's page, with the Worker's own address on it, the one ending in `workers.dev`. Ask for it, and keep it:

```text
https://poplin.your-name.workers.dev
```

If the tab was closed or shows no address, the user opens <https://dash.cloudflare.com>, goes to Workers & Pages, and selects the Worker `poplin`: its page names the address.

Check: ask the user to open that address.

| The address shows   | Next                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| a page headed Setup | part c                                                                      |
| anything else       | ask for its words; have the user wait a minute and reload, then check again |

If the build fails, no page with the address opens and Cloudflare shows the build's log. Ask for its last lines, and look them up under step 2 of the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/start/when-a-step-fails.md#step-2-the-build-fails).

**Without a GitHub account**, you run part b yourself: the three commands under From a terminal instead, in the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/start/from-a-terminal.md). First run `git --version` and `bun --version`: with either missing, the user installs it or takes the GitHub way.

The last command opens Cloudflare in the user's browser to ask for access, then deploys and prints the Worker's address. Go on from the check above.

### c. Make a Cloudflare API token

On the Setup page, under Make an account token, the user presses Open the account token form. Cloudflare's form opens in a new tab with eight permissions already chosen.

| On the form       | The user                                               |
| ----------------- | ------------------------------------------------------ |
| the eight rows    | leaves them                                            |
| Account Resources | chooses Include, then their account                    |
| Zone Resources    | chooses Include, then Specific zone, then their domain |
| every other field | leaves it as it is                                     |
| the bottom        | presses Continue to summary, then Create Token         |
| the next page     | copies the token: it is shown once                     |

The install never stores the token. After part e the user either keeps it where they keep passwords, or deletes it at Cloudflare, under My Profile, then API Tokens: the install keeps working. Only Check and Repair on the dashboard's Domain screen ask for a token again, and the same form makes a new one.

If the form opens empty, step 3 of the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/start/when-a-step-fails.md#step-3-the-form-opens-empty) has the clicks that add the eight permissions by hand.

### d. Finish on the setup page

Back on the Setup page, under Fill in three boxes, the user fills each box and presses Repair.

| Box           | Holds                                                     |
| ------------- | --------------------------------------------------------- |
| Domain        | their domain alone, with nothing before it: `example.com` |
| Your email    | an email whose inbox they can read: the first login       |
| Account token | the token of part c                                       |

Ask the user to copy you the lines the page shows above its table. They hold no token.

| The lines say                                              | Means               | Next                                       |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------ |
| a count that is repaired, or `Nothing to repair`           | the install is made | part e                                     |
| a count that is not done, or that is to repair             | a row needs work    | ask for those rows, then the install guide |
| one sentence and no table, such as `Account token refused` | the run was refused | the install guide                          |

For rows that need work, ask the user to copy each row whose State is failed, missing, differs, or not run, with its Detail, and any line with a link above the table. Look the words up in the table under step 4 of the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/start/when-a-step-fails.md#step-4-the-page-shows-something-else).

Repair is safe to repeat. The page empties the token's box after every run and keeps the other two, so the user pastes the token again before they press it.

**The same from a terminal.** `poplin setup` does what the page does, and reads the account token from `POPLIN_SETUP_TOKEN` in the environment alone. The user runs it in a terminal of their own, where you do not see the token:

```sh
export POPLIN_SETUP_TOKEN="paste the account token here"
npx poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com
```

In PowerShell the first line is `$env:POPLIN_SETUP_TOKEN = "paste the account token here"`.

Ask the user to copy you what the second line printed: the token is not in it.

| It ends with                            | Exit code | Next                                                          |
| --------------------------------------- | --------- | ------------------------------------------------------------- |
| `the install's side is as it should be` | 0         | part e                                                        |
| a count that is not done                | 1         | the rows above it say why: the install guide, as for the page |
| a sentence and a hint, with no rows     | 1         | the hint says what to do                                      |

### e. Log in to the dashboard

The user opens the dashboard's address, `https://poplin.example.com` with their own domain. Cloudflare's login asks for their email and sends a code to its inbox.

| The user sees                       | Do                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| the browser cannot find the site    | a new address takes a few minutes: wait, then reload                                |
| no code arrives                     | the email differs from part d: on the Setup page, the right email, the token, Repair |
| the dashboard, with `No sites yet`  | the install is ready: step 4                                                        |

This first login closes the Setup page for good.

## 4. Log this computer in

Do this when step 2 found no login. For a login that ran out, do it only on the user's yes. Never replace a login that works.

Run the login with the dashboard's address. It prints a web address and a short code, and then waits for the user, so run it in a way that lets you read its output while it is still running:

```sh
npx poplin login --server https://poplin.example.com
```

Give the user both, each on its own line. The address opens the dashboard on the question `Allow this login?`. The page asks for the last 4 letters of the code. Neither the page nor the address holds any of them, so the user needs the code you gave them.

| The user                           | Does                                              |
| ---------------------------------- | ------------------------------------------------- |
| asked you for this login           | types the last 4 letters, then presses Allow      |
| sees the page refuse those letters | presses Deny: that page is of some other login    |

The page starts at Own sites only, which is all you need to publish and to manage the sites you publish. Do not ask the user to choose Everything.

If you read output as JSON, add `--json`: the first line then carries the web address and the code.

| The command ends with                           | Next                                           |
| ----------------------------------------------- | ---------------------------------------------- |
| `logged in: the token is saved on this machine` | the check below                                |
| a sentence that it was denied, or ran out       | tell the user; run it again only on their word |

The login saves a token on this computer, and the commands read it from there. You never need to see it, so do not ask the user to paste one into the chat, and do not print one.

Then check the install:

```sh
npx poplin doctor
```

| It prints                                                | Exit code | Next                                                 |
| -------------------------------------------------------- | --------- | ---------------------------------------------------- |
| lines that all start with ok, then `nothing was changed` | 0         | step 5                                               |
| a line that starts with failed                           | 1         | tell the user that line, and stop until it is sorted |

## 5. Add the MCP server to your own configuration

The server has one name, `poplin`, one command, `npx`, and two arguments, `poplin mcp`. [`mcp-server.md`](mcp-server.md) says how each kind of agent adds it.

Edit your own configuration only, and only after the yes of step 1. The tools may not appear until you are restarted: if so, tell the user, and do step 6 with the command.

Before a restart, tell the user four things, since the chat may not come back:

| Tell the user      | In words like                                           |
| ------------------ | ------------------------------------------------------- |
| what is done       | only what is done by then. From step 2: Node.js is installed. From step 5: this computer is logged in and the tools are added |
| what is left       | from step 2: every step after the check. From step 5: the last check                                                          |
| how to restart you | close the agent, open a new terminal window, and start the agent again there, in the same folder                              |
| what to say next   | `Go on with the poplin setup.`                                                                                                |

## 6. Confirm, and tell the user

| You have         | Check               | Good looks like                      |
| ---------------- | ------------------- | ------------------------------------ |
| the poplin tools | call `list_sites`   | a list of sites, which may be empty  |
| no tools yet     | `npx poplin whoami` | the install's address and its `role` |

A check that answers a refusal goes to [`refusals.md`](refusals.md).

Then tell the user, in a line or two: poplin is ready, which install it talks to, and that they can now ask you to put a page or a folder online. If a step was skipped or failed, say which one and what is still missing.

Nothing is published by the setup. When the user later asks you to publish, [`../SKILL.md`](../SKILL.md) holds the rules. The two that matter most: a new site is private until the user asks otherwise, and you keep the label a publish returns so the next publish updates the same site.
