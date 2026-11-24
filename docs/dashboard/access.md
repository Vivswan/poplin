---
title: Access
order: 40
---

# Access

The users who can log in, and the login this machine keeps.

## Add a user

A user is an email in `users`, which can log in to the dashboard. Cloudflare's login page keeps its own list, and poplin writes every change into it by itself, with [the key it keeps](../about/security.md#the-kept-key).

| Where                        | Do                                                           |
| ---------------------------- | ------------------------------------------------------------ |
| the dashboard, Access, Users | press Add a user, type the email, and press Add a user again |

The line that follows says how the change went:

| The line says                                           | Cloudflare's list                                | Do                                                    |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `Added.`, then `Send them` and the dashboard's address  | has the change: the new user can log in at that address | send them the address: poplin and Cloudflare mail nobody |
| `Removed.`                                              | has the change                                   | nothing                                               |
| `... is tried again by itself.`                         | gave no answer, for the list or for the budget alert | nothing: poplin tries again within 15 minutes         |
| `... is brought up to date by itself.`                  | is one change behind: the users changed again meanwhile | nothing                                             |
| `... Open Domain and press Repair.`                     | is as it was or only partly changed: the install holds no key, Cloudflare refused the key, or the list is missing | on Domain, press Repair, paste an account token as in [step 3](../start/install.md#3-make-the-account-token), and press Repair again |

The change is saved in every case. `poplin config users` shows the same list.

A new user logs in at the dashboard's address, by the code Cloudflare mails to the email you added. Once Cloudflare's list has the change, their private sites can take up to a minute more to open: until then a private site answers that it was not found, and a reload opens it.

[Activity](activity.md) names each user by email, on the screen and in its files: `Added a user: new@example.com`, `Removed a user: new@example.com`.

**When no user can log in**, one more email is let in from a terminal, with an account token: `npx poplin doctor --repair --add-user new@example.com`. [I cannot log in](../fix/cannot-log-in.md#the-steps) has the steps.

To remove another user, choose Remove in the menu at the end of that user's row, and press Remove when asked. That user is out of the dashboard at once, and out of private sites within a minute. Your own email cannot be the one you remove.

Every token that user approved stops working in the same step: the logins of their machines, their agents, and their build servers. The question before the removal says how many. Adding the user again brings none of them back.

A list changed with `poplin config users`, or by `poplin import` with `--settings --users`, is written to Cloudflare's list the same way, and a user it leaves out loses their tokens the same way. `poplin config users` prints one more step where a Repair is still needed. The budget alert is mailed to the users [`alert_users`](settings.md#who-gets-the-alerts) chooses, the first user by default.

Sign out, in the menu your email opens at the foot of the side menu, ends the login of this browser alone: Cloudflare shows its own page, and the next visit asks for a code again.

Sign everyone out, on the tab Users, ends every login of the dashboard and of private sites: everyone logs in again at the next click, you too. It can take a few seconds. Tokens keep working. [Security](../about/security.md#hardening) says what it ends and what it leaves.

| After the press | Means | What to do |
| --- | --- | --- |
| `Everyone is signed out. This can take a few seconds.` | Cloudflare ended every login | nothing: each browser meets the login page at its next click |
| `... so nobody was signed out.`, then `Open Domain and press Repair.` | the install holds no key, Cloudflare refused it, or the login in front is missing | on Domain, press Repair with an account token, then press Sign everyone out again |
| `... so the logins may not have ended. Try again.` | Cloudflare gave no answer | press it again |

Without a kept key, Cloudflare ends the logins itself: in Zero Trust, open the Access application named poplin and revoke its existing tokens.

## This machine

| Example                                              | Does                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `poplin login --server https://poplin.example.com`   | logs this machine in: you approve it in your browser           |
| `poplin login --publisher --machine ci-runner`       | saves a publisher's login, for a machine that should only publish            |
| `poplin login --no-browser`                          | prints the URL and opens no browser                           |
| `poplin login --json`                                | prints two lines: the URL and the code, then the result       |
| `poplin whoami`                                      | prints the install, the role, and when the login expires      |
| `poplin logout`                                      | revokes the login and forgets it                              |

```text
$ poplin login --server https://poplin.example.com
  ->  prints a URL and a short code, and copies the code
  ->  you open the URL, paste or type the whole code, and approve it
  ->  the token is stored on this machine
```

The code is copied only for a person at the terminal:

| `poplin login` is run                                    | The code is                                    |
| -------------------------------------------------------- | ---------------------------------------------- |
| in a terminal, on a machine you sit at, with a clipboard | copied: its line starts with `Code copied:`    |
| with no terminal to ask on, as an agent or a script does | printed alone: its line starts with `Code:`    |
| over SSH, in CI, or on a machine with no clipboard       | printed alone: its line starts with `Code:`    |
| with `--json`                                            | in the first line of JSON, and never copied    |

An install begins two logins a minute from one address, and eight a minute for all addresses together. In a minute that is full, `poplin login` is told how long to wait, waits, and asks again.

The page that approves a login starts at the role Publisher, whatever the machine asked for. A publisher changes its own sites only. Choose Admin there for a machine that changes settings or sees every site.

The same page says when the token expires, and the pencil beside that sets another moment. Until you choose one, the expiry follows the role: an Admin token expires after 30 days, a Publisher token never.

| Expires                  | The token stops working                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| 30 days, 90 days, 1 year | at the day and time the menu shows beside it: that long after the menu opened  |
| On a day...              | when the day you pick starts, in the time zone the dashboard shows             |
| Never                    | when you revoke it, or when the user who approved it is removed                |

A machine keeps one saved login: a new `poplin login` replaces it. An agent on the machine uses that login and does not log in itself. `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment stand in for a saved login.

`POPLIN_CONFIG_DIR` in the environment names another folder for the saved login, read when the two names above are not set. Set for an agent's tools alone, it gives the agent a login of its own, which shows under its own name: [the skill's page](../../skills/poplin/references/mcp-server.md#optional-a-login-of-your-own) has the step.

## Tokens

A machine's login is a token. The dashboard lists them under Access, Tokens.

| In the list                    | Shows                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| a token that works             | its name, its role as `Admin (everything)` or `Publisher (own sites only)`, when it was approved, when it expires |
| Change expiry, in the menu of its row | sets when a token that works expires: later, sooner, or never, with the same choices as the page that approves a login |
| Revoke, in the menu of its row | ends it at once                                                            |
| Revoked tokens, folded         | the 50 that ended last in the past 90 days, each with `Revoked by` and who did it, `Logged out`, `Expired`, or `Its user was removed` |

A token that has expired is ended as a revoked one is: Change expiry is for a token that still works. Each change of an expiry is written to Activity, with what it was and what it is: a day, or never.

A revoked token never logs in again, and nothing brings it back: `poplin login` makes a new one. `Logged out` is a token that `poplin logout` gave back. `Its user was removed` is a token that ended with the user who approved it. [Security](../about/security.md#hardening) says what the install stores of a token.

`--publisher` is for a machine or a script that should only publish, such as a build server or a shared machine.

| A publisher's login | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| can                 | publish, and for the sites it published: list, show, update, change who can open, roll back, re-link, copy, delete, and restore |
| cannot              | reach a site another login published, or the install's settings, users, backups, and updates                                    |
