---
title: Without a domain
order: 25
---

# Install poplin without a domain

What differs when an install has no domain: its addresses, its account token, and what the command prints. The steps are those of [Install](install.md), with `--no-domain`. [Your agent can run them with you](with-an-agent.md) too.

```text
you have:  a Cloudflare account

you run:   npx poplin install cloudflare --no-domain

you get:   https://poplin.your-name.workers.dev                               your dashboard
           https://poplin-sites.your-name.workers.dev/report--k3f9x2ab71qz/   an unlisted or public site
           https://poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/ a private site
```

`your-name` stands for the word of your own account in the address Cloudflare gives its Workers.

**A page of one site can read your other sites of its kind: publish only pages you trust.** An open site, unlisted or public, can read the other open sites. A private site can read the other private sites. Each kind answers at one address of its own, as the block above shows. [Between sites](../about/between-sites.md#without-a-domain) says what a page of one site can do to another.

## What differs from an install under a domain

| Thing                         | Under a domain                           | Without a domain                                              |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| a site's address              | a hostname of its own                    | a path on one of two hostnames                                |
| a link inside a site          | any link works                           | a link that starts with `/` leaves the site. [Publish](../sites/publish.md) refuses one in a page's `href`, `src`, or `srcset`: write `css/site.css`, not `/css/site.css` |
| two sites in one browser      | kept apart                               | the open sites trust each other, and so do the private sites  |
| a public name                 | `docs-page.example.com`                  | `poplin-sites.your-name.workers.dev/docs/`                    |
| junk traffic                  | stopped by Cloudflare's rules first      | no rule runs first: the Worker's own limits per visitor and per site count every request |
| the `block_bots` setting      | blocks AI crawlers on the domain         | does nothing: it needs a domain                               |
| the account token             | ten permissions, account and domain      | six permissions, account alone                                |
| what you need                 | a domain that is Active on the account   | nothing more: the command makes the account's `workers.dev` subdomain where it has none |

## The steps

The five steps of [Install](install.md), each with what differs here:

| Step of Install                  | Here                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| 1. Switch on what no command can | both rows of its table                                                |
| 2. Run the command               | press Enter at the first question, or add `--no-domain`. On a new account, [the name you give its subdomain](#the-command) is in every address |
| 3. Make the account token        | [the other link, and six permissions](#the-account-token)            |
| 4. Read what it made             | [forwarders in place of records and routes](#what-it-prints)         |
| 5. Log this machine in          | the same question and the same page, at [your own address](#log-in)  |

## What you need

The table of [Install](install.md#what-you-need), without the row of the domain. The account's subdomain is the `your-name` of every address above. An account that has one keeps it, and the install is refused where it has more than 36 characters: [When the install stops](../fix/an-install-step-fails.md#before-any-change) has that line.

## The command

At the first question, press Enter:

```text
Custom domain (Enter for workers.dev):
```

Or give the answer as an option, and the question is not asked:

```sh
npx poplin install cloudflare --no-domain
```

**On an account that has no subdomain yet**, as a new account has none, the command asks for its name after the token, and makes it first:

```text
workers.dev subdomain (this account has none; every address of the install is under it):
```

Type the word you want as `your-name`, by [the rule of Install](install.md#2-run-the-command). `--subdomain your-name` answers it on the line.

## The account token

```text
Account token
Cloudflare's token form opens with 6 of 6 permissions chosen.
Open the form in your browser? Yes
The form's address
https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...
On the form
1. Account Resources: Include > your account
2. Continue to summary. It should read:
   Entire <your account> account
     Access: Apps and Policies: Edit
     Workers Scripts: Edit
     Access: Organizations, Identity Providers, and Groups: Edit
     D1: Edit
     Workers R2 Storage: Edit
     API Tokens: Edit
3. Create Token > copy the token

--all-permissions adds alerts
Account token (hidden):
```

The form opens with six rows filled: the six permissions the install needs, and none of a domain. Open it in the browser the command started, or by the address it printed. It is this one:

[Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_api_tokens%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&name=poplin%20install)

| On the form       | Do                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------ |
| the six rows      | leave them                                                                           |
| Account Resources | choose Include, then your account                                                    |
| every other field | leave it as it is                                                                    |
| the bottom        | press Continue to summary                                                            |
| the summary       | hold it beside the command's list: the same six permissions, under your account      |
| the bottom        | press Create Token                                                                   |
| the next page     | the token is shown once: copy it, and leave the page open                            |

Then paste the token at the command's question, `Account token (hidden):`.

```text
Mac:      click the terminal, press Command and V, then Enter
Windows:  click the Command Prompt window, press Ctrl and V, or click the right mouse button; then Enter
Linux:    click the terminal, press Ctrl, Shift and V, then Enter
```

The terminal shows a row of small marks for what you paste, never the letters. Press Enter once.

**Leave Cloudflare's page with the token open** until the command says `is installed`: Cloudflare shows the token once, and a run that stops asks for it again. If the page is gone, choose Roll in the token's menu, under My Profile, then API Tokens: it shows a new text.

One permission is optional here: Notifications: Edit. **Skip it on a first install:** nothing is wrong without it. The other optional permissions are all of a domain.

With it, the run makes [an email when charges reach 1 dollar](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) at once. Without it, the install makes that email by itself within a day, with the key it keeps.

To take it at once, add `--all-permissions` to the install's line: the command lists it as one more step, `Add more`.

## What it prints

```text
This account has no install
created    Account subdomain     your-name.workers.dev
created    R2 bucket             poplin-sites
created    D1 database           poplin
created    Worker                poplin, runs 0.1.0
updated    workers.dev route     enabled: poplin.your-name.workers.dev
created    Forwarder             poplin-private: https://poplin-private.your-name.workers.dev (private sites)
created    Forwarder             poplin-sites: https://poplin-sites.your-name.workers.dev (unlisted and public sites)
unchanged  Login method          Cloudflare
created    Login method          One-time PIN
created    Login method          Passkeys
created    Access application    poplin: poplin.your-name.workers.dev, poplin-private.your-name.workers.dev
created    Key                   poplin kept key
Waiting for https://poplin.your-name.workers.dev to respond
poplin 0.1.0 is installed
Dashboard: https://poplin.your-name.workers.dev
The account token was not stored
Log this machine in now?
```

The sample shows a few of the rows, on a new account: one that had its subdomain says `unchanged` in the first. Two pieces are of this kind alone:

| Piece          | It is                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| workers.dev route | the address Cloudflare gives the Worker, enabled: your dashboard answers there       |
| Forwarder      | a small Worker that gives the sites of one kind their hostname and hands every request on |

The Access application is Cloudflare's login in front of the dashboard and of every private site. The three login methods are how a user passes it: [the Cloudflare account, a code Cloudflare mails, and a passkey](install.md#4-read-what-it-made).

## Log in

The command's last question logs this machine in, as [step 5 of Install](install.md#5-log-this-machine-in-and-check) shows: the pages in your browser are the same. After a no, or on another machine, the URL after `--server` is the dashboard's, as the command printed it:

```sh
npx poplin login --server https://poplin.your-name.workers.dev
npx poplin doctor
```

## A domain, afterwards

No command puts this install under a domain. The way is to [move it](../upkeep/back-up.md#move-an-install): back up, install anew under the domain, and bring the data back. Both lines need their options:

| Line                                                | Without its option                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `npx poplin export --all-versions --out backup.zip` | the zip holds each site's live version alone: the kept versions before it are lost with this install |
| `npx poplin import backup.zip --settings`           | the sites come back, and the new install keeps its own settings       |

| Thing                 | After the move                                                     |
| --------------------- | ------------------------------------------------------------------ |
| a site's address      | new: a hostname of its own under your domain                       |
| a link you shared     | stops with this install. Send the new one                          |
| each machine's login | made anew, with `npx poplin login`: the zip holds no token         |
| the users             | the first login of the new install. `--settings --users` brings the old list |
| the activity log      | starts anew: the zip does not hold it                              |

## Afterwards

The commands that mend and remove an install take `--no-domain` too:

| To                                 | Run                                           | Page                                       |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------ |
| get back in when nobody can log in | `npx poplin doctor --repair --no-domain`, with `--add-user` for a lost mailbox | [I cannot log in](../fix/cannot-log-in.md) |
| take the install down              | `npx poplin uninstall cloudflare --no-domain` | [Remove](../upkeep/remove.md)              |
