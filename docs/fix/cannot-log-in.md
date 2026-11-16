---
title: I cannot log in
order: 5
---

# I cannot log in

What to do when nobody gets into the dashboard. One command mends the login from a terminal, and can let one more email in. It asks for no login of poplin: it works with the Cloudflare account the install is in.

```text
you have:   the Cloudflare account the install is in

you run:    one of two lines
            npx poplin doctor --repair                              -> the login page is missing or broken
            npx poplin doctor --repair --add-user new@example.com   -> your mailbox is gone, or your email was mistyped

you get:    the login mended, and with --add-user one more email that can log in
```

`new@example.com` stands for the email you want to log in with, and `example.com` for your own domain.

## First: which case is it

| You see                                                               | It is                                                   | Do                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| a command says `not logged in`, or `no token was sent, or it expired` | this computer's own login ran out. The dashboard still opens | `npx poplin login`: [The computer is not logged in](an-install-step-fails.md#the-computer-is-not-logged-in) |
| the browser asks for your email, and no code arrives                  | the email is no user of the install, or its mailbox is gone | [the steps](#the-steps), with `--add-user`. With a mailbox that still works, check the spelling and the spam folder first |
| the browser shows no login page: `The login is not set up yet.`, or an error | the login page in front of the dashboard is missing or broken | [the steps](#the-steps), without `--add-user`                  |
| the install said `until then nobody can log in` when it was made      | Zero Trust was off, so the login page was never made    | switch Zero Trust on, as [step 1 of Install](../start/install.md#1-switch-on-what-no-command-can) has it. Then [the steps](#the-steps) |

Another user of the install who still gets in can add your email on the dashboard instead: [Add a user](../dashboard/access.md#add-a-user).

## What you need

| Thing                    | Where it comes from                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| the Cloudflare account   | the one the install is in. You must be able to log in at `https://dash.cloudflare.com`                 |
| a terminal, and Node.js 24 | the start of [step 2 of Install](../start/install.md#2-run-the-command), up to `node --version`      |
| the kind of your install | your dashboard's address ends in `workers.dev`: no domain. Else it is `poplin.` and then your domain   |
| an account token         | the command prints the link that makes one, and asks for it. A token you kept from the install works too |

An **account token** is a long password that lets a program change your Cloudflare account.

## The steps

1. **Run the line of your case.** One run does everything: it mends the login, then adds the email.

   | Your case                              | The line                                                |
   | -------------------------------------- | ------------------------------------------------------- |
   | the login page is missing or broken    | `npx poplin doctor --repair`                            |
   | your email gets no code                | `npx poplin doctor --repair --add-user new@example.com` |

   The first time, it asks whether it may download poplin: answer `y`. Then it asks two things:

   | It asks                                             | Answer                                                                   |
   | --------------------------------------------------- | ------------------------------------------------------------------------ |
   | `Your own domain (example.com), or Enter for none:` | the install's domain alone, with no `https://` and no `www`; or press Enter, for an install at `workers.dev` |
   | `Account token (not shown):`                        | leave the terminal at this question, and make the token: the next step   |

   Between the two it prints what the token needs, and the link to its form. Without a domain:

   ```text
   Your own domain (example.com), or Enter for none:
   The account token needs 5 permissions, for this account:
     Access: Apps and Policies: Edit, Workers Scripts: Edit, ...
   Optional:
     Notifications: Edit: Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar.
   This link opens the form with each one chosen that a link can choose:
     https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...
   On the form, choose your account under Account Resources, then create the account token and copy it.
   Account token (not shown):
   ```

   With `--domain example.com` or `--no-domain` on the line, the first question is not asked.

2. **Make the account token.** Open the link the command printed above its second question, and fill the form as the table of your kind shows: [under a domain](../start/install.md#3-make-the-account-token), or [without a domain](../start/without-a-domain.md#the-account-token). Skip the row that table adds by hand: a repair needs no Workers R2 Storage: Edit. The form names the token "poplin install". An older token of that name can stay.

3. **Paste the token at the question, and press Enter.** Its letters do not show. Nothing keeps it: not the command, and not your terminal's history.

4. **Read the rows.** This is a run with `--add-user` on an install under a domain, where the login page was missing. It is cut short where the dots are:

   ```text
   looking for an install ... found: poplin 0.1.0, at https://poplin.example.com
   left      DNS record            poplin.example.com
   ...
   made      Access application    poplin: poplin.example.com, *-p-poplin.example.com
   made      Access policy         poplin logins
   ...
   left      Workflow              poplin-jobs
   made      User                  new@example.com
   The login is ready. Open your dashboard and log in:
     https://poplin.example.com
   the install is mended.
   Your dashboard: https://poplin.example.com
   The token was used for this run and is stored nowhere. You can delete it at Cloudflare.
   ```

   Without a domain, the address ends in `workers.dev`, and rows named `Forwarder` stand in place of `DNS record` and `Worker route`. Where the login page was fine, its rows say `left`.

5. **Open the dashboard and log in.** Cloudflare's login page asks for your email, and sends a code to its inbox. After a run with `--add-user`, type the email you gave it.

## What the rows say

Every piece of the install has a row. Three matter here:

| Row                  | It is                                                         |
| -------------------- | ------------------------------------------------------------- |
| `Access application` | Cloudflare's login page in front of your dashboard            |
| `Access policy`      | the list of emails that page lets in: the users of the install |
| `User`               | the email `--add-user` named                                  |

| A row starts with   | Means                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| `left`              | the piece was as it should be                                          |
| `made`, `changed`   | the piece was missing or differed, and is mended                       |
| `left out`          | an optional piece the token cannot reach: it stays as it is. Nothing is wrong |
| `stopped`           | it cannot be mended until you act: [When it stops](#when-it-stops)     |
| `failed`, `not run` | Cloudflare refused the piece, or an earlier row stopped the run        |

| The last lines say                                    | Means                                         | Do                                                           |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `the install is mended.`                              | what was missing is made, the new user too    | log in                                                       |
| `the install is as it should be. nothing was changed` | nothing was broken, and no user was added     | if no code arrives, run the line with `--add-user`           |
| a number, then `not done. Run this command again`     | a row says `stopped`, `failed`, or `not run`  | [When it stops](#when-it-stops), then the same line again    |

The login is mended to the users the install has stored. No site and no setting of yours is changed.

**To look first**, add `--dry-run`: it lists the same rows as `would make` and `would leave`, and changes nothing. Its last line starts `ready:` and counts what a run would make or change, or says `the install is as it should be`. It starts `not ready:` where a run would be stopped.

## The row of the new user

| The row `User` says                                | Means                                                              | Do                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `made`                                             | the email is a user now                                            | log in with it                                       |
| `left`, ending `a user already`                    | the email was a user before, and nothing was stored                | log in with it                                       |
| `stopped`, with a permission's name                | the token may not change who logs in, so nobody was added          | [the token it needs](#the-token-it-needs)            |
| `stopped`, ending in an address with `/api/whoami` | the install has never answered a request, so it has stored no users yet | open that address in your browser once, then run the line again |

The address with `/api/whoami` asks for no login. Your browser shows a short refusal there, and that is enough.

It adds one email and takes none away. Once you are in, in this order:

| Do                                         | Where                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. remove the lost or mistyped email       | the dashboard, Access, Users: the menu at the end of that email's row, then Remove |
| 2. log your computers in again             | `npx poplin login`, with `--server` and your dashboard's address: removing an email ends every login that email allowed |
| 3. delete the account token, or keep it    | at Cloudflare, under My Profile, then API Tokens. Keep it where you keep passwords until step 1 is done |

The dashboard's Activity lists the new user as `Changed the settings`, by `doctor-repair@poplin.invalid`. No user of yours has that email: it marks a change made from a terminal.

## The token it needs

| The run                | Needs                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| under a domain         | 9 permissions, on the account and the domain: an install's 10 without Workers R2 Storage: Edit     |
| without a domain       | 5 permissions, on the account: an install's 6 without Workers R2 Storage: Edit                     |
| `--add-user`, on both  | the same token. Of its permissions, Access: Apps and Policies: Edit is the one that lets a person in |

The link the command prints chooses every one of them. A token you kept from the install has one permission more, and works too. The optional permissions the command lists are not needed. `npx poplin doctor --repair --help` lists the permissions of an install's token and both of its links.

**Why `--add-user` wants that one.** Whoever may change the login page at Cloudflare could let a person in there by hand. So the command first writes the list of emails at Cloudflare, with your token. The email is stored in the install only after Cloudflare took that write. A token that may only read adds nobody.

## When it stops

| It says                                                             | Means                                                   | Do                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `No install is in this account.`                                    | the token is of an account with no install              | make the token in the account the install is in                 |
| `The install here has no domain: give --no-domain.`                 | you named a domain, and the install has none            | run it again, and press Enter at the first question             |
| `The install here is under the domain example.com: give --domain example.com.` | you named no domain, or another one          | run it again, and type that domain at the first question        |
| `An install was started in this account and not finished.`          | the install was never set, so there is no login to mend | finish it: `npx poplin install cloudflare`                      |
| `An install was started in this account`, a place, and `not finished` | the same, and it was started for another place than you named | finish it with the line it prints: `npx poplin install cloudflare`, with `--no-domain` or `--domain` and that domain |
| `Cloudflare refused the token at the install`                       | the token does not reach the install's account, or its domain | on the token's form, choose that account, and that domain |
| a row `stopped`, saying `Access is off for the account`             | Zero Trust, the part of Cloudflare that holds the login page, is not switched on | pick the Free plan at the address under the rows, then run again |
| a row `stopped`, ending `Add this one:` or `Add this permission to the account token:` and a name | the token lacks the permission of that name | [add it to the token](an-install-step-fails.md#add-a-permission-to-the-token), then run again |
| `The install's records are not at the schema of this poplin.`       | the install is of another version of poplin than the command you ran | run the newest: `npx poplin@latest doctor --repair`. The line names a second way: the command of the install's own version |
| `The install changed while it was read.`                            | something changed at Cloudflare during the run          | run it again                                                    |

A run that stopped changed only what its rows say. Run the same line again, and it goes on from what stands.

## From a script

A person gives the token at the question, where it is not shown. A script or a CI job cannot be asked, so it gives every answer as an option, and the token one of two ways:

| The token is given                      | Where it must come from                             |
| --------------------------------------- | --------------------------------------------------- |
| in the variable `POPLIN_INSTALL_TOKEN`  | the secret store of the CI, which sets the variable |
| on standard input, with `--token-stdin` | a program that writes the token and nothing else    |

```sh
npx poplin doctor --repair --domain example.com --add-user new@example.com --yes
npx poplin doctor --repair --no-domain --dry-run --json
```

Do not type an `export` line with the token into a terminal: the shell keeps the line, and the token in it, in its history. [Every answer as an option](../start/install.md#every-answer-as-an-option) has the variables.

| Exit code | Means                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| 0         | nothing is left undone; or a dry run that says a run would leave nothing undone |
| 1         | something is left undone; or a dry run that says a run would be stopped       |
| 2         | the line is written wrong, or an answer is missing in a run that asks nothing |
| 5         | Cloudflare gave no answer                                                     |
