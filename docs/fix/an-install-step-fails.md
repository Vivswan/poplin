---
title: When the install stops
order: 10
---

# When the install stops

Each line `npx poplin install cloudflare` can stop at, and what to do next; the steps themselves are in [Install](../start/install.md). An install [without a domain](../start/without-a-domain.md) stops the same way, but for the lines about a domain.

```text
stopped before any change    the line ends in "nothing was changed": fix the cause, run the same command again
stopped part way             rows say stopped, failed, or not run: what is made stays, and every piece reads before it writes
```

## Before any change

| The command says                                                       | Means                                                           | Do                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `that is no account token of Cloudflare`                               | what you pasted is not a whole token                            | paste the whole text of the token                                     |
| `Cloudflare refused the token, or the token shows no account.`         | Cloudflare does not take the token, or it reaches no account    | paste the whole text; check the token's Account Resources             |
| `The token shows no active domain example.com.`                        | the domain is mistyped, not Active, or not the token's zone     | correct the domain, or edit the token's Zone Resources                |
| `example.com is no domain name`                                        | the answer holds more than a domain                             | type the domain alone                                                 |
| a domain, then `is too long`                                           | a domain of more than 50 characters cannot hold an install      | use a shorter domain, or install without one                          |
| `that is no email address, such as you@example.com`                    | the email is mistyped                                           | type it again                                                         |
| `The token shows more than one account`, and a list                    | the token reaches several accounts                              | type the number of the one the install goes to                        |
| `R2 is not switched on for this account, or the token may not use it.` | R2 is off, or the token lacks Workers R2 Storage: Edit          | finish the R2 row of [step 1](../start/install.md#1-switch-on-what-no-command-can); check the token's row Workers R2 Storage |
| `Access is not switched on for this account.`                          | Zero Trust is off: nobody could log in                          | answer no at `Go on all the same?`, pick the Free plan at the address it prints, then run again |
| `This account has no free address yet, or one whose name is too long for the login.` | without a domain: the account has no `workers.dev` subdomain, or one of more than 36 characters | open Workers & Pages at the address it prints, and set a subdomain of 36 characters at most |
| a line that ends `The token lacks a permission. Add this one:` and a name | the token lacks the permission of that name                  | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `There is a database named poplin in this account, and no poplin runs.` | an earlier install left its database, its bucket, or both      | answer yes at `Use it, with what it holds?` to keep its sites; or rename or delete it at the address it prints |
| `A Worker named poplin is in this account and is not poplin's.`        | the name the install needs is taken                             | rename or delete that Worker at the address it prints                 |
| `This account already holds poplin 0.1.0, at https://poplin.example.com.` | an install is there, and nothing was changed                 | log in to it: `npx poplin login`, with `--server` and the address the line names |
| `No release of poplin is published yet.`                               | poplin's website names no version to install                    | nothing can be installed until it does                                |
| `This release needs a newer poplin`                                    | the newest version needs a newer command                        | `npx poplin@latest install cloudflare`                                |
| `The release's files are not the ones the project published.`          | the release's files are not the ones poplin's website names for that version | run it again; if it comes back, report it                |
| `Cloudflare gave no usable answer.`                                    | no answer came, from Cloudflare or from poplin's website        | run it again in a minute                                              |
| `an answer is missing:` and its name                                   | a run that asks nothing lacks an answer                         | give the option or the variable the line names                        |

## Part way

A row says what happened to one piece, and calls a permission a right. [Step 4 of Install](../start/install.md#4-read-what-it-made) has every word a row starts with.

| A row                                                              | Means                                                   | Do                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `left out`, ending `add this right to the account token and press Repair:` and a name | nothing is wrong: an optional permission is not on the token | nothing, or [the optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) |
| `stopped`, ending `Add this one:` or `Add this right to the account token:` and a name | the token lacks the permission of that name | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `stopped`, saying `Access is off for the account`                  | Zero Trust is off, and the run went on without the login | pick the Free plan at the address under the rows                 |
| `failed`, ending `refused with status` and a number                | Cloudflare refused that one call                        | run the command again                                             |
| `failed`, with other words                                         | the row says why, such as a Worker of the name that is not poplin's | do what the row asks                                  |
| `failed`, ending `Cloudflare asked to wait` or `no answer from Cloudflare` | Cloudflare was busy, or gave no answer          | run the command again in a minute                                 |
| `not run`                                                          | an earlier row stopped the run before this piece        | fix that row first                                                |
| `no answer yet at` and the address                                 | the install is made, and its new address does not answer yet | wait a few minutes, then log in: [step 5](../start/install.md#5-log-this-computer-in-and-check) |

After the fix, run the same command again. It goes one of two ways:

| The second run says                                  | Means                                         | Do                                                                           |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `An install was started here and not finished`       | it goes on with what stands                   | read the rows as before                                                      |
| `This account already holds poplin`                  | the install is set, and only its last pieces are left | where no row of Access stopped: log in to the dashboard, open [Domain](../dashboard/domain.md), a screen of both kinds of install, and press Repair with the same token |

## Add a permission to the token

Your tokens are listed at Cloudflare under My Profile, then API Tokens. Each token's row ends in a menu.

| You                         | Do, in the token's menu                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| still have the token's text | choose Edit, add the permission, save. Paste the same text at the next run        |
| no longer have it           | choose Roll. Roll makes a new token text. Add the permission, and paste the new text |

A permission's name holds two of the form's three boxes. `Zone WAF: Edit` means Zone WAF in the second box and Edit in the third. The first box is in the table of [the empty form](#the-token-form-opens-empty), or of [the optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers).

## The token form opens empty

Press Create Token, then Create Custom Token. For each row below, press Add more and choose in its three boxes:

| First box | Second box                                            | Third box | For                                         |
| --------- | ----------------------------------------------------- | --------- | ------------------------------------------- |
| Account   | Workers Scripts                                       | Edit      | the Worker and its values                   |
| Account   | Workers R2 Storage                                    | Edit      | the bucket                                  |
| Account   | D1                                                    | Edit      | the database                                |
| Account   | Access: Apps and Policies                             | Edit      | the login                                   |
| Account   | Access: Organizations, Identity Providers, and Groups | Read      | your team's name                            |
| Account   | Account API Tokens                                    | Edit      | making the key poplin keeps                 |
| Zone      | Zone                                                  | Read      | finding your domain                         |
| Zone      | DNS                                                   | Edit      | the addresses                               |
| Zone      | Workers Routes                                        | Edit      | sending the addresses to the Worker         |
| Zone      | Zone Settings                                         | Read      | seeing whether the domain redirects already |

Then finish the form as in the table of [step 3](../start/install.md#3-make-the-account-token).

**Without a domain**, add the six Account rows and no Zone row, and finish the form as [its own table](../start/without-a-domain.md#the-account-token) has it.

## No code arrives

Cloudflare's login sends its code only to an email that is a login of the install. The first one is the email you gave the command.

## The computer is not logged in

The login line is `npx poplin login`, with `--server` and your dashboard's address: [step 5](../start/install.md#5-log-this-computer-in-and-check) shows it. A computer with no saved login needs the address each time.

| You see                                                    | Means                                                | Do                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| the terminal does not know `npx`                           | Node.js is not installed                             | run the LTS installer from nodejs.org, then open a new terminal |
| `node --version` prints a number below `v24`               | poplin runs on Node.js 24 or higher                  | run the LTS installer from nodejs.org                     |
| the browser cannot find the dashboard                      | a new address takes a few minutes                    | wait a few minutes and reload                             |
| the page refuses the letters you typed                     | that login is not the one your terminal began        | press Deny, and run the login line again                  |
| `poplin doctor` says `publisher token`                     | the page was left at Own sites only                  | run the login line again, and choose Everything           |
| `the login was denied on the dashboard`                    | Deny was pressed; nothing was saved                  | run the login line again                                  |
| `nobody allowed the login before it ran out`               | the code ran out before Allow; nothing was saved     | run the login line again                                  |
| `not logged in`                                            | the login did not finish                             | run the login line again                                  |
| `no token was sent, or it expired`                         | the login ran out: it lasts 30 days                  | `npx poplin login`, and allow it again                    |
| `the install could not be reached`                         | the address is mistyped, or the network is down      | check the address after `--server`                        |
| a line of `poplin doctor` that starts with `failed`        | that one read failed; the rest of the line says why  | fix what it names, then run `npx poplin doctor` again     |
| `failed  problems`, then kinds                             | something went wrong in the install today            | [Problems](problems.md#what-is-noted) has each kind |

Any other sentence is a refusal: [When poplin refuses](poplin-refuses.md) has each.
