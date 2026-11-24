---
title: How it is built
order: 30
---

# What the install is made of

What an install puts in your Cloudflare account; `npx poplin install cloudflare` makes each piece and prints a row for it, as [Install](../start/install.md#4-read-what-it-made) shows, and the optional part is in [Domain](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers).

| In your Cloudflare account | Does                                                           | Its rows                                  |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| one Worker                 | serves every site, the dashboard, the login, and the API       | `Worker`, `Cron trigger`, `Worker variable`  |
| one R2 bucket              | holds every site's files                                       | `R2 bucket`                               |
| one D1 database            | holds the list of sites, the users, and the settings           | `D1 database`                             |
| two Access applications    | the login screen in front of the dashboard and private sites, and the open path of the API | `Access application`, `Access policy`                      |
| three login methods        | how a user passes that screen: the Cloudflare account, a code Cloudflare mails, and a passkey. They are the account's own | `Login method`                    |
| the account's subdomain    | its name at `workers.dev`, which [Cloudflare requires](../start/install.md#2-run-the-command). It is the account's own: the install makes it only where there is none | `Account subdomain` |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | `DNS record`, `Worker route`              |
| two keys                   | let the install update and repair itself, and sign uploads     | `Key`, `Upload key`                       |
| one Workflow               | finishes a copy too large for one request                      | `Workflow`                                |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | the optional part                         |

```text
the release     poplin's website names the newest version and the digest of its manifest, which states each file's
the files       fetched from the release's page; each digest and size is checked before anything is uploaded
the Worker      the first upload of those files: the same upload an update makes later
```

An install [without a domain](../start/without-a-domain.md) has no DNS record, no route, and no rule. The command makes two small Workers in their place, the forwarders: each gives the sites of one kind a hostname and hands every request to the Worker.
