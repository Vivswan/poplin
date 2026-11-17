---
title: When the install stops
order: 10
---

# When the install stops

Each line `npx poplin install cloudflare` can stop at, and what to do next; the steps themselves are in [Install](../start/install.md). An install [without a domain](../start/without-a-domain.md) stops the same way, but for the lines about a domain.

```text
stopped before any change    the line ends in "Nothing changed": fix the cause, run the same command again
stopped part way             rows say blocked, failed, or skipped: what is made stays, and every piece reads before it writes
```

## Before any change

| The command says                                                       | Means                                                           | Do                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `The input is not a Cloudflare account token`                          | what you pasted is not a whole token                            | paste the whole text of the token                                     |
| `Cloudflare refused the account token, or it can access no account.`   | Cloudflare does not take the token, or it reaches no account    | paste the whole text; check the token's Account Resources             |
| `The account token can access no active zone for example.com.`         | the domain is mistyped, not Active, or not the token's zone     | correct the domain, or edit the token's Zone Resources                |
| `example.com is not a domain name`                                     | the answer holds more than a domain                             | type the domain alone                                                 |
| a domain, then `is too long`                                           | a domain of more than 52 characters cannot hold an install      | use a shorter domain, or install without one                          |
| `The input is not an email address`                                    | the email is mistyped                                           | type it again                                                         |
| `The account token can access several accounts`, and a list            | the token reaches several accounts                              | type the number of the one the install goes to                        |
| `R2 is not enabled for this account, or the account token cannot use it.` | R2 is off, or the token lacks Workers R2 Storage: Edit          | finish the R2 row of [step 1](../start/install.md#1-switch-on-what-no-command-can); check the token's row Workers R2 Storage |
| `Access is not enabled for this account.`                              | Zero Trust is off: nobody could log in                          | answer no at `Continue anyway?`, pick the Free plan at the address it prints, then run again |
| `This account has no workers.dev subdomain, or one too long for the login hostname.` | without a domain: the account has no `workers.dev` subdomain, or one of more than 36 characters | open Workers & Pages at the address it prints, and set a subdomain of 36 characters at most |
| a line that ends `The account token lacks this permission:` and a name | the token lacks the permission of that name                  | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `This account has a D1 database named poplin but no poplin Worker.` | an earlier install left its database, its bucket, or both      | answer yes at `Reuse these resources and their data?` to keep its sites; or delete it at the address it prints |
| `This account has a Worker named poplin that is not marked as poplin's` | the name the install needs is taken, or poplin's own Worker was uploaded a moment ago and Cloudflare does not show its marks yet | right after an install or an update: wait a minute, and run the line again. Else rename that Worker at the address it prints |
| `This account has a Worker named poplin that is marked as poplin's but lacks`, and a list | an install whose Worker lost a binding, as one deployed again by hand does | keep it. Put the bindings back on the Worker's Bindings page, then run the command the line names |
| `poplin 0.1.0 is already installed at https://poplin.example.com`      | an install is there, and nothing was changed                    | the line under it names what to run next: the login where the install `needs no repair`, and the repair where it `needs a repair`: [the second run](#the-second-run) |
| `The project website lists no release.`                                | poplin's website names no version to install: none is out, or one came out minutes ago | run it again in a few minutes |
| `This release requires a newer CLI`                                    | the newest version needs a newer command                        | `npx poplin@latest install cloudflare`                                |
| `The release files failed validation.`                                 | the release's files are not the ones poplin's website names for that version | run it again; if it comes back, [report it](https://github.com/Vivswan/poplin/issues) |
| `Cloudflare gave no valid response.`                                   | no answer came, from Cloudflare or from poplin's website        | run it again in a minute                                              |
| `Missing` and its name                                                 | a run that asks nothing lacks an answer                         | give the option or the variable the line under it names               |

## Part way

A row says what happened to one piece. [Step 4 of Install](../start/install.md#4-read-what-it-made) has every word a row starts with.

| A row                                                              | Means                                                   | Do                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `skipped`, saying `The account token lacks` and a name, or `The install creates it within a day` | nothing is wrong: an optional permission is not on the token | nothing, or [the optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) |
| `blocked`, ending `lacks this permission:` or `Add this permission to the account token:` and a name | the token lacks the permission of that name | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `blocked`, saying `Access is off for the account`                  | Zero Trust is off, and the run went on without the login | pick the Free plan at the address under the rows, then [finish with the repair](#the-second-run) |
| `failed`, saying `refused with status` and a number                | Cloudflare refused that one call                        | run the command again                                             |
| `failed`, with other words                                         | the row says why, such as a Worker of the name that is not poplin's | do what the row asks                                  |
| `failed`, ending `Cloudflare asked to wait` or `no answer from Cloudflare` | Cloudflare was busy, or gave no answer          | run the command again in a minute                                 |
| `skipped`, saying `an earlier row stopped the run`                 | an earlier row stopped the run before this piece        | fix that row first                                                |
| the address and `has not responded yet`, then `is installed, but its URL does not respond yet` | the install is made, and its new address does not answer yet | wait a few minutes, then log in: [step 5](../start/install.md#5-log-this-machine-in-and-check). If it still does not answer, run the repair the run printed: `npx poplin doctor --repair` with your `--domain` or `--no-domain`. Where the last line names a repair with `--add-user`, run that line |

## The second run

The last line of a run that left something undone names the command that goes on. It is one of three:

| The last line says                               | The install is                                        | Run, after the fix                                         |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| `Next: rerun this command`                      | started, and not set yet                              | the same `npx poplin install cloudflare` line, with the same `--domain` or `--no-domain`: it says `This account has an incomplete install. A run resumes it.`, and goes on. The other place is refused |
| `Next: run npx poplin doctor --repair` and    your `--domain` or `--no-domain` | set: its address is written, and pieces are missing   | that line as it is written, with the same token. Where the line has `--add-user` and an email, keep both: [the install kept its users](../upkeep/remove.md#keep-the-data) |
| `Nothing changed. Fix the above, then rerun this command.` | as it was before the run: the run printed no row, and changed nothing | the same line, once the line above it no longer holds: [Before any change](#before-any-change) has each |

The first two go on from what stands: every piece reads before it writes. `poplin install` only makes a new install, so a second `install` on one that is set says `is already installed`, and changes nothing.

**A run that went on with Zero Trust switched off** is finished this way. Switch Zero Trust on first, then:

```sh
npx poplin doctor --repair
```

```text
poplin 0.1.0 is installed at https://poplin.example.com
created    Access application    poplin: poplin.example.com, *-p-poplin.example.com
created    Access policy         poplin logins
The repair is complete
Dashboard: https://poplin.example.com
The account token was not stored. Delete it at Cloudflare.
```

The sample shows a few of the rows. The repair asks for the domain, or Enter for none, and for the token, as the install did. The line the install printed has `--domain` or `--no-domain` on it, and that repair asks for the token alone. [I cannot log in](cannot-log-in.md) has every line it can stop at.

**A first user whose email was mistyped** gets no code, so nobody can log in. The repair lets the right email in:

```sh
npx poplin doctor --repair --add-user you@example.com
```

Then log in with it, and remove the mistyped one under Access, Users. [The row of the new user](cannot-log-in.md#the-row-of-the-new-user) has what each answer means.

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

Cloudflare's login sends its code only to an email that is a login of the install. The first one is the email you gave the command. If that email was mistyped, or its mailbox is gone, [I cannot log in](cannot-log-in.md) has the way back in.

## The machine is not logged in

The login line is `npx poplin login`, with `--server` and your dashboard's address: [step 5](../start/install.md#5-log-this-machine-in-and-check) shows it. A machine with no stored login needs the address each time.

| You see                                                    | Means                                                | Do                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| the terminal does not know `npx`                           | Node.js is not installed                             | run the LTS installer from nodejs.org, then open a new terminal |
| on Windows, `npx` answers that running scripts is disabled on this system | the terminal is PowerShell, which does not run the script that `npx` starts with | run the same line from Command Prompt: press the Windows key, type Command Prompt, press Enter |
| `node --version` prints a number below `v24`               | poplin runs on Node.js 24 or higher                  | run the LTS installer from nodejs.org                     |
| the browser cannot find the dashboard                      | a new address takes a few minutes                    | wait a few minutes and reload                             |
| the page refuses the letters you typed                     | that login is not the one your terminal began        | press Deny, and run the login line again                  |
| `poplin doctor` says `publisher token`                     | the page was left at Own sites only: this login reaches the sites it published, and no settings | on a machine of your own, run the login line again, and choose Everything |
| `The login was denied on the dashboard`                    | Deny was pressed; nothing was stored                  | run the login line again                                  |
| `The login expired before approval`               | the code ran out before Allow; nothing was stored     | run the login line again                                  |
| `Not logged in`                                            | the login did not finish                             | run the login line again                                  |
| `The token is missing or expired`                                 | the login ran out: it lasts 30 days                  | `npx poplin login`, and allow it again                    |
| `Cannot reach the install`                                 | the address is mistyped, or the network is down      | check the address after `--server`                        |
| a line of `poplin doctor` that starts with `failed`        | that one read failed; the rest of the line says why  | fix what it names, then run `npx poplin doctor` again     |
| `failed  problems`, then kinds                             | something went wrong in the install today            | [Problems](problems.md#what-is-noted) has each kind |

Any other sentence is a refusal: [When poplin refuses](poplin-refuses.md) has each.
