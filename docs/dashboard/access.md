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
| `Added.` or `Removed.`                                  | has the change: a new user can log in            | nothing                                               |
| `... is tried again by itself.`                         | gave no answer, for the list or for the budget alert | nothing: poplin tries again within 15 minutes         |
| `... is brought up to date by itself.`                  | is one change behind: the users changed again meanwhile | nothing                                             |
| `... Open Domain and press Repair.`                     | is as it was or only partly changed: the install holds no key, Cloudflare refused the key, or the list is missing | on Domain, press Repair, paste an account token as in [step 3](../start/install.md#3-make-the-account-token), and press Repair again |

The change is saved in every case. `poplin config users` shows the same list.

[Activity](activity.md) names each user by email, on the screen and in its files: `Added a user: new@example.com`, `Removed a user: new@example.com`.

**When no user can log in**, one more email is let in from a terminal, with an account token: `npx poplin doctor --repair --add-user new@example.com`. [I cannot log in](../fix/cannot-log-in.md#the-steps) has the steps.

To remove another user, choose Remove in the menu at the end of that user's row, and press Remove when asked. That user is out of the dashboard at once, and out of private sites within a minute. Your own email cannot be the one you remove.

Every token that user approved stops working in the same step: the logins of their machines, their agents, and their build servers. The question before the removal says how many. Adding the user again brings none of them back.

A list changed with `poplin config users`, or by `poplin import` with `--settings --users`, is written to Cloudflare's list the same way, and a user it leaves out loses their tokens the same way. `poplin config users` prints one more step where a Repair is still needed. The budget alert is mailed to the first user, and follows when another email becomes the first.

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
  ->  prints a URL and a short code
  ->  you open the URL, type the last 4 letters of the code, and approve it
  ->  the token is stored on this machine
```

An install begins two logins a minute from one address, and eight a minute for all addresses together. In a minute that is full, `poplin login` is told how long to wait, waits, and asks again.

The page that approves a login starts at the role Publisher, whatever the machine asked for. A publisher changes its own sites only. Choose Admin there for a machine that changes settings or sees every site.

A machine keeps one saved login: a new `poplin login` replaces it. An agent on the machine uses that login and does not log in itself. `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment stand in for a saved login.

`POPLIN_CONFIG_DIR` in the environment names another folder for the saved login, read when the two names above are not set. Set for an agent's tools alone, it gives the agent a login of its own, which shows under its own name: [the skill's page](../../skills/poplin/references/mcp-server.md#optional-a-login-of-your-own) has the step.

## Tokens

A machine's login is a token. The dashboard lists them under Access, Tokens.

| In the list                    | Shows                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| a token that works             | its name, its role as `Admin (everything)` or `Publisher (own sites only)`, when it was approved, when it expires |
| Revoke, in the menu of its row | ends it at once                                                            |
| Revoked tokens, folded         | the 50 that ended last in the past 90 days, each with `Revoked by` and who did it, `Logged out`, `Expired`, or `Its user was removed` |

A revoked token never logs in again, and nothing brings it back: `poplin login` makes a new one. `Logged out` is a token that `poplin logout` gave back. `Its user was removed` is a token that ended with the user who approved it. [Security](../about/security.md#hardening) says what the install stores of a token.

`--publisher` is for a machine or a script that should only publish, such as a build server or a shared machine.

| A publisher's login | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| can                 | publish, and for the sites it published: list, show, update, change who can open, roll back, re-link, copy, delete, and restore |
| cannot              | reach a site another login published, or the install's settings, users, backups, and updates                                    |
