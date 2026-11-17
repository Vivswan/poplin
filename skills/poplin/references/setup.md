# Set up poplin with the user

Open this when the user asks you to set poplin up, or when you have no poplin tools and no login. It is the whole script: a first install from nothing, or connecting yourself to an install that exists.

**You act as the user, with their own login, and you ask before you change your own configuration.** The login is the one saved on this computer. You leave a saved login as it is.

Poplin publishes a static site (a folder, or one HTML file) to an install: the user's own copy of poplin, in their own Cloudflare account. Once you are set up, the user can ask you to put a page online and you hand back its address.

| Step | What happens                                          | Who does it                                         |
| ---- | ----------------------------------------------------- | --------------------------------------------------- |
| 1    | Say what is about to happen, and ask                  | you                                                 |
| 2    | Check what exists: Node.js, a saved login, an install | you                                                 |
| 3    | Make the install, when there is none                  | the user: in a browser, then two lines of one command in a terminal of their own: the dry run, and the run. You run both in a script alone |
| 4    | Log this computer in, when no login is saved          | you run it, or the user at the end of step 3; the user allows it in a browser |
| 5    | Add the MCP server to your own configuration          | you                                                 |
| 6    | Confirm that it works, and tell the user              | you                                                 |

The user's page, [With an agent](https://github.com/Vivswan/poplin/blob/main/docs/start/with-an-agent.md), counts the same steps. Its steps 3a to 3e are parts a to e of step 3 here: name a step to the user by that number, such as "step 3d".

`example.com` stands for the user's own domain, and `https://poplin.example.com` for the address of their dashboard, here and below. On an install without a domain the dashboard is at `https://poplin.your-name.workers.dev`, where `your-name` is a word of the user's account. The poplin repository and the place you read this page from are neither. `npx` may ask to download the `poplin` package the first time it runs: answer yes.

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

One command makes the install: `npx poplin install cloudflare`. It looks for an install first, and where one is, it says so and changes nothing.

```text
a  ask two things          a domain or none; the email of the first login
b  the browser             the user switches on what no command can
c  the account token       the user makes it; it never passes through the chat
d  the dry run             reads everything, changes nothing, and says what blocks a run
e  the run                 makes the install, and prints the dashboard's address
```

Before part a, ask what the user has. Say which of these is missing, and stop until they have it.

| The user needs                  | For                               |
| ------------------------------- | --------------------------------- |
| a Cloudflare account            | the Free plan is enough           |
| an email inbox they can read    | the login's code goes there       |
| a payment method on the account | part b asks for one               |

