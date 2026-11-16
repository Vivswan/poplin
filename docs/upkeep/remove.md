---
title: Remove
order: 30
---

# Remove an install

Everything an install made, and where each piece is removed by hand; poplin has no command that removes an install.

```text
lost for good:   every site's files and every kept version, the settings, the logins, the activity log
stops working:   every address of the install, each link you shared included
stays:           your Cloudflare account, your domain, and every record, route, and rule poplin did not make
```

**Export first.** `npx poplin export --all-versions --out backup.zip` downloads every site and the settings as one zip. [Back up](back-up.md) says what the zip holds and how an import puts it back.

`example.com` stands for your own domain. Each piece carries the name poplin gave it. Find that name in the place the table says, and delete it there.

## On each computer, while the install still answers

| Piece                                 | Its name                                         | Remove it                                                                      |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| a login in the environment            | `POPLIN_SERVER` and `POPLIN_TOKEN`               | delete the two lines where you set them, first, and open a new terminal        |
| the saved login                       | one on each computer you logged in               | `npx poplin logout`: it ends the login at the install and forgets it           |
| an agent's own login, if it has one   | the folder `POPLIN_CONFIG_DIR` names             | the same command with that variable set; then delete the folder                |
| poplin's tools in your agent          | the MCP server named `poplin`                    | remove that entry the way your agent removes an MCP server, then restart it    |
| poplin installed with npm             | the package `poplin`                             | `npm uninstall -g poplin`, only if you installed it that way                   |

While the two names of the first row are set, `poplin logout` ends that login and leaves the saved one on the computer. That is why the row comes first.

## At Cloudflare

Go from the top row down: what points at the Worker goes first, then the Worker, then what it kept. The first five rows are in your domain, the rest in your account.

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
| the two keys                          | "poplin kept key" and "poplin upload key"                                                             | Manage Account, then Account API Tokens             |
| the Cloudflare API token of step 3    | "poplin setup", unless you named it otherwise                                                         | My Profile, then API Tokens                         |

- **The three rules** are there when a Repair's token held an [optional permission](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers). The guard rules can also be there once `search_engines_allowed` or `outside_pages` was saved on an install that holds its key.
- **A rule set** can stay behind, empty, where the domain had none before: "poplin redirect rule", "poplin guard rules", "poplin rate rule". An empty set stops nothing.
- **The wildcard record** `*` is there only when the domain had none of its own. A `*` record with no `poplin: ` comment is yours: leave it.
- **The second application** lets `/api` and `/setup` pass the login. It has a policy of its own.
- **A policy** goes after the application that uses it.
- **The Workflow** stays when the Worker is deleted, so it is a row of its own. It runs the copy of a large site, and holds no site's files.
- **The Worker** takes its values, its 15-minute timer, and its `workers.dev` address with it.
- **Without a domain** the first five rows do not exist. Two more Workers do, `poplin-sites` and `poplin-private`: delete them under Workers & Pages, before the Worker `poplin`.
- **The bucket** holds every site's files. If Cloudflare asks for an empty bucket, empty it there, then delete it.
- **The budget alert** is there where the install's key or a Repair made it, on an install of either kind: [Domain](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) says when.
- **The two keys** are there from the first Repair, on an install of either kind. They are tokens the account owns, and they stay when the Worker is deleted. A key that ran out is still in the list.

**Two bot switches** belong to the whole domain and carry no name. Repair can switch them on, with a token that held Bot Management: Edit. Repair never switches one off, and removing the rest leaves them on: switch them off in the domain's bot settings.

| Switch               | Repair switched it on when the setting `block_bots` was                 |
| -------------------- | ----------------------------------------------------------------------- |
| the AI crawler block | `on`, or `auto` on a domain with no other hostnames                     |
| Bot Fight Mode       | `on`, on a Free plan domain                                             |

**What you switched on in step 1** is not poplin's: the Zero Trust team with its Free plan, R2, and the payment method. They stay, and they are yours to keep or to cancel at Cloudflare.

## The copy of the code

| The install was made      | Piece                                                         | Remove it                                              |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| with the button of step 2 | the copy in your GitHub account, a repository named `poplin`  | delete the repository in its own settings, at GitHub   |
| from a terminal           | the folder `poplin` that `git clone` made                     | delete the folder                                      |

The button also gave Cloudflare access to your GitHub account. GitHub's settings list it: remove it there if nothing else of yours builds through it.
