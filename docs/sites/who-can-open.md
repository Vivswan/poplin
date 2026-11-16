---
title: Who can open a site
order: 20
---

# Who can open a site

The three kinds of access, the address each gives a site, and what a visitor sees; [Security](../about/security.md) says what each access protects.

**Who can open what you publish:**

| Access                | Who can open it            | Address                                                               | Set it with                                  |
| --------------------- | -------------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| private (the default) | only you, after a login    | `report--k3f9x2ab71qz-p-poplin.example.com`                           | `npx poplin set report--k3f9x2ab71qz --private` |
| unlisted              | anyone who has the address | `report--k3f9x2ab71qz-u-poplin.example.com`                           | `poplin set report--k3f9x2ab71qz --unlisted` |
| public                | everyone                   | the unlisted one, and a name the site claims: `docs-page.example.com` | `poplin set report--k3f9x2ab71qz --public`   |

| Example                                                 | Does                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `poplin set report--k3f9x2ab71qz --public`              | public at its own name: `report-page.example.com`      |
| `poplin set report--k3f9x2ab71qz --public --public-name docs` | public at another name: `docs-page.example.com`  |

Every other example runs the same way, with `npx` before `poplin`. A change of access prints the site's address, and the old one when it changed:

```text
$ npx poplin set report--k3f9x2ab71qz --unlisted
unlisted  report--k3f9x2ab71qz
https://report--k3f9x2ab71qz-u-poplin.example.com
address changed: https://report--k3f9x2ab71qz-p-poplin.example.com is now https://report--k3f9x2ab71qz-u-poplin.example.com

$ npx poplin set report--k3f9x2ab71qz --public --public-name docs
public  report--k3f9x2ab71qz  public name "docs"
https://docs-page.example.com
```

- **You** is every user of the install: yourself, and anyone [Add a user](../dashboard/access.md#add-a-user) adds.
- **To or from private changes the address:** the letter before `-poplin` turns from `p` to `u`, or back. The old address sends visitors on.
- **A public site keeps its unlisted address too.**
- **Leaving public gives the public name up.** That address stops working.
- **A public name** follows [the rules of a name](publish.md#publish). One that another site holds is refused with `name_taken`.
- **Every public name's address ends in the install's public word**, `-page` here. No command changes it: [Security](../about/security.md#the-three-access-states) says where it comes from.

**The address:**

```text
report--k3f9x2ab71qz-p-poplin.example.com
|       |            | |
|       |            | the marker: always -poplin
|       |            the letter: p for a private site, u for an unlisted or a public one
|       the id: 12 random characters, hard to guess; it is the link
the name: 3 to 40 characters; several sites may share it

docs-page.example.com
|    |
|    the public word: page
the public name: a name one public site claims
```

| What changes                           | What happens to the address                           |
| -------------------------------------- | ----------------------------------------------------- |
| private to unlisted or public, or back | the letter changes; the old address sends visitors on |
| unlisted to public, or back            | nothing; a public site also answers at its public name |
| a rename                               | the `-poplin` address carries the new name; every older address still opens the site, and a public name stays |
| new content, a rollback                | nothing                                               |

Only the id finds a site. Any name before it, or none, opens the same site: `k3f9x2ab71qz-u-poplin.example.com` works too. Commands take the label without the letter: `report--k3f9x2ab71qz`.

```text
poplin new-link report--k3f9x2ab71qz   ->  the site gets a new id; the old address stops at once
```

The owner's private page that lists every site is the dashboard, at `poplin.example.com`. [Security](../about/security.md#what-unlisted-covers) says what an unlisted site's address covers.

## What a visitor sees

| A visitor opens                                  | Sees                                         |
| ------------------------------------------------ | -------------------------------------------- |
| an unlisted or a public site                     | the site                                     |
| a private site, logged in as you                 | the site                                     |
| a private site, not logged in                    | the login                                    |
| a page a site does not have                      | the `404.html` at the site's root; `Not found` for a site without one |
| `/favicon.ico` of a site that has none           | poplin's icon, so the browser's tab shows it; publish an empty `favicon.ico` to show none |
| the `-poplin` address of a deleted or expired site, or one from before a new link | the login; `Not found` once logged in |
| a public name no site holds                      | `Not found`                                  |
| any site, too often in a minute                  | `Too many requests. Try again in 60 seconds.` |
| any site, once the day's free allowance of the database for reading is used up | `This site is paused until midnight UTC.` |

A site whose files without an extension have over 16,384 characters of names between them answers `Not found` for a missing page without an extension, even when it has a `404.html`.
