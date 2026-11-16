---
title: Without a domain
order: 25
---

# Install poplin without a domain

An install at the address Cloudflare gives a Worker, which needs no domain; [By hand](by-hand.md) is the install under a domain of your own. [Your agent can lead these steps](with-an-agent.md) too.

```text
before:  a Cloudflare account

after:   https://poplin.your-name.workers.dev                               your dashboard
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
| the account token             | nine permissions, account and domain     | five permissions, account alone                               |
| installing with OpenTofu      | the module makes it                      | the module makes an install under a domain alone              |

## What you need

The table of [By hand](by-hand.md#what-you-need), without the domain. Cloudflare asks for a payment method before it switches on R2 and Zero Trust; [What can cost money](../upkeep/cost/what-can-cost-money.md) says when it is charged.

## The steps

Steps 1, 2, and 6 are the ones of [By hand](by-hand.md#the-steps). Three differ.

3. **Make a Cloudflare API token.** The link opens Cloudflare's form with five permissions chosen, and none of a zone.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_api_tokens%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&name=poplin%20setup)

   | On the form       | Do                                                                               |
   | ----------------- | -------------------------------------------------------------------------------- |
   | the five rows     | leave them                                                                       |
   | Account Resources | choose Include, then your account                                                |
   | every other field | leave it as it is                                                                |
   | the bottom        | press Continue to summary, then Create Token                                     |
   | the next page     | The token is shown once: paste it into a note now; you need it in the next step. |

4. **Finish on the setup page.** Open the Worker's address from step 2, the one ending in `workers.dev`. Choose No domain, fill in two boxes, and press Repair once.

   | Box           | Put in                                             |
   | ------------- | -------------------------------------------------- |
   | Your email    | an email whose inbox you can read: the first login |
   | Account token | the token of step 3                                |

   The page lists what it made, with the address of your dashboard and of your sites:

   ```text
   11 repaired
   The login is ready. Open your dashboard and log in: https://poplin.your-name.workers.dev

   Piece                State     Detail
   Forwarder            created   poplin-private: https://poplin-private.your-name.workers.dev (private sites)
   Forwarder            created   poplin-sites: https://poplin-sites.your-name.workers.dev (unlisted and public sites)
   Access application   created   poplin: poplin.your-name.workers.dev, poplin-private.your-name.workers.dev
   ```

   | Piece              | It is                                                                                   |
   | ------------------ | --------------------------------------------------------------------------------------- |
   | Forwarder          | a small Worker that gives your sites an address of their own and hands every request on |
   | Access application | Cloudflare's login in front of the dashboard and of every private site                  |

   The setup page must be opened at the Worker's own `workers.dev` address: the install reads the name of your account from it.

   From a terminal, the same run is `poplin setup` with no `--domain`:

   ```sh
   export POPLIN_SETUP_TOKEN="paste the account token here"
   npx poplin setup --server https://poplin.your-name.workers.dev --login you@example.com
   ```

5. **Open your dashboard and log in.** It is at the Worker's address, the one the setup page was on. Cloudflare's login asks for your email and sends a code to its inbox.

   ```text
   https://poplin.your-name.workers.dev
   ```

In step 6, the address after `--server` is that same address:

```sh
npx poplin login --server https://poplin.your-name.workers.dev
npx poplin doctor
```
