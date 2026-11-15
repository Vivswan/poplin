---
title: Domain
order: 30
---

# Domain

What the dashboard's Domain screen shows and does, the last check it keeps, and the optional rules an account token can switch on; the first Repair is step 4 of [By hand](../start/by-hand.md#the-steps).

After the first login, Domain does what the setup page did.

| On the screen       | What it is                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| the line at the top | how the domain stands, such as `Nothing to repair` or `2 to repair`, then the last run and who made it; `Not checked yet` before any run |
| Check               | lists every piece and changes nothing                                                          |
| Repair              | fixes every piece that needs it                                                                |
| the table           | one row per piece, in the columns Piece, State, and Detail                                     |

After a user is added or removed, under Access or [another way](settings.md#add-a-user), the line says `Users changed. Press Repair.` until a Repair: Cloudflare's login page keeps its own list of users. Where a piece is to repair or was not done, the line counts those first.

Check and Repair each open a dialog that asks for an account token:

| Step | In the dialog         | Do                                                                                                         |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | Make an account token | press Open the account token form, or take the token you kept from [step 3](../start/by-hand.md#the-steps) |
| 2    | Paste it              | paste the token into the box Account token, then press the dialog's Check or Repair                        |

## The last check of the domain

```text
$ poplin doctor
ok  domain    The login for private sites is missing or changed, so private sites may be locked. Open Domain and press Repair.
```

| Question          | Answer                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What is kept      | the last Check or Repair of the Domain screen: when it ran, who ran it, and how each piece stood            |
| What is not kept  | the token, which is used for the one request                                                             |
| What the row says | the most serious thing to act on: the login, then records and routes, changed users, any other piece     |
| When there is one | only when that run left something to act on, and only for an admin; `domain` under `--json` has the same |
| After 30 days     | the row only asks for a new Check, or a Repair after changed users: no look at the domain between runs   |
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
| `search_engines_allowed` | Let search engines in |
| `outside_pages`          | Allow embedding      |
| `block_bots`             | Block bots           |

## Optional: an email when charges reach 1 dollar

One more permission on the account token lets Repair make a budget alert in your Cloudflare account. Add it the same way, in the three steps above.

| First box | Second box    | Third box | With it, Cloudflare                                                                              | Without it         |
| --------- | ------------- | --------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| Account   | Notifications | Edit      | emails your first user when the account's usage charges for the billing period reach 1 US dollar | Repair makes no alert, and leaves one it made |

The alert is named `poplin: usage charges reached 1 dollar`, under Notifications in Cloudflare. It counts the whole account's charges, and it stops nothing. [Limits and cost](limits-and-cost.md#what-can-cost-money) says what can cost money.
