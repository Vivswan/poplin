---
title: Without a domain
order: 25
---

# Install poplin without a domain

What differs when an install has no domain: its addresses, its account token, and what the command prints. The steps are those of [Install](install.md), with `--no-domain`. [Your agent can run them with you](with-an-agent.md) too.

```text
you have:  a Cloudflare account

you run:   npx poplin install cloudflare --no-domain

you get:   https://poplin.your-name.workers.dev                               your dashboard
           https://poplin-sites.your-name.workers.dev/report--k3f9x2ab71qz/   an unlisted or public site
           https://poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/ a private site
```

`your-name` stands for the word of your own account in the address Cloudflare gives its Workers.

**The open sites share one browser origin, and so do the private sites: publish only pages you trust.** [Between sites](../about/between-sites.md#without-a-domain) says what a page of one site can do to another.

## What differs from an install under a domain

| Thing                         | Under a domain                           | Without a domain                                              |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| a site's address              | a hostname of its own                    | a path on one of two hostnames                                |
| a link inside a site          | any link works                           | a link that starts with `/` leaves the site. [Publish](../sites/publish.md) refuses one in a page's `href`, `src`, or `srcset`: write `css/site.css`, not `/css/site.css` |
| two sites in one browser      | kept apart                               | the open sites trust each other, and so do the private sites  |
| a public name                 | `docs-page.example.com`                  | `poplin-sites.your-name.workers.dev/docs/`                    |
| junk traffic                  | stopped by Cloudflare's rules first      | no rule runs first: the Worker's own limits per visitor and per site count every request |
| the `block_bots` setting      | blocks AI crawlers on the domain         | does nothing: it needs a domain                               |
| the account token             | ten permissions, account and domain      | six permissions, account alone                                |
| what you need                 | a domain that is Active on the account   | the account's `workers.dev` subdomain, of 36 characters at most |

## The steps

The five steps of [Install](install.md), each with what differs here:

| Step of Install                  | Here                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| 1. Switch on what no command can | all three rows of its table, the account's subdomain included        |
| 2. Run the command               | press Enter at the first question, or add `--no-domain`              |
| 3. Make the account token        | [the other link, and six permissions](#the-account-token)            |
| 4. Read what it made             | [forwarders in place of records and routes](#what-it-prints)         |
| 5. Log this computer in          | the same question and the same page, at [your own address](#log-in)  |

## What you need

The table of [Install](install.md#what-you-need), without the row of the domain. The account's subdomain is the `your-name` of every address above.

## The command

At the first question, press Enter:

```text
Your own domain (example.com), or Enter for none:
```

Or give the answer as an option, and the question is not asked:

```sh
npx poplin install cloudflare --no-domain
```

## The account token

```text
The account token needs 6 permissions, for this account:
  Access: Apps and Policies: Edit, Workers Scripts: Edit, ...
This link opens the form with them chosen:
  https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...
```

The link opens Cloudflare's form with five rows filled, and none of a domain. The install needs six permissions: the link cannot choose Workers R2 Storage, so add that one yourself.

[Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_api_tokens%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&name=poplin%20setup)

| On the form       | Do                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------ |
| the five rows     | leave them                                                                           |
| Add more          | press it, and choose in the new row's three boxes: Account, Workers R2 Storage, Edit |
| Account Resources | choose Include, then your account                                                    |
| every other field | leave it as it is                                                                    |
| the bottom        | press Continue to summary, then Create Token                                         |
| the next page     | the token is shown once: copy it, paste it at the command's question, and press Enter. Its letters do not show |

No permission is optional here: the optional ones are all of a domain.

## What it prints

```text
looking for an install ... none
made      R2 bucket             poplin-sites
made      D1 database           poplin
made      Worker                poplin, runs 0.1.0
made      Worker address        on: poplin.your-name.workers.dev
made      Forwarder             poplin-private: https://poplin-private.your-name.workers.dev (private sites)
made      Forwarder             poplin-sites: https://poplin-sites.your-name.workers.dev (unlisted and public sites)
made      Access application    poplin: poplin.your-name.workers.dev, poplin-private.your-name.workers.dev
made      Key                   poplin kept key
waiting for https://poplin.your-name.workers.dev to answer
https://poplin.your-name.workers.dev answers
poplin 0.1.0 is installed.
Your dashboard: https://poplin.your-name.workers.dev
The token was used for this run and is stored nowhere. You can delete it at Cloudflare.
Log this computer in now?
```

The sample shows a few of the rows. Two pieces are of this kind alone:

| Piece          | It is                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Worker address | the address Cloudflare gives the Worker, switched on: your dashboard answers there      |
| Forwarder      | a small Worker that gives the sites of one kind their hostname and hands every request on |

The Access application is Cloudflare's login in front of the dashboard and of every private site.

## Log in

The command's last question logs this computer in, as [step 5 of Install](install.md#5-log-this-computer-in-and-check) shows: the pages in your browser are the same. After a no, or on another computer, the address after `--server` is the dashboard's, as the command printed it:

```sh
npx poplin login --server https://poplin.your-name.workers.dev
npx poplin doctor
```
