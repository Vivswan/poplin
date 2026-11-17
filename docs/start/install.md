---
title: Install
order: 20
---

# Install poplin

One command makes your install, under your own domain or without one. [Your agent can run it with you](with-an-agent.md), and [When the install stops](../fix/an-install-step-fails.md) has each line it can stop at.

```text
you have:   a Cloudflare account                 and, if you want one, a domain on it

you run:    npx poplin install cloudflare

you get:    https://poplin.example.com           your dashboard, under your domain
            https://poplin.your-name.workers.dev your dashboard, without a domain
```

An install is your own copy of poplin, in your own Cloudflare account. You make it once. After that, your agent and your computers publish to it.

`example.com` stands for your own domain, and `your-name` for your account's subdomain at `workers.dev`, which Workers & Pages shows at Cloudflare. Type yours in their place.

## Choose: a domain, or none

| You install       | Add to the command     | A site answers at                                                    |
| ----------------- | ---------------------- | -------------------------------------------------------------------- |
| under your domain | `--domain example.com` | a hostname of its own: `report--k3f9x2ab71qz-p-poplin.example.com`   |
| without a domain  | `--no-domain`          | a path: `poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/` |

**Which to choose:** a domain, if you have one at Cloudflare: a browser then keeps every site apart. Without one, a page of one site can read your other sites of its kind, so publish only pages you trust.

The choice is made once: poplin has no command and no screen that changes it on an install that is made. [Without a domain](without-a-domain.md) has every row that differs.

