---
title: Domain
order: 50
---

# Domain

What the dashboard's Domain screen shows and does, the last check it keeps, and the optional rules at Cloudflare with what makes each; the first Repair is step 4 of [By hand](../start/by-hand.md#the-steps).

After the first login, Domain does what the setup page did.

| On the screen       | What it is                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| the line at the top | how the domain stands, such as `Nothing to repair` or `2 to repair`, then the last run and who made it; `Not checked yet` before any run |
| Check               | lists every piece and changes nothing                                                          |
| Repair              | fixes every piece that needs it                                                                |
| the table           | one row per piece, in the columns Piece, State, and Detail                                     |

Cloudflare's login page keeps its own list of users. After a user is added or removed, under Access or [another way](access.md#add-a-user), poplin writes the new list there by itself, with [the key it keeps](../about/security.md#the-kept-key).

On an install that holds no key, the line says `Users changed. Press Repair.` until a Repair. Where a piece is to repair or was not done, the line counts those first.

A saved `search_engines_allowed` or `outside_pages` is written into its WAF rule the same way, with the key, and makes a rule the domain lacks: [which rule is made when](#optional-block-junk-traffic-and-crawlers). `block_bots`, the DNS records, the routes, and the redirect change only when you press Repair.

Check and Repair each open a dialog that asks for an account token:

| Step | In the dialog         | Do                                                                                                         |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | Make an account token | press Open the account token form, or take the token you kept from [step 3](../start/by-hand.md#the-steps) |
| 2    | Paste it              | paste the token into the box Account token, then press the dialog's Check or Repair                        |

Three rows are Cloudflare's login:

| Piece                | It is                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Access application` | the login in front of every address of the dashboard and of every private site                                     |
| `Access policy`      | who that login lets in: your users                                                                                 |
| `Access open paths`  | the two paths of the dashboard's address that pass the login: `/api`, where a caller gives its own token, and `/setup` |

The row `Key` is the key poplin keeps at Cloudflare. Repair makes one where the install has none, or one Cloudflare no longer takes: [The kept key](../about/security.md#the-kept-key).

## Without a domain

On an install [without a domain](../start/without-a-domain.md) the screen is the same, with other rows. Its first line says `No domain: your sites answer at Cloudflare's free address.`

| Piece              | It is                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Forwarder          | one for the unlisted and public sites, one for the private sites: its row names the address |
| Access application | the login in front of the dashboard and of every private site         |
| Access policy      | who may log in: your users only                                        |
| Access open paths  | the paths a program reaches without the login                          |
| Worker variable    | what the Worker reads at its start                                     |
| Key                | [the key poplin keeps](../about/security.md#the-kept-key)              |
| D1 database        | the database of the install                                            |

It has no DNS record, route, or rule, and its account token needs no permission of a zone. The optional parts below are of an install under a domain.

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

The install works without this part. Cloudflare can stop unwanted requests before they reach the Worker, with five rules:

| Rule                     | Stops                                                         | Made                                                                                      |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| the bots rule            | verified bots and scanner paths                               | by a Repair with Zone WAF: Edit, or when one of two settings is saved                     |
| the outside pages rule   | pages of other domains, while `outside_pages` is `blocked`    | the same two ways                                                                         |
| the rate rule            | floods                                                        | by a Repair with Zone WAF: Edit                                                           |
| the redirect             | plain http, which it sends to https                           | by a Repair with Single Redirect: Edit                                                    |
| the block of AI crawlers | AI crawlers on the whole domain, as `block_bots` says         | by a Repair with Bot Management: Edit                                                     |

**A saved setting makes two of them.** On an install that holds its key, saving `search_engines_allowed` or `outside_pages` writes the bots rule, and the outside pages rule while `outside_pages` is `blocked`. A rule the domain lacks is made, and one its plan has no room for is left out.

No permission is added for it, and no Repair is pressed.

| An install                         | Holds its key                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| set up on the setup page           | from its first Repair: Account API Tokens: Edit is one of the nine permissions, and the key holds the right to write WAF rules whatever else the token held |
| made by the OpenTofu module        | only after a Repair on this screen. Until then its rules are the module's, written at an apply        |

An install [without a domain](../start/without-a-domain.md) has none of the five rules: no Repair and no saved setting makes one.

Three more permissions on the token let Repair make the rules. Add any of them, on any day.

| First box | Second box      | Third box | With it, Repair makes                                         | Without it                                                                                  |
| --------- | --------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Zone      | Zone WAF        | Edit      | the bots rule, the outside pages rule, and the rate rule      | Repair makes none of the three. Requests no rule stops reach the Worker, which refuses pages of other domains while `outside_pages` is `blocked` |
| Zone      | Single Redirect | Edit      | the redirect                                                  | the Worker sends the same redirect                                                          |
| Zone      | Bot Management  | Edit      | the block of AI crawlers                                      | poplin switches no such block on                                                            |

| Step | Where                              | Do                                                                          |
| ---- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1    | Cloudflare, My Profile, API Tokens | in the token's menu choose Edit, or Roll when you no longer have its text   |
| 2    | the token's form                   | for each row above, press Add more and choose in its three boxes; then save |
| 3    | the dashboard, Domain              | press Repair, paste the token, and press Repair in the dialog               |

A row that said `optional` now says what Repair did, such as `created`.

Three settings save without these permissions. The dashboard has them in Settings, under Visitors. What Cloudflare does for `block_bots` starts once you press Repair, in step 3 of this table.

| Setting                  | In the dashboard              |
| ------------------------ | ----------------------------- |
| `search_engines_allowed` | Let search engines in         |
| `outside_pages`          | Let outside pages embed sites |
| `block_bots`             | Block bots                    |

## Optional: an email when charges reach 1 dollar

One more permission on the account token lets Repair make a budget alert in your Cloudflare account. Add it the same way, in the three steps above.

| First box | Second box    | Third box | With it, Cloudflare                                                                              | Without it         |
| --------- | ------------- | --------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| Account   | Notifications | Edit      | emails your first user when the account's usage charges for the billing period reach 1 US dollar | Repair makes no alert, and leaves one it made |

The alert is named `poplin: usage charges reached 1 dollar`, under Notifications in Cloudflare. It counts the whole account's charges, and it stops nothing. [Limits and cost](../upkeep/cost/what-can-cost-money.md) says what can cost money.
