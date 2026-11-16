---
title: When you cannot log in
order: 5
---

# When you cannot log in

`poplin doctor --repair` mends the install from a terminal, with an account token of the Cloudflare account it is in. It asks for no login of poplin, so it works when nobody gets in.

```text
the login broke, or nobody gets a code      npx poplin doctor --repair --domain example.com
your mailbox is lost                        npx poplin doctor --repair --domain example.com --add-user new@example.com
look first, change nothing                  npx poplin doctor --repair --domain example.com --dry-run
```

An install without a domain names none: `npx poplin doctor --repair --no-domain`.

## What you need

| Thing                    | Where it comes from                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| the Cloudflare account   | the one the install is in: only its holder can make the token                                            |
| an account token         | [step 3](../start/by-hand.md#the-steps) makes one; `npx poplin doctor --repair --help` lists its permissions |
| the domain, or none      | the domain your dashboard is under; none for an address that ends in `workers.dev`                       |

The token is asked for without being shown. A program gives it in the variable `POPLIN_INSTALL_TOKEN`, or pipes it with `--token-stdin`. It is used for the run and stored nowhere.

## What it does

```text
$ npx poplin doctor --repair --domain example.com
Account token (not shown):
looking for an install ... found: poplin 0.1.0, at https://poplin.example.com
left      DNS record            poplin.example.com
made      Access application    poplin: poplin.example.com, *-p-poplin.example.com
made      Access policy         poplin logins
left      Key                   poplin kept key
the install is mended.
Your dashboard: https://poplin.example.com
```

| Row starts with        | It means                                                              |
| ---------------------- | --------------------------------------------------------------------- |
| `left`                 | the piece is as it should be                                          |
| `made`, `changed`      | the piece was missing or differed, and is mended                      |
| `left out`             | an optional piece that is not made: the row says why                  |
| `stopped`              | the token lacks a permission the row names, or a person must act first |
| `failed`, `not run`    | Cloudflare refused the piece, or an earlier one stopped the run       |

The pieces are the ones the [Domain screen](../dashboard/domain.md) lists, and the login is mended to the users the install has stored. A run that left something undone exits with 1: add what its rows name, and run it again.

## One more user

`--add-user` is for a person whose mailbox is gone, so that no login code reaches them.

```text
made      User                  new@example.com
```

| What happens                         | When                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| the email is written into the login  | first, with your token                                                    |
| the email is stored as a user        | only after Cloudflare took that write                                     |
| Activity gets an entry               | with the stored user: `Changed the settings`, by `doctor-repair@poplin.invalid` |
| nothing is stored                    | for a token that lacks Access: Apps and Policies: Edit; the row names it  |

No user is taken away. The new user logs in at the dashboard with a code sent to that email.

## When it stops

| It says                                             | Do                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `No install is in this account`                     | check that the token is of the account the install is in             |
| `An install was started in this account and not finished` | run the command the line names                                  |
| `The install here is under the domain ...`, or `has no domain` | give the option the line names                             |
| `The install's records are not at the schema of this poplin` | run `npx poplin@latest doctor --repair`                      |
| `the install has stored no users yet`               | ask the address the row names once, then run it again                 |