**To have the other kind afterwards**, [move the install](../upkeep/back-up.md#move-an-install): back up, install anew, and import. Every site then gets a new address, and each link you shared stops.

## What you need

| Thing                           | Why                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| a Cloudflare account            | the Free plan is enough. With none yet, sign up at `https://dash.cloudflare.com/sign-up`                    |
| a payment method on the account | the two sign-ups of step 1 ask for one. [What can cost money](../upkeep/cost/what-can-cost-money.md) says when it is charged |
| an email inbox you can read     | Cloudflare's login sends its code there. It need not be the email of your Cloudflare account                |
| Node.js, on your own computer   | the program that runs poplin's command, and `npx` comes with it. Version 24 or higher: step 2 checks it     |
| under a domain: the domain      | on that account, where Cloudflare's home page lists it as Active                                            |
| an agent, to publish by asking  | an AI tool that runs in a terminal on your computer, such as Claude Code or Codex. You install it yourself, it may cost money, and poplin brings none |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare shows two nameservers; paste them in the Nameservers setting at the shop where you bought the domain. The domain turns Active up to a day later.

## 1. Switch on what no command can

Open `https://dash.cloudflare.com` in your browser and log in. No command switches these on.

| Open                                        | Do                                                | It is                                | Kind of install   |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------ | ----------------- |
| Zero Trust, in the left menu                | pick a team name and the Free plan                | the login in front of your dashboard | both              |
| Storage & databases, then R2, then Overview | finish the checkout it shows                      | the storage for your sites' files    | both              |
| Workers & Pages                             | set the account's subdomain, if it shows none yet: any word of 36 characters at most | the `your-name` of your addresses | without a domain |

The team name can be any word: it only names your login page. Zero Trust and R2 each ask for the payment method. Each is done when Cloudflare shows its overview instead of the sign-up.

## 2. Run the command

Open a terminal, the window where you type commands:

```text
Mac:      press Command and Space, type Terminal, press Enter
Windows:  press the Windows key, type Command Prompt, press Enter
Linux:    open the program named Terminal
```

First check Node.js. Type the line and press Enter:

```sh
node --version
```

It must print `v24` or higher. If it prints less, or does not know `node`, run the installer nodejs.org offers first, the one marked LTS, then open a new terminal.

Then type the install's line. The first time, it asks whether it may download poplin: answer `y`.

```sh
npx poplin install cloudflare
```

It asks three things, then works, and at the end asks once more: whether to log this computer in. The sample cuts the link short, where the dots are:

```text
Custom domain (Enter for workers.dev): example.com
First user's email: you@example.com
The account token needs 10 permissions on this account and this domain:
  Zone: Read
  DNS: Edit
  Workers Routes: Edit
  Access: Apps and Policies: Edit
  Workers Scripts: Edit
  Access: Organizations, Identity Providers, and Groups: Read
  Zone Settings: Read
  D1: Edit
  Workers R2 Storage: Edit
  Account API Tokens: Edit
See: npx poplin install cloudflare --help for 4 optional permissions
Create the account token here:
  https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...
On the form, limit it to this account and this domain
Tick by hand: Workers R2 Storage: Edit
Account token (hidden):
```

| It asks                                  | Answer                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `Custom domain (Enter for workers.dev):` | your domain alone, with no `https://` and no `www`; or press Enter |
| `First user's email:`                    | an email whose inbox you can read                                  |
| `Account token (hidden):`                | leave the terminal at this question, and make the token: step 3    |

An **account token** is a long password that lets a program change your Cloudflare account. Cloudflare lists it under My Profile, then API Tokens. You give it at this question. Later, [three things ask for one again](#4-read-what-it-made), and one of them is the Domain screen of your own dashboard. Nothing else takes it: no chat, and no other page. What you paste is not shown, and nothing keeps it.

After the token, where Zero Trust is still off, the command says `Until then nobody can log in` and asks one thing more, `Continue anyway?`. Answer no, and finish step 1.

An option answers a question before it is asked: with `--domain example.com` on the line, the first is not asked. To see what a run would make before it makes anything, read [the dry run](#check-first-the-dry-run) first.

## 3. Make the account token

Copy the link the command printed into your browser, or press the same link here. It is this one for an install under a domain; [Without a domain](without-a-domain.md#the-account-token) has the other.

[Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_api_tokens%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20install)

The form opens with nine rows filled. The install needs ten permissions: the link cannot choose Workers R2 Storage, as the command's line under the link says, so add that one yourself. A zone is your domain.

| On the form       | Do                                                                               |
| ----------------- | -------------------------------------------------------------------------------- |
| the nine rows     | leave them                                                                       |
| Add more          | press it, and choose in the new row's three boxes: Account, Workers R2 Storage, Edit |
| Account Resources | choose Include, then your account                                                |
| Zone Resources    | choose Include, then Specific zone, then your domain                             |
| every other field | leave it as it is                                                                |
| the bottom        | press Continue to summary, then Create Token                                     |
| the next page     | the token is shown once: copy it, and leave the page open                        |

Then paste the token at the command's question, `Account token (hidden):`.

```text
Mac:      click the terminal, press Command and V, then Enter
Windows:  click the Command Prompt window, press Ctrl and V, or click the right mouse button; then Enter
Linux:    click the terminal, press Ctrl, Shift and V, then Enter
```

The terminal shows a row of small marks for what you paste, never the letters. Press Enter once.

**Leave Cloudflare's page with the token open** until the command says `is installed`: Cloudflare shows the token once, and a run that stops asks for it again. If the page is gone, choose Roll in the token's menu, under My Profile, then API Tokens: it shows a new text.

**Skip the optional permissions on a first install.** There are four, and `npx poplin install cloudflare --help` names them. A row that says `skipped` says what its permission adds. Nothing is wrong without them, and they can be added on any day: three for [rules against junk traffic](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers), and one for [an email about charges](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) at once.

**If the form opens empty**, [When the install stops](../fix/an-install-step-fails.md#the-token-form-opens-empty) has the ten rows to add by hand.

## 4. Read what it made

The command looks for an install first, then prints one row for each thing it makes:

```text
This account has no install
created    R2 bucket             poplin-sites
created    D1 database           poplin
created    Worker                poplin, runs 0.1.0
created    DNS record            poplin.example.com
created    Worker route          poplin.example.com/*
created    Access application    poplin: poplin.example.com, *-p-poplin.example.com
created    Key                   poplin kept key
Waiting for https://poplin.example.com to respond
poplin 0.1.0 is installed
Dashboard: https://poplin.example.com
The account token was not stored. You can delete it at Cloudflare.
Log this machine in now?
```

**It worked when** it says `poplin 0.1.0 is installed`, with the version of the day. The sample shows a few of the rows. A new address can take a few minutes: the command waits up to five.

**Where the address does not answer in that time**, the run says `poplin 0.1.0 is installed, but its URL does not respond yet` and exits with 1. Under it are two lines: the login for when the address responds, and the repair, with your `--domain` or `--no-domain`, for one that does not. A run that did not use `--user` has one line there: that repair with `--add-user`.

| A row starts with    | Means                                                                |
| -------------------- | -------------------------------------------------------------------- |
| `created`, `updated` | the thing was not there, or differed, and now is as it should be     |
| `unchanged`          | it was there already, as it should be                                |
| `skipped`            | it is optional and was not made: the token lacks its permission, or the domain or its plan has no room for it. Nothing is wrong. `First user` is skipped where a kept database holds its own users and the email is none of them |
| `blocked`            | it cannot be made until you act: the lines under the rows say where  |
| `failed`             | it could not be made, and the row says why                           |
| `not run`            | an earlier row stopped the run before it                             |

| Piece              | It is                                                           |
| ------------------ | --------------------------------------------------------------- |
| R2 bucket          | the storage for your sites' files                               |
| D1 database        | the list of your sites, the logins, and the settings            |
| Worker             | the program Cloudflare runs for you: it serves every site       |
| DNS record         | what makes an address under your domain exist                   |
| Worker route       | what sends that address to the Worker                           |
| Access application | Cloudflare's login in front of the dashboard and private sites  |
| Key                | a key the install keeps, so that it can update and repair itself |

Under a domain, the command adds records, routes, and rules of its own. A website or a mailbox on the domain stays as it is.

**Where an install already is**, the command changes nothing. It reads whether the install needs a repair, says what to run next, and names the command for each thing you may want:

```text
poplin 0.1.0 is already installed at https://poplin.example.com and needs no repair. Nothing changed.
Next: npx poplin login --server https://poplin.example.com
  check   npx poplin doctor
  update  npx poplin update
  remove  npx poplin uninstall cloudflare
```

| The first line says            | Run next                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `and needs no repair`          | log in: the line under it has the address                                     |
| `and needs a repair`           | the repair, as the line under it writes it: with `--domain` or `--no-domain`  |
| neither                        | the line under it says why that was not read, and names the repair's dry run  |

An install that works needs none of them: log this computer in, as step 5 shows.

**After the run, delete the token** at Cloudflare, under My Profile, then API Tokens, unless you keep it where you keep passwords. The install and every site keep working without it.

Three things ask for a token again: the dashboard's [Domain](../dashboard/domain.md) screen, `npx poplin doctor --repair`, and `npx poplin uninstall cloudflare`. Each shows the link that makes a new one. The screen asks for a Repair, and for a Check on an install that holds no key. A token pasted there goes to your own install, which uses it for that one run and stores it nowhere.

## 5. Log this computer in, and check

At `Log this machine in now?`, Yes is chosen already: press Enter. It prints an address and a short code in your terminal, and opens the address in your browser:

```text
Open this URL and approve the login:
  https://poplin.example.com/tokens/review/8c2e5a7019bd46f3
Enter the last 4 characters of this code on that page:
  WXKT-RDMP
The code expires in 10 minutes
```

Here the last 4 letters are `RDMP`. Yours differ. If no browser opens, copy the address of the second line into your browser.

| The browser shows            | Do                                                                    |
| ---------------------------- | --------------------------------------------------------------------- |
| Cloudflare's login, first    | type your email, the one of step 2, then the code Cloudflare sends it |
| `Allow this login?`, then    | the table below, with the short code of your terminal                 |

| On the page                                 | Do                                                    |
| ------------------------------------------- | ----------------------------------------------------- |
| Can change                                  | choose Everything, on a computer of your own          |
| Last 4 letters of the code in your terminal | type them                                             |
| Allow                                       | press it                                              |

Can change has two choices, and the page opens on the second:

| Can change     | Choose it for                             | This computer reaches                                                              | The login lasts       |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| Everything     | a computer of your own                    | every site, and the settings: `npx poplin config`, `export`, `import`, and `update` need it | 30 days       |
| Own sites only | a computer that should only publish, such as a shared one | the sites that one login published, and no other                   | until you remove it   |

An agent on this computer uses the same login. With Everything it reaches a site that an earlier login published. With Own sites only it does not: after a new login it no longer reaches the sites of the login before.

The page takes only the letters of the code your terminal printed. If it refuses them, or you did not start a login, press Deny.

After a no, or on another computer, the same login is one line, with the address of your own dashboard, as the command printed it:

```sh
npx poplin login --server https://poplin.example.com
```

Then check:

```sh
npx poplin doctor
```

Every check it prints starts with `ok`, and its last line says `Nothing changed`:

```text
ok  install   https://poplin.example.com responds
ok  version   install 0.1.0, CLI 0.1.0
ok  login     admin token 3f9a1c07b2d84e65, stored on this machine, expires 2026-12-15
ok  settings  21 settings
ok  sites     0 sites
ok  trash     0 sites
ok  problems  none in 7 days
Nothing changed
```

The login lasts 30 days: after that, `npx poplin login` makes a new one. **If a line does not start with `ok`**, [When the install stops](../fix/an-install-step-fails.md#the-computer-is-not-logged-in) has it.

Your dashboard is at the address the command printed. It opens on Sites, which says `No sites yet`.

## Publish

| Publish            | Do                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| by asking an agent | set the agent up once, with the line of [With an agent](with-an-agent.md). Then say `Put this report online.` |
| by a command       | `npx poplin ./report`, for a folder with an `index.html` in it, the page a site opens on: see [Publish](../sites/publish.md). With no page yet, ask your agent to write one |

`./report` is a folder named `report` inside the folder the terminal is in. A folder that is somewhere else is named by its whole path:

```text
Mac:      npx poplin ~/Desktop/report
Windows:  npx poplin "C:\Users\user\Desktop\report"
```

On a Mac, `~` is your own folder. On Windows, `user` stands for your own name on the computer, and the quotes keep a path that holds a space in one piece.

A new site takes its name from the folder, and a name holds small letters, digits, and dashes alone. A folder such as `my report` needs `--name`, and on a Mac its quotes come after the `~/`:

```text
Mac:      npx poplin ~/"Desktop/my report" --name my-report
Windows:  npx poplin "C:\Users\user\Desktop\my report" --name my-report
```

## Check first: the dry run

`--dry-run` reads everything, changes nothing, and lists what a run would make. It asks for what its line does not give: here, the token alone.

The run after it asks for the token again. Leave Cloudflare's page with the token open until the install is made, and copy the token from it a second time.

```sh
npx poplin install cloudflare --domain example.com --user you@example.com --dry-run
```

```text
This account has no install
would create  R2 bucket             poplin-sites
would create  D1 database           poplin
would create  Worker                poplin, runs 0.1.0
would create  DNS record            poplin.example.com
would create  Access application    poplin: poplin.example.com, *-p-poplin.example.com
A dry run does not test the account token's write permissions
A run would create 27 resources and update 1
```

The sample is of a token that holds the four optional permissions. With a token that lacks one, the last line counts those rows too: `and skip`, and their number.

| The last line starts with   | Means                                                                              | Exit code |
| --------------------------- | ---------------------------------------------------------------------------------- | --------- |
| `A run would`, and a count  | nothing that a read can see blocks a run. A write is proven only by the run itself | 0         |
| `A run would be incomplete` | you must act first, and the lines above it say where to click; or a row `failed`, and says why | 1 |

A dry run exits as the run after it would: 0 when a run would go through, and 1 when something stops it first. The same holds for the dry run of `poplin doctor --repair` and of `poplin uninstall`.

The rows are the ones the run then prints, in the same order: `would create` becomes `created`.

## Every answer as an option

Each question has an option and a variable, so a run can ask nothing. An agent and a script run it this way.

| Answer                   | Option                                 | Variable                             |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| under a domain           | `--domain example.com`                 | `POPLIN_DOMAIN`                      |
| without a domain         | `--no-domain`                          | `POPLIN_DOMAIN` set to the word none |
| the first user           | `--user you@example.com`               | `POPLIN_USER`                        |
| the account token, for a script alone | `--token-stdin` reads it from standard input | `POPLIN_INSTALL_TOKEN` |
| the account, when the token shows more than one | `--account` and the account's id | `POPLIN_ACCOUNT`    |

No option carries the token itself.

| Who runs the command | The token is given                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- |
| a person             | at the question `Account token (hidden):`. What you paste is not shown, and nothing keeps it |
| a script or a CI job | in the variable `POPLIN_INSTALL_TOKEN`, which the secret store of the CI sets; or on standard input, with `--token-stdin` |

**Do not type an `export` line with the token into a terminal.** The shell keeps every line you type in its history, and the token with it. The variable is for a program that nobody types into.

A script's line names every answer but the token, and adds `--yes`:

```sh
npx poplin install cloudflare --no-domain --user you@example.com --yes
```

| Option        | Does                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `--yes`       | asks nothing. A missing answer stops the run before any change, and is named             |
| `--json`      | prints one JSON value, and nothing else on standard output                               |
| `--adopt`     | uses a bucket or a database named like poplin's that no install holds, with what it holds. Where the database holds users, they log in, and [`--user` is not used](../upkeep/remove.md#keep-the-data) |
| `--log-in`    | logs this computer in when the install is made; `--no-log-in` does not, and does not ask |
| `--no-wait`   | does not wait for the new install to answer                                              |

A run that asks nothing logs no computer in unless `--log-in` says so. It ends by printing the login line. A run that kept the users of a database and did not use the email of `--user` logs no computer in. It ends with the line that lets that email in, also where its address does not answer yet.

With `--json`, the value of a run, and of a run that stopped, names what to run next in `next`: a `step`, and its `command`. A run without `--json` names the same command in its last lines. After an install that could not be read, that line adds `--dry-run`.

| The `command` holds                                    | When                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| the place: `--domain example.com`, or `--no-domain`    | the run knew it: from your line, the variable, or your answer         |
| `--dry-run`, and a removal's `--keep-data`             | `next` names the same command again, after a stop or a run not ready  |
| `--add-user` and an email                              | an install kept its users and did not use `--user`; or a repair given it has something to mend yet |
| a repair's `--update`                                  | the repair's own line had it; or a repair stopped at an install that is behind, with records only an update brings to this poplin |
| no token, no login, no account, no proof, no `--adopt` | always: these are yours to add                                        |

So a repair it names runs as written where nothing can be asked, with the token in `POPLIN_INSTALL_TOKEN`.

On Windows, an email with a character that cmd.exe or PowerShell gives a meaning, such as `&` or `'`, is left out of the `command`. `next.add` is then `--add-user <email>`, and an install that prints the line says under it to add the email yourself.

Some stops name the command with no place. A stop that comes while the line is read does: the line is written wrong, or lacks an answer. So may a command that was stopped, or that failed with no word for it. `other_place` does too: the install is at another place than your line named, and its sentence names the option.

A repair that found an install started for another place names the install with that place's option.

| `next.step` | Run next                                                                    |
| ----------- | --------------------------------------------------------------------------- |
| `install`   | the install, as `command` writes it, with the login added                   |
| `repair`    | the repair, as `command` writes it: the newest poplin's where it says `npx poplin@latest` |
| `login`     | `npx poplin login`, with `--server` and the install's address               |
| `uninstall` | the removal, as `command` writes it, with its proof added: a removal's dry run, one that left a kind, or one whose token could not look for a kind |
| `none`      | nothing                                                                     |

| Exit code | Means                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| 0         | installed; or a dry run that is ready                                              |
| 1         | nothing was made, or not all of it; or a dry run that is not ready                 |
| 2         | the line is written wrong, or an answer is missing in a run that asks nothing      |
| 5         | Cloudflare or poplin's website gave no answer                                      |

`npx poplin install --help` lists the options, and `npx poplin install cloudflare --help` the permissions. The link to the token form is printed by the run, above its question for the token.

## Afterwards

| To                                  | Run                                | Page                                              |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------- |
| get back in when nobody can log in  | `npx poplin doctor --repair`       | [I cannot log in](../fix/cannot-log-in.md)        |
| update the install                  | `npx poplin update`                | [Update](../upkeep/update.md)                     |
| take the install down               | `npx poplin uninstall cloudflare`  | [Remove](../upkeep/remove.md)                     |
