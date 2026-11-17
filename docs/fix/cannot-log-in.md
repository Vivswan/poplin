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
| a command says `Not logged in`, or `The token is missing or expired`         | this machine's own login ran out. The dashboard still opens | `npx poplin login`: [The machine is not logged in](an-install-step-fails.md#the-machine-is-not-logged-in) |
| the browser asks for your email, and no code arrives                  | the email is no user of the install, or its mailbox is gone | [the steps](#the-steps), with `--add-user`. With a mailbox that still works, check the spelling and the spam folder first |
| the browser shows no login page: `The login is not set up yet.`, or an error | the login page in front of the dashboard is missing or broken | [the steps](#the-steps), without `--add-user`                  |
| the install said `Until then nobody can log in` when it was made      | Zero Trust was off, so the login page was never made    | switch Zero Trust on, as [step 1 of Install](../start/install.md#1-switch-on-what-no-command-can) has it. Then [the steps](#the-steps) |

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

   | It asks                                  | Answer                                                                   |
   | ---------------------------------------- | ------------------------------------------------------------------------ |
   | `Custom domain (Enter for workers.dev):` | the install's domain alone, with no `https://` and no `www`; or press Enter, for an install at `workers.dev` |
   | `Account token (hidden):`                | leave the terminal at this question, and make the token: the next step   |

   Between the two it prints the permissions the token needs, and the link to its form. Without a domain:

   ```text
   Custom domain (Enter for workers.dev):
   The account token needs 5 permissions on this account:
     Access: Apps and Policies: Edit
     Workers Scripts: Edit
     Access: Organizations, Identity Providers, and Groups: Read
     D1: Edit
     Account API Tokens: Edit
   See: npx poplin doctor --repair --help for 1 optional permission
   Create the account token here:
     https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...
   On the form, limit it to this account
   Account token (hidden):
   ```

   With `--domain example.com` or `--no-domain` on the line, the first question is not asked.

2. **Make the account token.** Open the link the command printed above its second question, and fill the form as the table of your kind shows: [under a domain](../start/install.md#3-make-the-account-token), or [without a domain](../start/without-a-domain.md#the-account-token). Skip the row that table adds by hand: a repair needs no Workers R2 Storage: Edit. The form names the token "poplin install". An older token of that name can stay.

3. **Paste the token at the question, and press Enter.** Its letters do not show. Nothing keeps it: not the command, and not your terminal's history.

4. **Read the rows.** This is a run with `--add-user` on an install under a domain, where the login page was missing. It is cut short where the dots are:

   ```text
   poplin 0.1.0 is installed at https://poplin.example.com
   unchanged  Worker                poplin, runs 0.1.0
   unchanged  DNS record            poplin.example.com
   ...
   created    Access application    poplin: poplin.example.com, *-p-poplin.example.com
   created    Access policy         poplin logins
   ...
   unchanged  Workflow              poplin-jobs
   created    User                  new@example.com
   The repair is complete
   Dashboard: https://poplin.example.com
   The account token was not stored. Delete it at Cloudflare.
   ```

   Without a domain, the address ends in `workers.dev`, and rows named `Forwarder` stand in place of `DNS record` and `Worker route`. Where the login page was fine, its rows say `unchanged`.

5. **Open the dashboard and log in.** Cloudflare's login page asks for your email, and sends a code to its inbox. After a run with `--add-user`, type the email you gave it.

## What the rows say

Every piece of the install has a row. Four matter here:

| Row                  | It is                                                         |
| -------------------- | ------------------------------------------------------------- |
| `Worker`             | the version the install runs, and which release is out where it is behind: a repair takes none. `updated` where the line had `--update`, and the repair [brought it to the newest release](../upkeep/update.md#a-release-the-install-cannot-take) |
| `Access application` | Cloudflare's login page in front of your dashboard            |
| `Access policy`      | the list of emails that page lets in: the users of the install |
| `User`               | the email `--add-user` named                                  |

| A row starts with    | Means                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| `unchanged`          | the piece was as it should be                                         |
| `created`, `updated` | the piece was missing or differed, and is mended                      |
| `skipped`            | an optional piece the token cannot reach: it stays as it is. Nothing is wrong. Saying `an earlier row stopped the run`: the piece was not reached |
| `blocked`            | it cannot be mended until you act: [When it stops](#when-it-stops)    |
| `failed`             | Cloudflare refused the piece                                          |

| The last lines say                                    | Means                                         | Do                                                           |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `The repair is complete`                              | what was missing is made, the new user too    | log in                                                       |
| `The install needs no repair`                         | nothing was broken, and no user was added     | if no code arrives, run the line with `--add-user`           |
| `The run is incomplete:`, a count of rows, and `Next: rerun this command`      | a row says `blocked` or `failed`             | [When it stops](#when-it-stops), then the same line again    |

The login is mended to the users the install has stored. No site and no setting of yours is changed.

A repair takes no newer release, whatever `auto_update` says: where one is out, the row `Worker` says so. To take it in the same run, add `--update`: [Update](../upkeep/update.md#a-release-the-install-cannot-take).

**To look first**, add `--dry-run`: it lists the same rows as `would create` and `unchanged`, and changes nothing. Its last line starts `A run would` and counts what a run would create or update, or says `The install needs no repair`. It starts `A run would be incomplete` where a run would be stopped.

## The row of the new user

| The row `User` says                                | Means                                                              | Do                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `created`                                          | the email is a user now                                            | log in with it                                       |
| `unchanged`, ending `already a user`               | the email was a user before, and nothing was stored                | log in with it                                       |
| `blocked`, with a permission's name                | the token may not change who logs in, so nobody was added          | [the token it needs](#the-token-it-needs)            |
| `blocked`, ending in an address with `/api/whoami` | the install has never answered a request, so it has stored no users yet | open that address in your browser once, then run the line again |

The address with `/api/whoami` asks for no login. Your browser shows a short refusal there, and that is enough.

It adds one email and takes none away. Once you are in, in this order:

| Do                                         | Where                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. remove the lost or mistyped email       | the dashboard, Access, Users: the menu at the end of that email's row, then Remove |
| 2. log your machines in again             | `npx poplin login`, with `--server` and your dashboard's address: removing an email ends every login that email allowed |
| 3. delete the account token, or keep it    | at Cloudflare, under My Profile, then API Tokens. Keep it where you keep passwords until step 1 is done |

The dashboard's Activity lists the new user as `Added a user:` and the email, by `doctor-repair@poplin.invalid`. No user of yours has that email: it marks a change made from a terminal.

## The token it needs

| The run                | Needs                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| under a domain         | 9 permissions, on the account and the domain: an install's 10 without Workers R2 Storage: Edit     |
| without a domain       | 5 permissions, on the account: an install's 6 without Workers R2 Storage: Edit                     |
| `--add-user`, on both  | the same token. Of its permissions, Access: Apps and Policies: Edit is the one that lets a person in |

The link the command prints chooses every one of them. A token you kept from the install has one permission more, and works too. The optional permissions are not needed. `npx poplin doctor --repair --help` lists the permissions of an install's token. The link is printed by the run, above its question for the token.

**Why `--add-user` wants that one.** Whoever may change the login page at Cloudflare could let a person in there by hand. So the command first writes the list of emails at Cloudflare, with your token. The email is stored in the install only after Cloudflare took that write. A token that may only read adds nobody.

## When it stops

| It says                                                             | Means                                                   | Do                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `This account has no install.`                                      | the token is of an account with no install              | make the token in the account the install is in                 |
| `This install has no domain. Pass --no-domain.`                     | you named a domain, and the install has none            | run it again, and press Enter at the first question             |
| `This install is under example.com. Pass --domain example.com.`     | you named no domain, or another one          | run it again, and type that domain at the first question        |
| `This account has an incomplete install.`                           | the install was never set, so there is no login to mend | finish it with the line it prints: `npx poplin install cloudflare`, with the `--domain` or `--no-domain` of your line |
| `This account has an incomplete install`, and a place               | the same, and it was started for another place than you named | finish it with the line it prints: `npx poplin install cloudflare`, with `--no-domain` or `--domain` and that domain |
| `Cloudflare refused the account token for this install`             | the token does not reach the install's account, or its domain | on the token's form, choose that account, and that domain |
| a row `blocked`, saying `Access is off for the account`             | Zero Trust, the part of Cloudflare that holds the login page, is not switched on | pick the Free plan at the address under the rows, then run again |
| a row `blocked`, ending `lacks this permission:` or `Add this permission to the account token:` and a name | the token lacks the permission of that name | [add it to the token](an-install-step-fails.md#add-a-permission-to-the-token), then run again |
| `The install's database schema does not match this CLI.`            | the install is of another version of poplin than the command you ran | run the line it ends with: the newest poplin's repair, `npx poplin@latest doctor --repair`, with the `--domain` or `--no-domain` of the install. The line names a second way: the command of the install's own version |
| `The install runs`, a version, `and its database schema does not match this CLI` | the install is behind, and the command you ran is of a newer poplin than its records: a repair alone cannot read them | to mend only, run the first line it names: the poplin of the install's version, as `npx poplin@0.2.0 doctor --repair`. To take the newest release too, run the line it ends with: `npx poplin doctor --repair --update`. Both hold the `--domain` or `--no-domain` of the install, and the `--add-user` of your line where the terminal can hold its email |
| `The install runs`, a version, `newer than the latest release this CLI knows`, and an older one | the install is of a newer poplin than the command you ran; nothing is put back | run the line it ends with: `npx poplin@latest doctor --repair`, with the `--domain` or `--no-domain` of the install |
| `This CLI cannot deploy the latest release.` | you gave `--update`, and the install is behind a release that needs a newer poplin than the command you ran | run the line it ends with: `npx poplin@latest doctor --repair --update`, with the `--domain` or `--no-domain` of the install |
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
