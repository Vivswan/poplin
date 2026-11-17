---
title: Domain
order: 50
---

# Domain

What the dashboard's Domain screen shows and does, the last check it keeps, and the optional rules at Cloudflare with what makes each. An install needs no Repair: [the command](../start/install.md#4-read-what-it-made) makes every piece an install needs.

| On the screen       | What it is                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| the line at the top | how the domain stands, such as `Nothing to repair` or `2 to repair`, then the last run and who made it. The count is of everything on the screen a Repair ends: the rows that need repair, and each problem over the table that asks for a Repair |
| the line after a Repair | counts what the Repair ended the same way, such as `3 repaired`: the rows it changed, and each problem that asked for it. Such a problem is named under the line: `Repaired: A change of the users did not reach the login page` |
| Check               | lists every piece and changes nothing                                                          |
| Repair              | fixes every piece that needs it                                                                |
| the table           | one row per piece, in the columns Piece, State, and Detail                                     |

With no login, the same repair runs from a terminal, as `npx poplin doctor --repair`: [I cannot log in](../fix/cannot-log-in.md).

## Check needs no token

An install that holds [its key](../about/security.md#the-kept-key) reads every piece with it. The screen shows the pieces with no press and no token:

| You                                                    | The screen                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| open Domain, and the last check is under 10 minutes old | shows that check                                                       |
| open Domain, and the last check is older, or there is none | shows the last check at once, checks again by itself, then shows the new one |
| press Check                                            | checks again, with no dialog                                           |
| press Repair                                           | opens the dialog that asks for an account token                        |

The check the screen opens on is a remembered one. Its State column has five words of its own:

| State          | Means                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| `Present`      | the piece stood as it should                                                           |
| `Needs repair` | the piece was missing, or differed: press Repair. Detail of a remembered row ends in `missing or changed`: the install keeps no more of why |
| `Optional`     | an optional piece the run left as it is: Detail says why. Nothing is wrong, and the install works without it |
| `Failed`       | the run could not read the piece, or could not change it. Detail says why, such as a permission that is lacking |
| `Not run`      | the run did not get to the piece: a piece it rests on stopped the run, or was not read |

A run you press writes its own words there: `Missing` and `Differs` for a piece to repair, and `Created`, `Changed`, or `Removed` for what a Repair did. The screen writes each word with a capital, and the tables below write them small.

No other screen starts a check. A check sends Cloudflare requests that only read: fewer where a piece is missing, more where a list fills more than one page or a request is sent again. A check the screen ran by itself writes no line into Activity, and a pressed one writes one.

Five rows read otherwise in a check made with the key:

| Row                                  | It says                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| a piece the key has no permission to read | `failed`, with the permission and `Press Repair.` The other pieces are still read, and Repair makes a key with every permission |
| `D1 database`                        | `present`, with `the install is running on it`. The key holds no permission for a database, so Cloudflare is not asked |
| an optional piece that is not set up | `optional`, with the permission that switches it on                                                             |
| `Key`                                | `present` while Cloudflare takes the key, and `differs` once Cloudflare refused it or a piece lacked a permission    |
| `Upload key`                         | `present` where the install holds one, and `missing` where it holds none. The key reads no token of the account, so Cloudflare is not asked |

An install that holds no key says `Not checked yet` before any run, and its Check opens the same dialog as Repair. It holds a key after a Repair on this screen.

Cloudflare's login page keeps its own list of users. After a user is added or removed, under Access or [another way](access.md#add-a-user), poplin writes the new list there by itself, with [the key it keeps](../about/security.md#the-kept-key).

On an install that holds no key, the line says `Users changed. Press Repair.` until a Repair. Where a piece is to repair or was not done, the line counts those first, such as `2 to repair` or `2 not done`.

A saved `search_engines_allowed` or `outside_pages` is written into its WAF rule the same way, with the key, and makes a rule the domain lacks: [which rule is made when](#optional-block-junk-traffic-and-crawlers). `block_bots`, the DNS records, the routes, and the redirect change only when you press Repair.

## Repair asks for an account token

The key may not change a DNS record, a route, or a redirect, so Repair opens a dialog:

| Step | In the dialog         | Do                                                                                                         |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | Make an account token | press Open the account token form, or take the token you kept from [step 3](../start/install.md#3-make-the-account-token) |
| 2    | Paste it              | paste the token into the box Account token, then press the dialog's Repair                                 |

Three rows are Cloudflare's login:

| Piece                | It is                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Access application` | the login in front of every address of the dashboard and of every private site                                     |
| `Access policy`      | who that login lets in: your users                                                                                 |
| `Access open paths`  | the one path of the dashboard's address that passes the login: `/api`, where a caller gives its own token |

The row `Key` is the key poplin keeps at Cloudflare. Repair makes one where the install has none, or one Cloudflare no longer takes: [The kept key](../about/security.md#the-kept-key).

The row `Upload key` is the key that sends a publish's files straight to the bucket. Repair makes it the same way: [The upload key](../about/security.md#the-upload-key). An install without it still publishes, through the Worker.

The row `Workflow` is what runs the install's background jobs: the copy of a site of more than 112 files. Repair makes it where the account has none. Until then a copy of such a site is not made.

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
| Upload key         | [the key that sends files straight to the bucket](../about/security.md#the-upload-key) |
| Worker logs        | whether Cloudflare keeps the Worker's lines, as [the setting](activity.md#switch-the-logs-off) says: `kept` or `not kept` |
| D1 database        | the database of the install                                            |
| Budget alert       | [the email when charges reach 1 dollar](#optional-an-email-when-charges-reach-1-dollar): `optional` until the key or a Repair made it |
| Workflow           | what runs the install's background jobs: the copy of a large site      |

It has no DNS record, route, or rule, and its account token needs no permission of a zone. The optional rules below are of an install under a domain alone. The optional email is of both kinds.

## The last check of the domain

```text
$ poplin doctor
ok  domain    The login for private sites is missing or changed, so private sites may be locked. Run poplin doctor --repair.
```

| Question          | Answer                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| What is kept      | the last Check or Repair of the Domain screen, a check the screen ran by itself among them: when it ran, who ran it, and how each piece stood |
| What is not kept  | the token, which is used for the one request                                                             |
| What the row says | the most serious thing to act on: the login, then records and routes, changed users, any other piece     |
| When there is one | only when that run left something to act on, and only for an admin; `domain` under `--json` has the same |
| After 30 days     | the row only asks for a new Check, or a Repair after changed users: no look at the domain between runs   |
| Optional pieces   | a rule that was left out, or that only lacks an optional permission, raises no row                            |

## Optional: block junk traffic and crawlers

The install works without this part. Cloudflare can stop unwanted requests before they reach the Worker, with five rules:

| Rule                     | Stops                                                         | Made                                                                                      |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| the bots rule            | verified bots, crawlers among them, and scanner paths         | by a Repair with Zone WAF: Edit, or when one of two settings is saved                     |
| the outside pages rule   | pages of other domains, while `outside_pages` is `blocked`    | the same two ways                                                                         |
| the rate rule            | floods                                                        | by a Repair with Zone WAF: Edit                                                           |
| the redirect             | plain http, which it sends to https                           | by a Repair with Single Redirect: Edit                                                    |
| the block of AI crawlers | AI crawlers on the whole domain, as `block_bots` says         | by a Repair with Bot Management: Edit                                                     |

**An assistant and a link preview pass the bots rule.** Cloudflare gives each verified bot a kind, and the rule reads it:

| Kind of verified bot                                                                  | The bots rule                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `AI Assistant`: opens one page when a person asks, as a chat assistant's fetch does    | lets it through                                       |
| `Page Preview`: fetches a shared link, as a chat app does to show its preview card    | lets it through                                       |
| `Search Engine Crawler`                                                               | lets it through while `search_engines_allowed` is on  |
| any other: a crawler that reads sites in bulk to train a model or for an AI search    | stops it                                              |

A bot the rule lets through reaches the Worker as any visitor does: a private site still shows it the login page alone.

**A saved setting makes two of them.** On an install that holds its key, saving `search_engines_allowed` or `outside_pages` writes the bots rule, and the outside pages rule while `outside_pages` is `blocked`. Saving `outside_pages` as `allowed` removes the outside pages rule and keeps the bots rule.

A rule the domain lacks is made, and one its plan has no room for is left out. No permission is added for it, and no Repair is pressed.

An install holds its key from the run that made it: Account API Tokens: Edit is one of the ten permissions, and the key holds the permission to write WAF rules whatever else the token held.

An install [without a domain](../start/without-a-domain.md) has none of the five rules: no Repair and no saved setting makes one.

Four permissions on the token are optional. Three of them let Repair make the rules, and [the fourth](#optional-an-email-when-charges-reach-1-dollar) an email about charges at once. Add any of them, on any day.

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

Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar. The install makes that budget alert by itself, with [the key it keeps](../about/security.md#the-kept-key), under a domain and without one:

| When                                   | The install                                                         |
| -------------------------------------- | ------------------------------------------------------------------- |
| a user is added or removed             | makes the alert where the account has none, and sends it to the first user |
| the first clean-up run of each UTC day | the same                                                            |
| it holds no key, or one Cloudflare no longer takes | makes none: press Repair, which makes a key             |

The fourth optional permission on the account token lets Repair make the alert at once. It is the one optional permission of an install without a domain. Add it the same way, in the three steps above.

| First box | Second box    | Third box | With it, Repair                                      | Without it                                                        |
| --------- | ------------- | --------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Account   | Notifications | Edit      | makes the alert, and sends it to your first user     | makes no alert, and leaves one that is there. Its row says `optional` |

The alert is named `poplin: usage charges reached 1 dollar`, under Notifications in Cloudflare. It counts the whole account's charges, and it stops nothing. [Limits and cost](../upkeep/cost/what-can-cost-money.md) says what can cost money.

A key that may not make the alert shows in a check: the row `Budget alert` says `failed`, with the permission and `Press Repair.`

## An email about certificates

Under a domain the install keeps a second alert: Cloudflare emails your first user when a certificate it issues for a domain fails to validate, is issued, is renewed, or runs out.

| Question               | Answer                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| What it covers         | every domain of the account, not this install's alone: Cloudflare takes no narrower choice for this alert |
| Who makes it           | the install's key, when and as it makes the budget alert; or a Repair at once, with Notifications: Edit   |
| Its row                | `Certificate alert`: `optional` until the key or a Repair made it                                         |
| Its name at Cloudflare | `poplin: certificates of every domain of the account`, under Notifications                                |
| Without a domain       | there is none: the address is Cloudflare's own, and so is its certificate                                 |

An account that holds other domains gets their certificate emails too. poplin is best in an account that holds only poplin, as [the key's page](../about/security.md#the-kept-key) says.
