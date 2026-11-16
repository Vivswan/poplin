---
title: Access
order: 40
---

# Access

The users who can log in, and the login this computer keeps.

## Add a user

A user is an email in `logins`, which can log in to the dashboard. Cloudflare's login page keeps its own list, and poplin writes every change into it by itself, with [the key it keeps](../about/security.md#the-kept-key).

| Where                        | Do                                                           |
| ---------------------------- | ------------------------------------------------------------ |
| the dashboard, Access, Users | press Add a user, type the email, and press Add a user again |

The line that follows says how the change went:

| The line says                                           | Cloudflare's list                                | Do                                                    |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `Added.` or `Removed.`                                  | has the change: a new user can log in            | nothing                                               |
| `... is tried again by itself.`                         | gave no answer, for the list or for the budget alert | nothing: poplin tries again within 15 minutes         |
| `... Open Domain and press Repair.`                     | is as it was or only partly changed: the install holds no key, Cloudflare refused the key, or the list is missing | on Domain, press Repair, paste an account token as in [step 3](../start/by-hand.md#the-steps), and press Repair again |

The change is saved in every case. `poplin config logins` shows the same list.

To remove another user, choose Remove in the menu at the end of that user's row, and press Remove when asked. That user is out of the dashboard at once, and out of private sites within a minute. Your own email cannot be the one you remove.

Every token that user allowed stops working in the same step: the logins of their computers, their agents, and their build servers. The question before the removal says how many. Adding the user again brings none of them back.

A list changed with `poplin config logins`, or by `poplin import` with `--settings --logins`, is written to Cloudflare's list the same way, and a user it leaves out loses their tokens the same way. `poplin config logins` prints one more step where a Repair is still needed. The budget alert is mailed to the first user, and follows when another email becomes the first.

Sign everyone out, on the same tab, ends every login of the dashboard and of private sites: everyone logs in again at the next click, you too. It can take a few seconds. Tokens keep working. [Security](../about/security.md#hardening) says what it ends and what it leaves.

| After the press | Means | What to do |
| --- | --- | --- |
| `Everyone is logged out. This can take a few seconds.` | Cloudflare ended every login | nothing: each browser meets the login page at its next click |
| `... so nobody was logged out. Open Domain and press Repair.` | the install holds no key, Cloudflare refused it, or the login in front is missing | on Domain, press Repair with an account token, then press Sign everyone out again |
| `... so the logins may not have ended. Try again.` | Cloudflare gave no answer | press it again |

Without a kept key, Cloudflare ends the logins itself: in Zero Trust, open the Access application named poplin and revoke its existing tokens.

## This computer

| Example                                              | Does                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `poplin login --server https://poplin.example.com`   | logs this computer in: you allow it in your browser           |
| `poplin login --publisher --name ci-runner`          | saves a publisher's login, for a computer that should only publish            |
| `poplin login --no-browser`                          | prints the address and opens no browser                       |
| `poplin whoami`                                      | prints the install, the role, and when the login runs out     |
| `poplin logout`                                      | revokes the login and forgets it                              |

```text
$ poplin login --server https://poplin.example.com
  ->  prints an address and a short code
  ->  you open the address, type the last 4 letters of the code, and allow it
  ->  the login is saved on this computer
```

An install begins two logins a minute from one address, and eight a minute for all addresses together. In a minute that is full, `poplin login` is told how long to wait, waits, and asks again.

The page that allows a login starts at Own sites only, whatever the computer asked for. Choose Everything there for a computer that changes settings or sees every site.

A computer keeps one saved login: a new `poplin login` replaces it. An agent on the computer uses that login and does not log in itself. `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment stand in for a saved login.

`POPLIN_CONFIG_DIR` in the environment names another folder for the saved login, read when the two names above are not set. Set for an agent's tools alone, it gives the agent a login of its own, which shows under its own name: [the skill's page](../../skills/poplin/references/mcp-server.md#optional-a-login-of-your-own) has the step.

## Tokens

A computer's login is a token. The dashboard lists them under Access, Tokens.

| In the list                    | Shows                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| a token that works             | its name, what it can change, when it was allowed, when it runs out        |
| Remove, in the menu of its row | ends it at once                                                            |
| Removed tokens, folded         | the 50 that ended last in the past 90 days, each with `Removed by` and who did it, `Logged out`, `Ran out`, or `Its user was removed` |

A removed token never logs in again, and nothing brings it back: `poplin login` makes a new one. `Logged out` is a token that `poplin logout` gave back. `Its user was removed` is a token that ended with the user who allowed it. [Security](../about/security.md#hardening) says what the install stores of a token.

`--publisher` is for a computer or a script that should only publish, such as a build server or a shared machine.

| A publisher's login | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| can                 | publish, and for the sites it published: list, show, update, change who can open, roll back, re-link, copy, delete, and restore |
| cannot              | reach a site another login published, or the install's settings, logins, backups, and updates                                   |
