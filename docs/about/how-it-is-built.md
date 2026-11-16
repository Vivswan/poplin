---
title: How it is built
order: 30
---

# What the install is made of

What an install puts in your Cloudflare account; the steps it names are those of [By hand](../start/by-hand.md#the-steps), and the optional part is in [Domain](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers).

| In your Cloudflare account | Does                                                           | Made by           |
| -------------------------- | -------------------------------------------------------------- | ----------------- |
| one Worker                 | serves every site, the dashboard, the login, and the API       | step 2            |
| one R2 bucket              | holds every site's files                                       | step 2            |
| one D1 database            | holds the list of sites, the logins, and the settings          | step 2            |
| an Access application      | the login screen in front of the dashboard and private sites   | step 4            |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | step 4            |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | the optional part |

An install [without a domain](../start/without-a-domain.md) has no DNS record, no route, and no rule. Its step 4 makes two small Workers in their place, the forwarders: each gives the sites of one kind a hostname and hands every request to the Worker.
