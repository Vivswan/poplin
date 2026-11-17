---
title: When the install stops
order: 10
---

# When the install stops

Each line `npx poplin install cloudflare` can stop at, and what to do next; the steps themselves are in [Install](../start/install.md). An install [without a domain](../start/without-a-domain.md) stops the same way, but for the lines about a domain.

```text
stopped before any change    the line ends in "Nothing was changed.": fix the cause, run the same command again
stopped part way             rows say stopped, failed, or not run: what is made stays, and every piece reads before it writes
```

## Before any change

| The command says                                                       | Means                                                           | Do                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `that is no account token of Cloudflare`                               | what you pasted is not a whole token                            | paste the whole text of the token                                     |
| `Cloudflare refused the token, or the token shows no account.`         | Cloudflare does not take the token, or it reaches no account    | paste the whole text; check the token's Account Resources             |
| `The token shows no active domain example.com.`                        | the domain is mistyped, not Active, or not the token's zone     | correct the domain, or edit the token's Zone Resources                |
| `example.com is no domain name`                                        | the answer holds more than a domain                             | type the domain alone                                                 |
| a domain, then `is too long`                                           | a domain of more than 52 characters cannot hold an install      | use a shorter domain, or install without one                          |
| `that is no email address, such as you@example.com`                    | the email is mistyped                                           | type it again                                                         |
| `The token shows more than one account`, and a list                    | the token reaches several accounts                              | type the number of the one the install goes to                        |
| `R2 is not switched on for this account, or the token may not use it.` | R2 is off, or the token lacks Workers R2 Storage: Edit          | finish the R2 row of [step 1](../start/install.md#1-switch-on-what-no-command-can); check the token's row Workers R2 Storage |
| `Access is not switched on for this account.`                          | Zero Trust is off: nobody could log in                          | answer no at `Go on all the same?`, pick the Free plan at the address it prints, then run again |
| `This account has no free address yet, or one whose name is too long for the login.` | without a domain: the account has no `workers.dev` subdomain, or one of more than 36 characters | open Workers & Pages at the address it prints, and set a subdomain of 36 characters at most |
| a line that ends `The token lacks a permission. Add this one:` and a name | the token lacks the permission of that name                  | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `There is a database named poplin in this account, and no poplin runs.` | an earlier install left its database, its bucket, or both      | answer yes at `Use it, with what it holds?` to keep its sites; or delete it at the address it prints |
| `A Worker named poplin is in this account and does not carry poplin's name`  | the name the install needs is taken, or poplin's own Worker was uploaded a moment ago and Cloudflare does not show its marks yet | right after an install or an update: wait a minute, and run the line again. Else rename that Worker at the address it prints |
| `A Worker named poplin is in this account. It carries poplin's name and lacks`, and a list | an install whose Worker lost a binding, as one deployed again by hand does | keep it. Put the bindings back on the Worker's Bindings page, then run the command the line names |
| `This account already holds poplin 0.1.0, at https://poplin.example.com` | an install is there, and nothing was changed                 | the line under it has the way on: the login where the install `is as it should be`, and the repair where it `is not`: [the second run](#the-second-run) |
| `The project's website names no release now.`                      | poplin's website names no version to install: none is out, or one came out minutes ago | run it again in a few minutes |
| `This release needs a newer poplin`                                    | the newest version needs a newer command                        | `npx poplin@latest install cloudflare`                                |
| `The release's files are not the ones the project published.`          | the release's files are not the ones poplin's website names for that version | run it again; if it comes back, [report it](https://github.com/Vivswan/poplin/issues) |
| `Cloudflare gave no usable answer.`                                    | no answer came, from Cloudflare or from poplin's website        | run it again in a minute                                              |
| `an answer is missing:` and its name                                   | a run that asks nothing lacks an answer                         | give the option or the variable the line names                        |

## Part way

A row says what happened to one piece. [Step 4 of Install](../start/install.md#4-read-what-it-made) has every word a row starts with.

| A row                                                              | Means                                                   | Do                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `left out`, ending `add this permission to the account token and run npx poplin doctor --repair:` and a name | nothing is wrong: an optional permission is not on the token | nothing, or [the optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) |
| `stopped`, ending `Add this one:` or `Add this permission to the account token:` and a name | the token lacks the permission of that name | add it to the token: [the table below](#add-a-permission-to-the-token) |
| `stopped`, saying `Access is off for the account`                  | Zero Trust is off, and the run went on without the login | pick the Free plan at the address under the rows, then [finish with the repair](#the-second-run) |
| `failed`, saying `refused with status` and a number                | Cloudflare refused that one call                        | run the command again                                             |
| `failed`, with other words                                         | the row says why, such as a Worker of the name that is not poplin's | do what the row asks                                  |
| `failed`, ending `Cloudflare asked to wait` or `no answer from Cloudflare` | Cloudflare was busy, or gave no answer          | run the command again in a minute                                 |
| `not run`                                                          | an earlier row stopped the run before this piece        | fix that row first                                                |
| `no answer yet at` and the address, then `is made, and its address does not answer yet` | the install is made, and its new address does not answer yet | wait a few minutes, then log in: [step 5](../start/install.md#5-log-this-computer-in-and-check). If it still does not answer, run the repair the run printed: `npx poplin doctor --repair` with your `--domain` or `--no-domain`. Where the last line names a repair with `--add-user`, run that line |

## The second run

The last line of a run that left something undone names the command that goes on. It is one of three:

| The last line says                               | The install is                                        | Run, after the fix                                         |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| `Run this command again`                         | started, and not set yet                              | the same `npx poplin install cloudflare` line, with the same `--domain` or `--no-domain`: it says `An install was started here and not finished`, and goes on. The other place is refused |
| `Run npx poplin doctor --repair` and your `--domain` or `--no-domain` | set: its address is written, and pieces are missing   | that line as it is written, with the same token. Where the line has `--add-user` and an email, keep both: [the install kept its users](../upkeep/remove.md#keep-the-data) |
| `Nothing was changed. Run this command again once what the lines above say is no longer so.` | as it was before the run: the run printed no row, and changed nothing | the same line, once the line above it no longer holds: [Before any change](#before-any-change) has each |

The first two go on from what stands: every piece reads before it writes. `poplin install` only makes a new install, so a second `install` on one that is set says `This account already holds poplin`, and changes nothing.

**A run that went on with Zero Trust switched off** is finished this way. Switch Zero Trust on first, then:

```sh
npx poplin doctor --repair
```

```text
looking for an install ... found: poplin 0.1.0, at https://poplin.example.com
made      Access application    poplin: poplin.example.com, *-p-poplin.example.com
made      Access policy         poplin logins
The login is ready. Open your dashboard and log in:
  https://poplin.example.com
the install is mended.
Your dashboard: https://poplin.example.com
The token was used for this run and is stored nowhere. You can delete it at Cloudflare.
```

The sample shows a few of the rows. The repair asks for the domain, or Enter for none, and for the token, as the install did. The line the install printed has `--domain` or `--no-domain` on it, and that repair asks for the token alone. [I cannot log in](cannot-log-in.md) has every line it can stop at.

**A first login that was mistyped** gets no code, so nobody can log in. The repair lets the right email in:

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

## The computer is not logged in

The login line is `npx poplin login`, with `--server` and your dashboard's address: [step 5](../start/install.md#5-log-this-computer-in-and-check) shows it. A computer with no saved login needs the address each time.

| You see                                                    | Means                                                | Do                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| the terminal does not know `npx`                           | Node.js is not installed                             | run the LTS installer from nodejs.org, then open a new terminal |
| on Windows, `npx` answers that running scripts is disabled on this system | the terminal is PowerShell, which does not run the script that `npx` starts with | run the same line from Command Prompt: press the Windows key, type Command Prompt, press Enter |
| `node --version` prints a number below `v24`               | poplin runs on Node.js 24 or higher                  | run the LTS installer from nodejs.org                     |
| the browser cannot find the dashboard                      | a new address takes a few minutes                    | wait a few minutes and reload                             |
| the page refuses the letters you typed                     | that login is not the one your terminal began        | press Deny, and run the login line again                  |
| `poplin doctor` says `publisher token`                     | the page was left at Own sites only: this login reaches the sites it published, and no settings | on a computer of your own, run the login line again, and choose Everything |
| `the login was denied on the dashboard`                    | Deny was pressed; nothing was saved                  | run the login line again                                  |
| `nobody allowed the login before it ran out`               | the code ran out before Allow; nothing was saved     | run the login line again                                  |
| `not logged in`                                            | the login did not finish                             | run the login line again                                  |
| `no token was sent, or it expired`                         | the login ran out: it lasts 30 days                  | `npx poplin login`, and allow it again                    |
| `the install could not be reached`                         | the address is mistyped, or the network is down      | check the address after `--server`                        |
| a line of `poplin doctor` that starts with `failed`        | that one read failed; the rest of the line says why  | fix what it names, then run `npx poplin doctor` again     |
| `failed  problems`, then kinds                             | something went wrong in the install today            | [Problems](problems.md#what-is-noted) has each kind |

Any other sentence is a refusal: [When poplin refuses](poplin-refuses.md) has each.
