---
title: Remove
order: 30
---

# Remove an install

Run `npx poplin uninstall cloudflare --domain example.com` (or `--no-domain`). It lists what it would remove, asks you to type the install's host, and removes it; `--dry-run` only lists, and `--keep-data` leaves the sites' files and the database. The steps [by hand](#by-hand-at-cloudflare) are the same removal.

```text
1  save a copy of your sites    npx poplin export --all-versions --out backup.zip
2  on each machine             npx poplin logout
3  look first                   npx poplin uninstall cloudflare --no-domain --dry-run
4  remove                       npx poplin uninstall cloudflare --no-domain
```

```text
lost for good:   every site's files and every kept version, the settings, the users, the activity log
stops working:   every address of the install, each link you shared included
stays:           your Cloudflare account, your domain, every record and rule poplin did not make, and every route to another Worker
```

The block shows an install without a domain. Under a domain, `--domain example.com` stands in place of `--no-domain`, in every line of this page. `example.com` stands for your own domain, and `your-name` for your account's subdomain at `workers.dev`.

## What you need

| Thing                              | For                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| a terminal, and Node.js 24         | every line here: the start of [step 2 of Install](../start/install.md#2-run-the-command), up to `node --version` |
| this machine logged in to poplin  | step 1 alone, with a login approved with Can change: Admin. `npx poplin whoami` says whether it is; [step 5 of Install](../start/install.md#5-log-this-machine-in-and-check) logs it in |
| the Cloudflare account             | the one the install is in. You must be able to log in at `https://dash.cloudflare.com`                |
| an account token                   | steps 3 and 4, which each ask for it: a removal takes the token an install takes. If yours is gone, the command shows the way to the form that makes a new one |

## 1. Save a copy

```sh
npx poplin export --all-versions --out backup.zip
```

It downloads every site and the settings as one zip, into the folder the terminal is in. [Back up](back-up.md) says what the zip holds and how an import puts it back.

## 2. Log each machine out

The command logs no machine out. Do this before the removal, while the install still answers, on each machine that was logged in:

```sh
npx poplin logout
```

It prints `Logged out of` and the install's URL. On the machine of step 1, run it after the export.

**On a machine you reach only after the removal**, the same line says `Cannot reach the install`, and its hint says `The stored login is deleted`. The removal's own last lines say the same. That is enough where the database went too: the tokens were in it. A database kept with `--keep-data` still holds them, so log out before such a removal.

| Piece                                 | It is there                                           | Remove it                                                                   |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| the stored login                       | on each machine you logged in                        | `npx poplin logout`                                                         |
| a login in two variables              | only if you set `POPLIN_SERVER` and `POPLIN_TOKEN` yourself, as a build server does | delete the two lines where you set them, before the logout, and open a new terminal |
| an agent's own login                  | only if you set `POPLIN_CONFIG_DIR` for the agent yourself | `npx poplin logout` with that variable set; then delete the folder it names |
| poplin's tools in your agent          | the MCP server named `poplin`, where a setup added it | ask the agent: `Remove the poplin MCP server from your configuration.` Then restart it |
| poplin's skills in your agent         | only if you ran `npx skills add Vivswan/poplin`       | `npx skills remove`, with `-g` where you installed them for you: it asks which |
| poplin's plugin in Claude Code        | only if you ran `claude plugin install poplin@poplin` | `claude plugin uninstall poplin@poplin`                                     |
| poplin installed with npm             | only if you ran `npm install -g poplin`               | `npm uninstall -g poplin`                                                   |

While the two variables are set, `poplin logout` works on that login and leaves the stored one on the machine. So their lines go first. `poplin logout --dry-run` says which login a logout would end, and ends none.

`npx` keeps the copy it downloaded in npm's own cache. With the rows above done, it runs only when you type the command, and there is nothing to do about it.

## 3. Look first

```sh
npx poplin uninstall cloudflare --no-domain --dry-run
```

It asks whether to open the token's form, lists the steps on it, then asks for the token without showing what you paste. The form is filled as [without a domain](../start/without-a-domain.md#the-account-token) or [under a domain](../start/install.md#3-make-the-account-token) shows.

**Step 4 asks for the token again.** Cloudflare shows a new token once: leave its page open until step 4 is done. If the page is gone, choose Roll in the token's menu, under My Profile, then API Tokens: it shows a new text.

Then it lists, and removes nothing. With `--keep-data` on the line too, it lists the data as `unchanged`. Without a domain, for an install that has the budget alert:

```text
poplin 0.1.0 is installed at https://poplin.your-name.workers.dev
would remove  Forwarder             poplin-sites, poplin-private
would remove  Access application    poplin open paths, poplin
would remove  Access policy         poplin open paths policy, poplin logins
would remove  Budget alert          poplin: usage charges reached 1 dollar
would remove  Key                   poplin kept key
would remove  Upload key            poplin upload key
would remove  Workflow              poplin-jobs
would remove  Worker                poplin
would remove  R2 bucket             poplin-sites (files: 2, 15 B)
would remove  D1 database           poplin (sites: 3)
unchanged     Login method          Cloudflare, One-time PIN, and Passkeys are login methods of the account, which its other applications may use, and are left in place
unchanged     Account subdomain     left in place where the account has one: it is the account's own, and its other Workers may answer under it
unchanged     Account token         delete it at Cloudflare: https://dash.cloudflare.com/profile/api-tokens
A real run prompts for poplin.your-name.workers.dev, or accepts --confirm poplin.your-name.workers.dev
Uninstall does not log machines out. Run npx poplin logout on each machine first.
A run would remove 10 resource types
```

Each row is one kind of piece, with the names of its pieces. A kind the command looked for and found no piece of has no row: an install with no budget alert has one kind less.

Under a domain, five rows stand in place of `Forwarder`: `Worker route`, `DNS record`, `Redirect rule`, `WAF rule`, and `Rate rule`. Each kind of rule has a second row for its rule set, such as `Redirect ruleset`.

A `Certificate alert` row follows `Budget alert`, for an install that has that alert. A `Bot settings` row says what stays there. A run under a domain removes 18 resource types at most.

The `Login method` row is of both kinds. The three login methods are your Cloudflare account's own, and another application of the account may use them, so an uninstall leaves them. To remove them, open Zero Trust at Cloudflare.

A rule set is Cloudflare's holder for rules of one kind. One that poplin made goes once no rule but poplin's is in it. One of the domain's own, which poplin only added a rule to, stays and has no row.

| A row starts with            | Means                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `would remove`, `removed`    | pieces that carry poplin's name, or the comment or tag poplin put on them |
| `unchanged`                  | not removed by the command: the row says why, or where it is. With `--keep-data`, the R2 bucket and the D1 database |
| `not found`                  | it went between the list and the removal                               |
| `would skip`, `skipped`      | a thing of poplin's name that is not this install's, a kind the token lacks the permission to look for, or a piece that waits for an earlier one: it stays |
| `blocked`                    | the token lacks the permission the row names, or Cloudflare asked to wait for more than 5 minutes |
| `failed`                     | Cloudflare refused that removal                                        |

`poplin-sites` names two things without a domain: a forwarder, which is a small Worker, and the bucket with the sites' files.

## 4. Remove

| Your install is   | The line                                               | You type, when asked           |
| ----------------- | ------------------------------------------------------ | ------------------------------ |
| under your domain | `npx poplin uninstall cloudflare --domain example.com` | `poplin.example.com`           |
| without a domain  | `npx poplin uninstall cloudflare --no-domain`          | `poplin.your-name.workers.dev` |

What you type is your dashboard's host, without the `https://`. The command prints it in its question. With neither option on the line, it first asks `Custom domain (Enter for workers.dev):`.

It asks for the token again, as step 3 said, lists the same rows, and then asks. The sample is of an install under a domain that has every optional piece, removed with a token that holds the optional permissions. It is cut short where the dots are:

```text
$ npx poplin uninstall cloudflare --domain example.com
...
Account token (hidden):
poplin 0.1.0 is installed at https://poplin.example.com
would remove  Worker route          *-poplin.example.com/*, *-page.example.com/*, poplin.example.com/*
would remove  DNS record            *.example.com, poplin.example.com
...
would remove  R2 bucket             poplin-sites (files: 2, 15 B)
would remove  D1 database           poplin (sites: 3)
unchanged     Bot settings          AI crawler blocking and Bot Fight Mode are zone settings and keep their values
...
unchanged     Account token         delete it at Cloudflare: https://dash.cloudflare.com/profile/api-tokens
An uninstall cannot be undone
Uninstall does not log machines out. Run npx poplin logout on each machine first.
Type poplin.example.com to confirm: poplin.example.com
removed    Worker route          *-poplin.example.com/*, *-page.example.com/*, poplin.example.com/*
...
removed    D1 database           poplin (sites: 3)
The install is removed: 18 resource types removed, 4 unchanged
Next: npx poplin logout on each machine with a stored login, to delete it
```

Nothing is removed before you type the host. Another text than the install's own removes nothing.

## What stays, and what to do

The line that ends the rows counts the ones that say `removed` or `not found`, then the ones that say `skipped` and `unchanged`. Where the token lacks an optional permission, the line under it names the permission and each kind the run skipped:

```text
The install is removed: 16 resource types removed, 2 skipped, 4 unchanged
Fix: add Notifications: Edit and rerun this command, or delete Budget alert and Certificate alert at Cloudflare
```

The form the command opens makes a token without the optional permissions. With `--all-permissions` on the line, the command lists each one a removal uses as one more step on the form.

Under a domain a removal uses three: Single Redirect: Edit, Zone WAF: Edit, and Notifications: Edit. Without a domain it uses the last alone.

[Domain](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) has the boxes of the first two on the form, and [its part on the email](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) those of the third. Bot Management: Edit, which the first of the two also lists, is none of a removal's.

Read the rows that say `unchanged`:

| Stays                                   | When                                                         | Do                                                                    |
| --------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| the account token                       | always                                                       | delete the token you used for this install at Cloudflare, under My Profile, then API Tokens. [Tell it by its account and domain](#which-token-to-delete) |
| the budget alert, and under a domain the certificate alert and the redirect, guard, and rate rules | when the token lacks the optional permission the row names. The command then cannot see whether the install has them | look for them [by hand](#by-hand-at-cloudflare), and delete what is there; or add the permission, and run the command again |
| a rule set of poplin's name             | under a domain, when it holds a rule that is not poplin's: its row says so | nothing: the rule in it is yours. [The list by hand](#by-hand-at-cloudflare) names the three |
| the two bot switches                    | under a domain                                               | [switch off what you do not want](#by-hand-at-cloudflare)             |
| the account's `workers.dev` subdomain   | always, also where the install made it                       | nothing: it is your account's own, and its other Workers may answer under it |
| what you switched on in [step 1 of Install](../start/install.md#1-switch-on-what-no-command-can) | always: the Zero Trust team with its Free plan, R2, and the payment method | nothing: they are not poplin's. They are yours, to keep or to cancel at Cloudflare |

### Which token to delete

| In the list, a token named "poplin install" | Do |
| --- | --- |
| its resources name the account of the removed install, and under a domain that domain | delete it, and every other token this row fits |
| its resources name another account or another domain | leave it: it is of another install |

Every token made from poplin's link is named "poplin install", so the name alone does not say which install a token is of. An install, a repair, and a removal may each have made one: all of them are this install's, and all can go. A token of another account's install, such as the one a CI job holds, has the same name.

Cloudflare shows with each token the resources it reaches: its accounts and its domains. A token you named otherwise is told the same way.

## Keep the data

```sh
npx poplin uninstall cloudflare --no-domain --keep-data
```

This is for an install of the same kind, made again in the same account over the data as it stands. It is not the way to move an install to a domain, off one, or to another account: [Move an install](back-up.md#move-an-install) has that.

The list before the question says `unchanged` for both, and so do their rows after it. The two keys go with the rest.

A run that left a kind undone ends `Next: rerun this command with --keep-data`, and `next` of its `--json` value names the command with `--keep-data`: a line without it removes the data too.

| Then                                   | Do                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| take the data up in a new install of the same kind | `npx poplin install cloudflare`: it finds the data, and asks `Reuse these resources and their data?` |
| remove the data too                    | the same `uninstall` line without `--keep-data`: it asks you to type `poplin-sites` |

The new install takes its users and its settings from the kept database:

| The kept database holds | Who the login lets in             | `--user`                                                                           |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| users                   | those users, and nobody else      | not used. For an email that is none of them, the row `skipped  First user` says so |
| no users yet            | the email you give for `--user`   | used                                                                               |
| records this poplin cannot read | the email you give for `--user` | used, and the row of the database says that its users were not read          |

To let one more person in afterwards: `npx poplin doctor --repair --no-domain --add-user you@example.com`, with their email. Under a domain the line holds `--domain` and your domain in place of `--no-domain`. Where the email of `--user` is none of the kept users, the run ends with that line, after `Add you@example.com as a user:`, and offers no login of this machine.

A dry run with `--keep-data` lists the same. The kept bucket and database stay in your account as they are: [What can cost money](cost/what-can-cost-money.md) says what stored files count toward.

## When it stops

| It says                                                  | Means                                                | Do                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `This account has no install. Nothing changed.`          | the token is of an account with no install           | make the token in the account the install is in                               |
| `Only the data remains, and --keep-data keeps it.`       | the install is removed, and only its kept data is left | to remove the data too, run the line without `--keep-data`                  |
| `The install in this account is at`, and a URL           | the line named another place than the install's: `--no-domain` for an install under a domain, the other way round, or another domain | run it again with the install's own domain after `--domain`, or with `--no-domain` |
| `This account has an incomplete install`, and a place    | an install that was never finished was started for another place than the line named | run it again with the option the line names: `--domain` and that domain, or `--no-domain` |
| `The confirmation does not match`, and the text          | the text you typed is not the install's own          | run it again, and type the text the line names                                |
| `The run is incomplete:`, a count of rows, and `Next: rerun this command` | a row says `blocked`, `failed`, or `skipped` | fix what the row names, then run the same line again: it removes what is left |
| a row `blocked`, saying `The account token lacks` and a name | the token lacks the permission of that name         | [add it to the token](../fix/an-install-step-fails.md#add-a-permission-to-the-token) |
| `Cloudflare asked to wait. Retrying in`, and seconds     | Cloudflare limits how many calls an account sends, and a bucket of many files reaches the limit | nothing: the command waits and goes on. Ctrl-C cancels it |
| a row `blocked`, saying `Cloudflare asked to wait for more than 5 minutes` | the limit did not lift while the command waited | run the same line again: it removes what is left |
| `The account changed after it was checked.`              | something changed at Cloudflare during the run       | run it again                                                                  |
| `--dry-run and --confirm are mutually exclusive`             | the two options were on one line                     | take one of them off                                                          |

## From a script

A person gives the token at the question, where it is not shown. A script or a CI job cannot be asked: it gives the text with `--confirm`, and adds `--yes`. `--yes` alone removes nothing.

| The token is given                      | Where it must come from                             |
| --------------------------------------- | --------------------------------------------------- |
| in the variable `POPLIN_INSTALL_TOKEN`  | the secret store of the CI, which sets the variable |
| on standard input, with `--token-stdin` | a program that writes the token and nothing else    |

Do not type an `export` line with the token into a terminal: the shell keeps the line, and the token in it, in its history.

```sh
npx poplin uninstall cloudflare --no-domain --confirm poplin.your-name.workers.dev --yes --json
```

| Exit code | Means                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| 0         | removed; or a dry run that is ready                                           |
| 1         | nothing was removed, or not all of it                                         |
| 2         | the line is written wrong, or an answer is missing in a run that asks nothing |
| 5         | Cloudflare gave no answer                                                     |

## By hand, at Cloudflare

The same removal without the command. Each piece carries the name poplin gave it: find that name in the place the table says, and delete it there. The command removes every row but the last.

Go from the top row down: what points at the Worker goes first, then the Worker, then what it kept. The first five rows are in your domain, the last in your own profile, and the rest in your account.

| Piece                                 | Its name                                                                                              | Where                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Worker routes                         | every route that names the Worker `poplin`: `poplin.example.com/*`, `*-poplin.example.com/*`, `*-page.example.com/*` | the domain's Workers Routes                         |
| DNS records                           | `poplin` and `*`, each with a comment that starts `poplin: `                                           | the domain's DNS records                            |
| Redirect rule, if it is there         | `poplin: send http to https`                                                                          | the domain's redirect rules                         |
| Guard rules, if they are there        | `poplin: stop pages of other domains`, `poplin: stop verified bots, other methods, and scanner paths` | the domain's custom rules, under its security rules |
| Rate rule, if it is there             | `poplin: 300 requests per 10 seconds per address`                                                     | the domain's rate limiting rules                    |
| the login applications                | `poplin` and "poplin open paths"                                                                      | Zero Trust, under Access, the applications          |
| the login's policies                  | "poplin logins" and "poplin open paths policy"                                                        | Zero Trust, under Access, the policies              |
| the Workflow                          | `poplin-jobs`                                                                                         | Workflows, under Workers & Pages                    |
| the Worker                            | `poplin`                                                                                              | Workers & Pages                                     |
| the database                          | `poplin`                                                                                              | the account's D1 databases                          |
| the bucket                            | `poplin-sites`                                                                                        | the account's R2 buckets                            |
| the budget alert, if it is there      | `poplin: usage charges reached 1 dollar`                                                              | the account's Notifications                         |
| the certificate alert, if it is there | `poplin: certificates of every domain of the account`                                                 | the account's Notifications                         |
| the two keys                          | "poplin kept key" and "poplin upload key"                                                             | Manage Account, then Account API Tokens             |
| the account token of the install      | "poplin install", unless you named it otherwise: [the one of this account and domain alone](#which-token-to-delete) | My Profile, then API Tokens                         |

- **The three rules** are there when the token of the install or of a Repair held an [optional permission](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers). The guard rules can also be there once `search_engines_allowed` or `outside_pages` was saved on an install that holds its key.
- **A rule set** is poplin's where the domain had none before: "poplin redirect rule", "poplin guard rules", "poplin rate rule". Delete it once it is empty, after its rules. One of another name is the domain's own: leave it.
- **The wildcard record** `*` is there only when the domain had none of its own. A `*` record with no `poplin: ` comment is yours: leave it.
- **The second application** lets `/api` pass the login. It has a policy of its own.
- **A policy** goes after the application that uses it.
- **The Workflow** stays when the Worker is deleted, so it is a row of its own. It runs the copy of a large site, and holds no site's files.
- **The Worker** takes its values, its 15-minute timer, and its `workers.dev` address with it.
- **Without a domain** the first five rows do not exist. Two more Workers do, `poplin-sites` and `poplin-private`: delete them under Workers & Pages, before the Worker `poplin`.
- **The bucket** holds every site's files. If Cloudflare asks for an empty bucket, empty it there, then delete it.
- **The budget alert** is there where the install's key or a Repair made it, on an install of either kind: [Domain](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) says when. **The certificate alert** is made the same way, under a domain alone.
- **The two keys** are there from the install, on an install of either kind. They are tokens the account owns, and they stay when the Worker is deleted. A key that ran out is still in the list.

**Two bot switches** belong to the whole domain and carry no name. The install and Repair can switch them on, with a token that held Bot Management: Edit. Nothing of poplin switches one off: look at the domain's bot settings, and switch off what you do not want.

| Switch               | It was switched on when the setting `block_bots` was                    |
| -------------------- | ----------------------------------------------------------------------- |
| the AI crawler block | `on`, or `auto` on a domain with no other hostnames                     |
| Bot Fight Mode       | `on`, on a Free plan domain                                             |
