---
title: Domain
order: 30
---

# Domain

What the dashboard's Domain screen shows and does, the last check it keeps, and the optional rules a token can switch on; the first Repair is step 4 of [By hand](../start/by-hand.md#the-steps).

After the first login, Domain does what the setup page did.

| On the screen       | What it is                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| the line at the top | how the domain stands, such as `Nothing to repair` or `2 to repair`, then the last run and who made it; `Not checked yet` before any run |
| Check               | lists every piece and changes nothing                                                          |
| Repair              | makes every piece match again                                                                  |
| the table           | one row per piece, in the columns Piece, State, and Detail                                     |

Check and Repair each open a dialog that asks for a token:

| Step | In the dialog | Do                                                                                                  |
| ---- | ------------- | --------------------------------------------------------------------------------------------------- |
| 1    | Make a token  | press Open the token form, or take the token you kept from [step 3](../start/by-hand.md#the-steps)  |
| 2    | Paste it      | paste the token into the box Token, then press the dialog's Check or Repair                         |

## The last check of the domain

```text
$ poplin doctor
ok  domain    The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.
```

| Question          | Answer                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What is kept      | the last Check or Repair of the Domain screen: when it ran, who ran it, and how each piece stood            |
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
| Zone      | Bot Management  | Edit      | blocks AI crawlers on the whole domain, as the setting `block_bots` says    | poplin switches no such block on                                                            |

| Step | Where                              | Do                                                                          |
| ---- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1    | Cloudflare, My Profile, API Tokens | in the token's menu choose Edit, or Roll when you no longer have its text   |
| 2    | the token's form                   | for each row above, press Add more and choose in its three boxes; then save |
| 3    | the dashboard, Domain              | press Repair, paste the token, and press Repair in the dialog               |

A row that said `optional` now says what Repair did, such as `created`.

Three settings save without these permissions. The dashboard has them in Settings, under Visitors. What Cloudflare does for each starts once you press Repair, in step 3 of this table.

| Setting                  | In the dashboard     |
| ------------------------ | -------------------- |
| `search_engines_allowed` | Allow search engines |
| `outside_pages`          | Allow embedding      |
| `block_bots`             | Block bots           |
