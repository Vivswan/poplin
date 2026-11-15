---
title: Domain
order: 30
---

# The Domain tab

What the dashboard's Domain tab does, the last check it keeps, and the optional rules a token can switch on; the first Repair is step 4 of [By hand](../start/by-hand.md#the-steps).

After the first login, the Domain tab does what the setup page did. Check lists every piece and changes nothing. Repair makes them match again.

## The last check of the domain

```text
$ poplin doctor
ok  domain    The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.
```

| Question          | Answer                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What is kept      | the last Check or Repair of the Domain tab: when it ran, who ran it, and how each piece stood            |
| What is not kept  | the token, which is used for the one request                                                             |
| What the row says | the most serious thing to act on: the login first, then records and routes, then any other piece         |
| When there is one | only when that run left something to act on, and only for an admin; `domain` under `--json` has the same |
| After 30 days     | the row only asks for a new Check: the install does not look at the domain between runs                  |
| Optional pieces   | a rule that was left out, or that only lacks an optional right, raises no row                            |

## Optional: block junk traffic and crawlers

The install works without this part. Three more permissions on the token let Cloudflare stop unwanted requests before they reach the Worker. Add any of them, on any day.

| First box | Second box      | Third box | With it, Cloudflare                                                           | Without it                                                                                  |
| --------- | --------------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Zone      | Zone WAF        | Edit      | stops verified bots, scanner paths, pages of other domains, and floods        | they reach the Worker. It refuses pages of other domains while `outside_pages` is `blocked` |
| Zone      | Single Redirect | Edit      | sends http to https                                                           | the Worker sends the same redirect                                                          |
| Zone      | Bot Management  | Edit      | blocks AI crawlers on the whole domain, as the Domain tab's `block_bots` says | poplin switches no such block on                                                            |

| Step | Where                              | Do                                                                          |
| ---- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1    | Cloudflare, My Profile, API Tokens | in the token's menu choose Edit, or Roll when you no longer have its text   |
| 2    | the token's form                   | for each row above, press Add more and choose in its three boxes; then save |
| 3    | the dashboard, Domain              | paste the token and press Repair                                            |

A row that said `not set up: optional` now says what Repair did, such as `created`. The Domain tab's three settings, `outside_pages`, `search_engines_allowed`, and `block_bots`, save without these permissions. What Cloudflare does for each starts once you press Repair, in step 3 of this table.
