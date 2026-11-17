---
title: Remove
order: 30
---

# Remove an install

Run `npx poplin uninstall cloudflare --domain example.com` (or `--no-domain`). It lists what it would remove, asks you to type the install's address, and removes it; `--dry-run` only lists, and `--keep-data` leaves the sites' files and the database. The steps [by hand](#by-hand-at-cloudflare) are the same removal.

```text
1  save a copy of your sites    npx poplin export --all-versions --out backup.zip
2  on each computer             npx poplin logout
3  look first                   npx poplin uninstall cloudflare --no-domain --dry-run
4  remove                       npx poplin uninstall cloudflare --no-domain
```

```text
lost for good:   every site's files and every kept version, the settings, the logins, the activity log
stops working:   every address of the install, each link you shared included
stays:           your Cloudflare account, your domain, every record and rule poplin did not make, and every route to another Worker
```

The block shows an install without a domain. Under a domain, `--domain example.com` stands in place of `--no-domain`, in every line of this page. `example.com` stands for your own domain, and `your-name` for your account's subdomain at `workers.dev`.

## What you need

| Thing                              | For                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| a terminal, and Node.js 24         | every line here: the start of [step 2 of Install](../start/install.md#2-run-the-command), up to `node --version` |
| this computer logged in to poplin  | step 1 alone, with a login allowed with Can change: Everything. `npx poplin whoami` says whether it is; [step 5 of Install](../start/install.md#5-log-this-computer-in-and-check) logs it in |
| the Cloudflare account             | the one the install is in. You must be able to log in at `https://dash.cloudflare.com`                |
| an account token                   | steps 3 and 4, which each ask for it: a removal takes the token an install takes. If yours is gone, the command prints the link that makes a new one |

## 1. Save a copy

```sh
npx poplin export --all-versions --out backup.zip
```

It downloads every site and the settings as one zip, into the folder the terminal is in. [Back up](back-up.md) says what the zip holds and how an import puts it back.

## 2. Log each computer out

The command logs no computer out. Do this before the removal, while the install still answers, on each computer that was logged in:

```sh
npx poplin logout
```

It prints `logged out of` and the install's address. On the computer of step 1, run it after the export.

**On a computer you reach only after the removal**, the same line says `the install could not be reached`, and its hint says `the saved login was removed from this machine`. The removal's own last lines say the same. That is enough where the database went too: the tokens were in it. A database kept with `--keep-data` still holds them, so log out before such a removal.

| Piece                                 | It is there                                           | Remove it                                                                   |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| the saved login                       | on each computer you logged in                        | `npx poplin logout`                                                         |
| a login in two variables              | only if you set `POPLIN_SERVER` and `POPLIN_TOKEN` yourself, as a build server does | delete the two lines where you set them, before the logout, and open a new terminal |
| an agent's own login                  | only if you set `POPLIN_CONFIG_DIR` for the agent yourself | `npx poplin logout` with that variable set; then delete the folder it names |
| poplin's tools in your agent          | the MCP server named `poplin`                         | ask the agent: `Remove the poplin MCP server from your configuration.` Then restart it |
| poplin installed with npm             | only if you ran `npm install -g poplin`               | `npm uninstall -g poplin`                                                   |

While the two variables are set, `poplin logout` works on that login and leaves the saved one on the computer. So their lines go first. `poplin logout --dry-run` says which login a logout would end, and ends none.

`npx` keeps the copy it downloaded in npm's own cache. It runs only when you type the command, and there is nothing to do about it.

## 3. Look first

```sh
npx poplin uninstall cloudflare --no-domain --dry-run
```

It prints how many permissions the token needs and a link, then asks for the token without showing what you paste. The form is filled as [without a domain](../start/without-a-domain.md#the-account-token) or [under a domain](../start/install.md#3-make-the-account-token) shows.

**Step 4 asks for the token again.** Cloudflare shows a new token once: leave its page open until step 4 is done. If the page is gone, choose Roll in the token's menu, under My Profile, then API Tokens: it shows a new text.

Then it lists, and removes nothing. With `--keep-data` on the line too, it lists the data as `would keep`. Without a domain, for an install that has the budget alert:

```text
looking for an install ... found: poplin 0.1.0, at https://poplin.your-name.workers.dev
would remove  Forwarder             poplin-sites, poplin-private
would remove  Access application    poplin open paths, poplin
would remove  Access policy         poplin open paths policy, poplin logins
would remove  Budget alert          poplin: usage charges reached 1 dollar
would remove  Key                   poplin kept key
would remove  Upload key            poplin upload key
would remove  Workflow              poplin-jobs
would remove  Worker                poplin
would remove  Sites' files          poplin-sites (files: 2, 15 B)
would remove  Database              poplin (sites: 3)
stays         Account token         delete it at Cloudflare: https://dash.cloudflare.com/profile/api-tokens
A run asks you to type this, or takes it with --confirm: poplin.your-name.workers.dev
The sites' files and the database go last: --keep-data leaves them.
A removal logs no computer out: run npx poplin logout on each one first.
ready: a run would remove 10 kinds. Nothing was removed.
```

Each row is one kind of piece, with the names of its pieces. A kind the command looked for and found no piece of has no row: an install with no budget alert has one kind less.

Under a domain, five rows stand in place of `Forwarder`: `Worker route`, `DNS record`, `Redirect rule`, `WAF rule`, and `Rate rule`. Each kind of rule has a second row for its rule set, such as `Redirect ruleset`.

A `Certificate alert` row follows `Budget alert`, for an install that has that alert. A `Bot settings` row says what stays there. A run under a domain removes 18 kinds at most.

A rule set is Cloudflare's holder for rules of one kind. One that poplin made goes once no rule but poplin's is in it. One of the domain's own, which poplin only added a rule to, stays and has no row.

| A row starts with            | Means                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `would remove`, `removed`    | pieces that carry poplin's name, or the comment or tag poplin put on them |
| `stays`                      | not removed by the command: the row says why, or where it is           |
| `would keep`, `kept`         | the sites' files and the database, with `--keep-data`                  |
| `already gone`               | it went between the list and the removal                               |
| `would skip`, `skipped`      | a thing of poplin's name that is not this install's: it stays          |
| `blocked`, `stopped`         | the token lacks the permission the row names                           |
| `failed`, `not run`          | Cloudflare refused that removal, or an earlier piece still stands      |

`poplin-sites` names two things without a domain: a forwarder, which is a small Worker, and the bucket with the sites' files.

## 4. Remove

| Your install is   | The line                                               | You type, when asked           |
| ----------------- | ------------------------------------------------------ | ------------------------------ |
| under your domain | `npx poplin uninstall cloudflare --domain example.com` | `poplin.example.com`           |
| without a domain  | `npx poplin uninstall cloudflare --no-domain`          | `poplin.your-name.workers.dev` |

What you type is your dashboard's address, without the `https://`. The command prints it in its question. With neither option on the line, it first asks `Your own domain (example.com), or Enter for none:`.

It asks for the token again, as step 3 said, lists the same rows, and then asks. The sample is of an install under a domain that has every optional piece, removed with a token that holds the optional permissions. It is cut short where the dots are:

```text
$ npx poplin uninstall cloudflare --domain example.com
...
Account token (not shown):
looking for an install ... found: poplin 0.1.0, at https://poplin.example.com
would remove  Worker route          *-poplin.example.com/*, *-page.example.com/*, poplin.example.com/*
would remove  DNS record            *.example.com, poplin.example.com
...
would remove  Sites' files          poplin-sites (files: 2, 15 B)
would remove  Database              poplin (sites: 3)
stays         Bot settings          the domain's AI crawler block and Bot Fight Mode are settings of the domain, and stay as they are set
stays         Account token         delete it at Cloudflare: https://dash.cloudflare.com/profile/api-tokens
This removes every row above that says would remove. It cannot be undone.
It logs no computer out. Run npx poplin logout on each one first: after the removal a logout cannot reach the install.
Type poplin.example.com to go on: poplin.example.com
removed       Worker route          *-poplin.example.com/*, *-page.example.com/*, poplin.example.com/*
...
removed       Database              poplin (sites: 3)
the install is removed. 18 kinds removed, 0 left, 2 stay.
Each row that says stays names what is yours to do by hand.
On each computer that is still logged in: npx poplin logout. It forgets the login there, and says the install could not be reached.
The token was used for this run and is stored nowhere. You can delete it at Cloudflare.
```

Nothing is removed before you type the address. Another text than the install's own removes nothing.

## What stays, and what to do

The last lines count the rows that say `removed` or `already gone`, and the rows that say `stays`. Where the token lacks an optional permission, they name each kind it could not look for:

```text
the install is removed, but for what the token could not look for. 16 kinds removed, 0 left, 4 stay.
Each row that says stays names what is yours to do by hand.
2 kinds were not looked for, since the token lacks an optional permission: Budget alert and Certificate alert. If the install made one, it is still there: delete it by hand, or add the permission and run this command again.
```

The link the command prints makes a token without the optional permissions. [The optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) names them and their boxes on the form.

Read the rows that say `stays`:

| Stays                                   | When                                                         | Do                                                                    |
| --------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| the account token                       | always                                                       | delete the token you used for this install at Cloudflare, under My Profile, then API Tokens. [Tell it by its account and domain](#which-token-to-delete) |
| the budget alert, and under a domain the certificate alert and the redirect, guard, and rate rules | when the token lacks the optional permission the row names. The command then cannot see whether the install has them | look for them [by hand](#by-hand-at-cloudflare), and delete what is there; or add the permission, and run the command again |
| a rule set of poplin's name             | under a domain, when it holds a rule that is not poplin's: its row says so | nothing: the rule in it is yours. [The list by hand](#by-hand-at-cloudflare) names the three |
| the two bot switches                    | under a domain                                               | [switch off what you do not want](#by-hand-at-cloudflare)             |
| what you switched on in [step 1 of Install](../start/install.md#1-switch-on-what-no-command-can) | always: the Zero Trust team with its Free plan, R2, the payment method, and the account's `workers.dev` subdomain | nothing: they are not poplin's. They are yours, to keep or to cancel at Cloudflare |

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

The list before the question says `would keep` for both, the warning above the question ends `The sites' files and the database stay.`, and their rows then say `kept`. The two keys go with the rest.

A run that left a kind undone ends `Run this command again with --keep-data`, and `next` of its `--json` value names the command with `--keep-data`: a line without it removes the data too.

| Then                                   | Do                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| take the data up in a new install of the same kind | `npx poplin install cloudflare`: it finds the data, and asks `Use it, with what it holds?` |
| remove the data too                    | the same `uninstall` line without `--keep-data`: it asks you to type `poplin-sites` |

The new install takes its users and its settings from the kept database:

| The kept database holds | Who the login lets in             | `--user`                                                                           |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| users                   | those users, and nobody else      | not used. For an email that is none of them, the row `left out  First login` says so |
| no users yet            | the email you give for `--user`   | used                                                                               |
| records this poplin cannot read | the email you give for `--user` | used, and the row of the database says that its users were not read          |

To let one more person in afterwards: `npx poplin doctor --repair --no-domain --add-user you@example.com`, with their email. Under a domain the line holds `--domain` and your domain in place of `--no-domain`. Where the email of `--user` is none of the kept users, the run ends with that line, after `To let you@example.com log in too:`, and offers no login of this computer.

A dry run with `--keep-data` lists the same. The kept bucket and database stay in your account as they are: [What can cost money](cost/what-can-cost-money.md) says what stored files count toward.

## When it stops

| It says                                                  | Means                                                | Do                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `No install is in this account. Nothing was removed.`    | the token is of an account with no install           | make the token in the account the install is in                               |
| `Only the data is left here, and --keep-data keeps it.`  | the install is removed, and only its kept data is left | to remove the data too, run the line without `--keep-data`                  |
| `The install in this account answers at`, and an address | the line named another place than the install's: `--no-domain` for an install under a domain, the other way round, or another domain | run it again with the install's own domain after `--domain`, or with `--no-domain` |
| `An install was started in this account`, and a place    | an install that was never finished was started for another place than the line named | run it again with the option the line names: `--domain` and that domain, or `--no-domain` |
| `What was typed is not this install's`                   | the address you typed is not the install's own       | run it again, and type the address the line names                             |
| a number, then `not done`, and `Run this command again`  | a row says `stopped`, `failed`, or `not run`         | fix what the row names, then run the same line again: it removes what is left |
| a row `stopped`, ending `Add this one:` and a name       | the token lacks the permission of that name          | [add it to the token](../fix/an-install-step-fails.md#add-a-permission-to-the-token) |
| `The account changed since it was looked at.`            | something changed at Cloudflare during the run       | run it again                                                                  |
| `--dry-run removes nothing: leave out --confirm`         | the two options were on one line                     | take one of them off                                                          |

## From a script

A person gives the token at the question, where it is not shown. A script or a CI job cannot be asked: it gives the address with `--confirm`, and adds `--yes`. `--yes` alone removes nothing.

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