Say when the payment method can be charged, in the words of [What can cost money](https://github.com/Vivswan/poplin/blob/main/docs/upkeep/cost/what-can-cost-money.md).

### a. Ask two things

Ask which of the two kinds the user wants, and keep the answer. Show the table, and say the last row in a sentence of your own.

| Thing                    | Under the user's domain                                 | Without a domain                                             |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| the user needs           | a domain that Cloudflare's home page lists as Active    | nothing more                                                 |
| the option               | `--domain example.com`                                  | `--no-domain`                                                |
| the dashboard            | `https://poplin.example.com`                            | `https://poplin.your-name.workers.dev`                       |
| a site's address         | a hostname: `report--k3f9x2ab71qz-p-poplin.example.com` | a path: `poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/` |
| a link that starts with `/` | works                                                | the publish is refused: links are written from their own page |
| blocking AI crawlers     | a setting of the install                                | that one setting does nothing                                |
| two sites in one browser | kept apart                                              | sites of a kind share one browser origin: a script of one can read another, so only trusted pages belong there |

When the user asks which to take: a domain, if they have one at Cloudflare; without one otherwise. The kind is chosen once. Poplin has no command and no screen that changes it on an install that is made. To have the other kind later, the user backs up, installs anew, and imports: [moving the install](#when-the-user-asks-to-move-the-install).

Then ask for the email of the first login: one whose inbox the user can read. It goes after `--login`.

### b. The browser: what no command switches on

Ask the user to open <https://dash.cloudflare.com> and log in.

| Open                                        | Do                                                | Kind             |
| ------------------------------------------- | ------------------------------------------------- | ---------------- |
| Zero Trust, in the left menu                | pick a team name and the Free plan                | both             |
| Storage & databases, then R2, then Overview | finish the checkout it shows                      | both             |
| Workers & Pages                             | set the account's subdomain, if it shows none yet | without a domain |

The team name can be any word. Zero Trust and R2 each ask for the payment method. Each is done when Cloudflare shows its overview instead of the sign-up. The dry run of part d tells you when one is still off.

### c. The account token

**Never take the account token in the chat.** It changes the user's Cloudflare account. The user gives it to the command, which sends it to Cloudflare and stores it nowhere.

After the install, three things take a token again: the Domain screen of the user's own dashboard, for a Repair and for a Check on an install that holds no key, `npx poplin doctor --repair`, and `npx poplin uninstall cloudflare`. Nothing else does: send the user to no other page with it.

If the user pastes it to you all the same, do not repeat it. Ask them to open My Profile, then API Tokens, at Cloudflare, to choose Roll in that token's menu, and to use the new text.

| You run                                     | The token reaches the command                                  | Parts d and e are run by |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------ |
| on the user's computer, in a chat           | at its question `Account token (not shown):`, typed by the user | the user, in a terminal of their own |
| in a script or a CI job, with nobody to ask | in `POPLIN_INSTALL_TOKEN`, which the job's secret store set    | you                      |

Never ask the user to set that variable for you. A line that sets it, such as an export line, stays in their shell's history with the token in it. The first run of part d tells you which row you are in.

Run this, and give the user the link of their kind from what it prints:

```sh
npx poplin install cloudflare --help
```

The link opens Cloudflare's form with every permission chosen but one.

| On the form       | The user                                                                             |
| ----------------- | ------------------------------------------------------------------------------------ |
| the rows          | leaves them: nine under a domain, five without one                                   |
| Add more          | presses it, and chooses in the new row's three boxes: Account, Workers R2 Storage, Edit |
| Account Resources | chooses Include, then their account                                                  |
| Zone Resources    | under a domain alone: chooses Include, then Specific zone, then their domain         |
| every other field | leaves it as it is                                                                   |
| the bottom        | presses Continue to summary, then Create Token                                       |
| the next page     | copies the token: it is shown once. They leave that page open until the install is made: parts d and e each ask for the token |

That makes ten permissions under a domain, and six without one. If the form opens empty, the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/fix/an-install-step-fails.md#the-token-form-opens-empty) has the rows to add by hand.

### d. The dry run

Run it with the user's two answers. It changes nothing.

```sh
npx poplin install cloudflare --domain example.com --login you@example.com --dry-run --json
```

Without a domain, `--no-domain` stands in place of `--domain example.com`.

`--json` stops no question: the command asks where its input and its error output are both a terminal. If yours are, add `--yes`, which asks nothing. With no token in your environment the line then ends at once with `missing_answer`.

It prints one JSON value:

```json
{ "ok": true, "run": "dry-run", "ready": true, "address": "https://poplin.example.com",
  "rows": [{ "object": "R2 bucket", "will": "make", "detail": "poplin-sites" }],
  "blocked": [], "steps": [],
  "next": { "step": "install", "command": "npx poplin install cloudflare --domain example.com" } }
```

Every value of a run of this command, of the repair, and of the removal names what to run next in `next`, and so does a run that stopped. Its `command` holds the place of your line, `--domain example.com` or `--no-domain`, and no other answer your line gave.

| `command` names | It runs as written, with the token in your environment | Add                                   |
| --------------- | ------------------------------------------------------ | ------------------------------------- |
| the repair      | yes                                                    | `--json`, to read its value           |
| the install     | once it has the login                                  | `--login`, `--yes`, `--json`          |
| the removal     | never by you: the user runs it                         | nothing                               |

Some stops name the command with no place. One that comes while the line is read does, as `usage` and a `missing_answer` do, and `stopped` and `crashed` may. `other_place` does too: the install is at another place than your line named, and its sentence names the option to give.

Where `next.step` is the command you just ran, its `command` keeps `--keep-data` of a removal, and `--dry-run` of a dry run that stopped or is not ready: leave both on the line.

A consent is never in `command`. Where a repair found kept data and no install, its sentence names `--adopt`: ask the user before you add it, since it uses the data with what it holds. Where a repair found an install started for another place, `command` holds that place's option: use it in place of yours.

| `next.step` | Run next                                                        |
| ----------- | --------------------------------------------------------------- |
| `install`   | the line of part e                                              |
| `repair`    | the repair of part f, as `command` writes it                    |
| `login`     | step 4, with the address in `command`                           |
| `uninstall` | a removal's own line again: the user's to run                   |
| `none`      | nothing                                                         |

| The value says                                         | Exit code | Means                                          | Next                                                  |
| ------------------------------------------------------ | --------- | ---------------------------------------------- | ----------------------------------------------------- |
| `missing_answer`, and its list holds the word token    | 2         | your environment holds no token                | the user runs parts d and e: see below                |
| `ready` is true                                        | 0         | no read found anything that blocks a run       | part e                                                |
| `ready` is false, and `blocked` has entries            | 1         | the user must act first                        | the table of blocks below, then this part again       |
| `ready` is false, `blocked` is empty, and no `problem` | 1         | a read failed, and its row says why            | run it again in a minute                              |
| `already_installed`                                    | 1         | the account holds an install; nothing changed  | keep the address under `found`. `next.step` is `login` for an install that is as it should be: step 4. It is `repair` for the rest: part f, as `next.command` writes it |
| `leftover`                                             | 1         | an earlier install left a bucket or a database | ask the user whether to use it; if yes, add `--adopt`. Where its database holds users, they log in: a row `First login` that was left out says `--login` was not used |
| any other `problem`                                    | 1, 2, 5   | a stop                                         | [`refusals.md`](refusals.md)                          |

Each entry of `blocked` has the address to open, and says what blocks:

| It says         | Ask the user to                                                               |
| --------------- | ----------------------------------------------------------------------------- |
| `storage_off`   | finish the R2 row of part b, and check the token's row Workers R2 Storage     |
| `login_off`     | finish the Zero Trust row of part b                                           |
| `right_lacking` | add the permission it names to the token: Edit in the token's menu, then save |
| `no_address`    | finish the Workers & Pages row of part b: a subdomain of 36 characters at most |
| `no_release`    | wait: poplin's website names no version to install yet                        |
| `newer_release` | nothing: run the line again as `npx poplin@latest install cloudflare`         |
| `bad_release`   | nothing: run the line again, and tell the user if it comes back               |

**When your environment holds no token**, the user runs the command in a terminal of their own, where you do not see the token. Give them this one line, with their answers in it:

```sh
npx poplin install cloudflare --domain example.com --login you@example.com --dry-run
```

Say how to open that terminal: a new window, beside the one you run in.

```text
Mac:      press Command and Space, type Terminal, press Enter; then press Command and N for a new window
Windows:  press the Windows key, type Command Prompt, press Enter
Linux:    open a new window of the program named Terminal
```

It asks `Account token (not shown):`. The user pastes the token there and presses Enter: a row of small marks shows, never the letters. Ask them to copy you everything it printed: the token is in no line.

**The token is asked for twice**, by this dry run and by the run of part e, and Cloudflare shows it once. What the user copies for you takes its place on their clipboard. Say so before the dry run:

| The token                     | The user                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| is still on Cloudflare's page | leaves that page open until the install is made, and copies the token from it again for part e |
| is gone                       | opens My Profile, then API Tokens, at Cloudflare, and chooses Roll in the token's menu: it shows a new text |

| Its last line starts with | Next                                                |
| ------------------------- | --------------------------------------------------- |
| `ready:`                  | part e                                              |
| `not ready:`              | the lines above it say what to switch on, and where |
| anything else             | look the line up in the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/fix/an-install-step-fails.md) |

### e. The run

The same line, with `--yes` in place of `--dry-run`:

```sh
npx poplin install cloudflare --domain example.com --login you@example.com --yes --json
```

| The value says                          | Exit code | Next                                                                   |
| --------------------------------------- | --------- | ---------------------------------------------------------------------- |
| a `problem`                             | 1, 2, 5   | a stop, with no rows: the table of part d, then [`refusals.md`](refusals.md) |
| `ok` is true                            | 0         | the install is made: keep `address`, the dashboard's, and go to step 4 |
| `ready` is true, and `answers` is false | 1         | the install is made, and its new address does not answer yet: wait a few minutes, then step 4. If it still does not answer: the repair of part f |
| `ready` is false, and no `problem`      | 1         | not all was made: tell the user each entry of `blocked`, each row that did not come to make, change, or leave, and each entry of `steps`. There may be no rows. Then part f |

Where `next.step` is `repair` and its `command` holds `--add-user`, the install kept the users its database holds, and the email of `--login` is none of them. Tell the user who logs in, as the row `First login` names them.

Run that `command` as it is written, in place of step 4 and of the repair of part f: it holds the install's place, mends what is undone, and lets the email in. Without `--add-user` the email stays out.

A run that stopped is looked up in the [install guide](https://github.com/Vivswan/poplin/blob/main/docs/fix/an-install-step-fails.md#part-way), by the words of its rows.

**When the user runs it**, the line has no `--dry-run`, no `--yes`, and no `--json`. It asks for the token again: the user copies it from Cloudflare's page a second time, or rolls it, as part d has it. It prints a row for each thing it makes, and ends:

```text
poplin 0.1.0 is installed.
Your dashboard: https://poplin.example.com
The token was used for this run and is stored nowhere. You can delete it at Cloudflare.
Log this computer in now?
```

Tell the user to answer yes: that is the login of step 4, in their own terminal. Their browser opens Cloudflare's login, which sends a code to their email, and then the question `Allow this login?`. Tell them the two choices of Can change first, as step 4 has them. Then run the check of step 4.

A run that kept a database's users and did not use the email of `--login` asks no such question. Its last line is `To let` the email `log in too:` and a repair with `--add-user`: the user runs that line.

The command stores the token nowhere. Afterwards the user either keeps it where they keep passwords, or deletes it at Cloudflare, under My Profile, then API Tokens: the install keeps working.

### f. When a run left something undone

The user first does what `blocked` and `steps` name, such as switching Zero Trust on. The value of the run that left something undone says which command goes on from what stands, in `next`.

| `next.step` of that run                     | The install is                          | Run next                                    |
| ------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| `install`                                   | started, and not set yet                | the line of part e again                    |
| `repair`                                    | set, with pieces missing: often the login, made with Zero Trust off | the repair below    |

A run without `--json`, as the user's is, names the same in its last line: it ends `Run this command again`, or names the repair.

`poplin install` only makes a new install: a second run on one that is set answers `already_installed` and changes nothing. The repair mends it, with the same token and the option of the install's kind. `next.command` is that line, and `--yes` and `--json` are yours to add:

```sh
npx poplin doctor --repair --domain example.com --yes --json
```

Without a domain, `--no-domain` stands in place of `--domain example.com`. When the user runs it, the line is `npx poplin doctor --repair` alone: it asks for the domain, or Enter for none, and for the token.

| The value says                              | Exit code | Next                                                                  |
| ------------------------------------------- | --------- | --------------------------------------------------------------------- |
| a `problem`                                 | 1, 2, 5   | a stop, with no rows: [`refusals.md`](refusals.md) says what to change first, or to wait |
| `ok` is true                                | 0         | nothing is left undone: keep `address` under `found`, and go to step 4 |
| `ready` is false, and no `problem`          | 1         | tell the user each row that did not come to make, change, or leave, and each entry of `blocked` and `steps`; then this line again |

With `--dry-run` in place of `--yes` it changes nothing, and `changes` counts what a run would make or change. It exits as the run after it would: with 0 where a run would go through, also while `changes` is above 0. `next.step` is `repair` then, with `--add-user` where your line had it, and `login` once nothing is left to mend.

## 4. Log this computer in

Do this when step 2 found no login. For a login that ran out, do it only on the user's yes. Never replace a login that works.

Run the login with the dashboard's address: the one the user gave you, or the one the install printed. It prints a web address and a short code, and then waits for the user, so run it in a way that lets you read its output while it is still running:

```sh
npx poplin login --server https://poplin.example.com
```

Give the user both, each on its own line. The address opens the dashboard on the question `Allow this login?`. The page asks for the last 4 letters of the code. Neither the page nor the address holds any of them, so the user needs the code you gave them.

On a new install Cloudflare's login comes first: it asks for the user's email and sends a code to its inbox. A new address can take a few minutes to answer: until then the browser cannot find it.

| The user                           | Does                                              |
| ---------------------------------- | ------------------------------------------------- |
| asked you for this login           | types the last 4 letters, then presses Allow      |
| sees the page refuse those letters | presses Deny: that page is of some other login    |

The page has one choice, Can change, and it starts at Own sites only. Tell the user both rows before they press Allow. The choice is theirs: you use the login they allow.

| Can change     | The guide says it is for                  | You then reach                                                        | The login lasts        |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| Everything     | the user's own computer                   | every site of the install, and its settings                           | 30 days                |
| Own sites only | a computer that should only publish       | the sites that one login published, and no other                      | until the user removes it |

With Own sites only, a site another login published is refused, with `not_found` or `not_allowed`. After a new login, that holds for every site you published before it. That is why the guide says Everything on the user's own computer.

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
| the same, where the login line says publisher token, and the settings line says `not read: this token is no admin's` | 0 | the login is of Own sites only, and nothing is wrong: step 5 |
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

## When the user cannot log in, or asks to remove the install

Both are commands the user's account token runs, so the rule of part c holds: the token never passes through the chat.

| The user says                               | The command                                      | You                                                                                   |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| nobody can log in to the dashboard          | `npx poplin doctor --repair`                     | give the user the line, and read what it printed with them: the table of part f       |
| an update says the install cannot take the release by itself | `npx poplin doctor --repair --update`            | with `--update` the repair first brings the install to the newest release: its row `Worker` says `changed`. Without it a repair only mends, and that row says which release is out |
| their mailbox is gone, or the first email was mistyped | `npx poplin doctor --repair`, with `--add-user` and the email | add the option only with an email the user gave you for this                        |
| remove the install                          | `npx poplin uninstall cloudflare --dry-run`      | give the user the line, and read its list with them: it asks for the token. The removal itself is the user's too: they type the install's address at its question |

Never pass `--confirm` on your own: it is the proof that the user means this install, and a removal cannot be undone. The guide has both: [I cannot log in](https://github.com/Vivswan/poplin/blob/main/docs/fix/cannot-log-in.md) and [Remove](https://github.com/Vivswan/poplin/blob/main/docs/upkeep/remove.md).

## When the user asks to move the install

No command moves an install: not to a domain, not off one, and not to another account. Say so, and say the one way: back up, install anew where they want it, and bring the data back. Do not offer `--keep-data` and `--adopt` for it: they make the same kind again over kept data.

| Step | The line                                            | Who                                                     |
| ---- | --------------------------------------------------- | ------------------------------------------------------- |
| 1    | `npx poplin export --all-versions --out backup.zip` | you, on the user's yes, with a login of Everything      |
| 2    | `npx poplin import backup.zip --dry-run`            | you: it checks the zip, and sends nothing               |
| 3    | the new install. In one account, the removal of the old install comes first | the user: the install as [3. Make the install](#3-make-the-install) has it, the removal as the last row of the table before this one has it |
| 4    | the login of this computer to the new install       | the user: yes at `Log this computer in now?`, the last question of their install, with Can change: Everything. It replaces the saved login of the old install |
| 5    | `npx poplin import backup.zip --settings`           | you, once `npx poplin whoami` names the new install     |
| 6    | to another account: the removal of the old install  | the user, once step 5 put every site back               |

You log this computer out of nothing and in to nothing for a move: step 4 is the user's own answer, in their own terminal.

Tell the user what changes before step 1, and wait for their yes. Under another domain, or of the other kind, every site gets a new address and each link they shared stops. In one account the old install goes before the new one is made, so the zip is then the only copy.

| The line                   | Carries                                                            | Without it                                        |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `--all-versions`, step 1   | every kept version of each site                                    | the live version alone: the others are lost       |
| `--settings`, step 5       | every setting but the logins                                       | the new install keeps its own settings            |
| `--settings --logins`      | the list of users too                                              | the users are the new install's first login       |

No line carries a token, a key of the install, or the activity log: each computer logs in again, and the log starts anew.

Off a domain, a site with a root link, or with a public name in the form of an id, is not put back. Mend those on the old install before step 1. [Move an install](https://github.com/Vivswan/poplin/blob/main/docs/upkeep/back-up.md#move-an-install) has every row.

Nothing is published by the setup. When the user later asks you to publish, [`../SKILL.md`](../SKILL.md) holds the rules. The two that matter most: a new site is private until the user asks otherwise, and you keep the label a publish returns so the next publish updates the same site.
