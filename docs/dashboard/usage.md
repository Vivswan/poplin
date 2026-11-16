---
title: Usage
order: 30
---

# Usage

The day's database rows, and the graph of visits.

## Database rows by day

The dashboard's Usage screen sets the day's database rows beside what Cloudflare's free plan takes. Whose numbers they are depends on [the kept key](../about/security.md#the-kept-key), which setup makes:

```text
with the key                   Cloudflare's own figures, as of 15 Nov 2026, 14:30.

What                           Used               Limit        Share of the limit
Requests today                 1,240              100,000      1%
Account requests today         1,318              100,000      1%
Database rows read today       13,902             5,000,000    0%
Database rows written today    342                100,000      0%
Storage writes this month      41,200             1,000,000    4%
Storage reads this month       310,000            10,000,000   3%

without a key                  no line over the table

Requests today                 1,240              100,000      1%
Database rows read today       about 12,400       5,000,000    0%
Database rows written today    about 310          100,000      0%
```

| On the screen | With the key | Without a key |
| --- | --- | --- |
| Requests today; Storage, all sites | this install's sites alone, against the settings `requests_per_day` and `max_total_size` | the same |
| Database rows read today, Database rows written today | Cloudflare's figure for every D1 database of the account on the UTC day | poplin's own count of the rows its database read and wrote on the UTC day, after `about` |
| Account requests today | every request the account's Workers answered on the UTC day | no line |
| Account storage, highest in 24 hours | the bytes every R2 bucket of the account held: each bucket's largest reading of the last 24 hours, added up. Past 10 GB Cloudflare bills | no line |
| Storage writes this month, Storage reads this month | the account's R2 writes and listings, and its reads, of the UTC month. Past the free amount Cloudflare bills | no line |

Cloudflare's figures count the whole account: every Worker, database, and bucket in it, poplin's or not. The free plan's limits are the account's too, so those lines stand against the limit that counts.

| How fresh | Is |
| --- | --- |
| Cloudflare's figures | asked for when the Usage screen opens or reads again, never for a visitor. An instance of the Worker keeps them 5 minutes, a reading that failed 1 minute, and asks again on a new UTC day |
| `as of` | when poplin asked Cloudflare |
| a figure Cloudflare gave none of | its line is left out, and a line of database rows shows poplin's own count after `about` |
| poplin's own count | read from the database each time the screen opens, and every 5 minutes while it stays open |

When the key gave no figure, the line over the table says why and ends in `The numbers here are poplin's own count.`:

| The line starts | Do |
| --- | --- |
| `Cloudflare did not answer.` | open Usage again after a minute |
| `The kept key no longer works.` | open Domain and press Repair: it makes a new key |
| `The kept key has no right to read usage` | Repair leaves a key that still works as it is. Delete the token "poplin kept key" at Cloudflare, then open Domain and press Repair |

| On the screen | Is |
| --- | --- |
| `today`, `this month` | the UTC day and the UTC month the numbers are counted over, while the date in the dashboard's time zone is in them |
| `on 16 Nov UTC`, `in Dec UTC` | the same day and month by name, once that date is another: before 00:00 UTC for a reader east of UTC, after it for one west |
| `about` | poplin's own count can read low, never high. What an instance of the Worker counted and had not written when it ended, or when the day ended, is missing: on a busy day about 1 in 100 rows, on a quiet day up to a few thousand rows |
| the limit of a line with no setting | the free plan's, for the whole account. No setting moves it. On the storage lines it is the free amount, and Cloudflare bills what goes past it |
| the icon at a row's end, See it at Cloudflare on a phone | Cloudflare's own page for that number, in a new tab: Workers & Pages for requests, D1 for the database, R2 for the storage. It counts the whole account |

poplin's own count adds no row: it rides in the write that counts the day's requests, so no request reads or writes a row for it. Cloudflare's figures are 4 questions to Cloudflare, asked when the screen opens and an instance holds no answer still kept.

From 80% of a limit on, the screen says Near the limit. Only the database pauses an install. Once a daily limit of database rows is reached, D1 refuses until 00:00 UTC: a site shows a paused page, and the API answers `allowance_spent`.

The storage lines pause nothing. Past the free amount of storage, writes, or reads, Cloudflare bills the rest on an account with a payment method: [What can cost money](../upkeep/cost/what-can-cost-money.md).

## Visits by day

The dashboard's Usage screen draws a graph under Visits: how often pages were opened, day by day.

| Choice        | Offers                                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| Days shown    | 30 days, 60 days, 90 days, 180 days, 1 year                                  |
| Compare sites | up to 50 sites, each drawn as a line beside All sites                        |
| Select all    | in the list of Compare sites: ticks every site the list shows, up to the 50  |
| Clear         | in the same list: unticks every site                                         |

- **A point** is one UTC day in a graph of up to 90 days, and one week in a longer one, where the first point may hold fewer days.
- **A year is kept:** the counts of 365 UTC days, today included. A day with no count shows 0, and so does every day before the install was made.
- **The numbers are estimates.** A count is exact while the install's day is under 2,000 requests. Past that the day is counted from a sample, and a count moves in steps of up to 50. A sum reads `about 1,200`, or `under 10`.

[Manage sites](../sites/manage.md#look-go-back-re-link-delete) says which opens count, and where one site's count shows.
