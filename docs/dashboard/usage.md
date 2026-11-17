---
title: Usage
order: 30
---

# Usage

What the install and its account used, each beside its limit, and the graph of visits.

## Used, beside the limit

The dashboard's Usage screen sets every number Cloudflare meters for a poplin install beside what the free plan takes. Whose numbers they are depends on [the kept key](../about/security.md#the-kept-key), which the install makes:

```text
with the key                               Cloudflare's own figures, as of 15 Nov 2026, 14:30. They run about 10 minutes behind. "Account" lines count the whole account, not only poplin.

What                                       Used              Limit        Share of the limit
Storage, all sites                         1.2 GB            9 GB         13%
Account storage, last 24 hours             at most 5.1 MB    10 GB        0%
Database size                              1.4 MB            500 MB       0%
Account database size                      at most 2.3 MB    5 GB         0%
Sites, the trash included                  12                No limit
In the trash                               2                 No limit
Files                                      156               No limit
Account files stored                       at most 212       No limit
Uploads left unfinished                    at most 3         No limit
Requests today                             1,240             100,000      1%
Account requests today                     1,318             100,000      1%
Account errors today                       4                 No limit
Requests stopped by a limit today          0                 No limit
Processing time, slowest 1 in 100, today   12.4 ms           10 ms        a warning sign, Slow
Database rows read today                   13,902            5,000,000    0%
Database rows written today                342               100,000      0%
Storage writes since 01 Nov UTC            41,200            1,000,000    4%
Storage reads since 01 Nov UTC             310,000           10,000,000   3%
Background jobs started today              6                 No limit
Background jobs done today                 5                 No limit
Background jobs failed today               0                 No limit
Background jobs running now                1                 100          1%

without a key                              no line over the table

Storage, all sites                         1.2 GB            9 GB         13%
Database size                              1.4 MB            500 MB       0%
Sites, the trash included                  12                No limit
In the trash                               2                 No limit
Files                                      156               No limit
Requests today                             1,240             100,000      1%
Database rows read today                   about 12,400      5,000,000    0%
Database rows written today                about 310         100,000      0%
```

Both kinds of install, with a domain and without one, show the same lines.

| On the screen | With the key | Without a key |
| --- | --- | --- |
| Requests today; Storage, all sites; Files | this install's sites alone, the first two against the settings `requests_per_day` and `max_total_size` | the same |
| Sites, the trash included; In the trash | this install's sites alone, the first against the setting `max_sites` | the same |
| Database size | the bytes this install's D1 database holds, as D1 said with its last answer. No question to Cloudflare. 500 MB is the most one database holds on the free plan | the same |
| Database rows read today, Database rows written today | Cloudflare's figure for every D1 database of the account on the UTC day | poplin's own count of the rows its database read and wrote on the UTC day, after `about` |
| Account requests today | every request the account's Workers answered on the UTC day | no line |
| Account errors today | the requests of the account's Workers that failed on the UTC day | no line |
| Requests stopped by a limit today | the requests Cloudflare ended because one used more than a request may. 0 is good | no line |
| Processing time, slowest 1 in 100, today | the CPU time 99 in 100 requests of the UTC day stayed under, in milliseconds. A day with no request yet reads `Not read` | no line |
| Account storage, last 24 hours | after `at most`: each R2 bucket's largest reading of the last 24 hours, added up. Past 10 GB Cloudflare bills | no line |
| Account files stored, Uploads left unfinished | after `at most`: each R2 bucket's most files, and most uploads begun and not finished, of the last 24 hours, added up | no line |
| Account database size | after `at most`: each D1 database's largest reading since the UTC day before, added up | no line |
| Storage writes since 01 Nov UTC, Storage reads since 01 Nov UTC | the account's R2 writes and listings, and its reads, from the first day of the UTC month. Past the free amount Cloudflare bills | no line |
| Background jobs started today, done today, failed today | the starts, good ends, and failures of every Workflow of the account on the UTC day. A job poplin stopped is in none of the last two | no line |
| Background jobs running now | the jobs of this install's own Workflow that run at this moment, up to 100 | no line |

Cloudflare's figures count the whole account: every Worker, database, bucket, and Workflow in it, poplin's or not. The free plan's limits are the account's too, so those lines stand against the limit that counts.

Background jobs running now is the one exception: it counts this install's jobs alone. `at most` says the account held that much or less: two parts of it need not be at their largest at one time.

Cloudflare counts a month of storage writes and reads by the account's own billing period, which the kept key cannot read. The two lines count from the first day of the UTC month and name that day, so on an account whose period starts on another day they read high or low against the free amount.

The processing time stands beside 10 ms, yet a request is not stopped the moment it passes that: Cloudflare stops one only when it says so, and counts it under Requests stopped by a limit. Above 10 ms the line shows a warning sign and the word Slow. The sign's hint says this, and the line never says Over the limit.

| How fresh | Is |
| --- | --- |
| Cloudflare's figures | asked for when the Usage screen opens or reads again, never for a visitor. An instance of the Worker keeps them 5 minutes, a reading that failed 1 minute, and asks again on a new UTC day |
| `as of` | when poplin asked Cloudflare |
| `They run about 10 minutes behind.` | what Cloudflare counts reaches its figures about 10 minutes later. Background jobs running now is read live |
| `Not read` | Cloudflare gave no figure for that line. The other lines stand, and a line of database rows shows poplin's own count after `about` |
| poplin's own count, and Database size | read from the database each time the screen opens, and every 5 minutes while it stays open in a tab that is in view |

When the key gave no figure at all, the line over the table says why and ends in `The numbers here are poplin's own count.`:

| The line starts | Do |
| --- | --- |
| `Cloudflare did not answer.` | open Usage again after a minute |
| `The install's key no longer works.` | open Domain and press Repair: it makes a new key |
| `The install's key has no permission to read usage` | open Domain and press Repair: it makes a new key |

| On the screen | Is |
| --- | --- |
| `today` | the UTC day the numbers are counted over, while the date in the dashboard's time zone is that day |
| `on 16 Nov UTC` | the same day by name, once that date is another: before 00:00 UTC for a reader east of UTC, after it for one west |
| `since 01 Nov UTC` | the first day of the UTC month, from which the storage writes and reads are counted |
| `about` | poplin's own count can read low, never high. What an instance of the Worker counted and had not written when it ended, or when the day ended, is missing: on a busy day about 1 in 100 rows, on a quiet day up to a few thousand rows |
| the limit of a line with no setting | the free plan's, for the whole account; for Database size, for one database. No setting moves it. On the storage lines it is the free amount, and Cloudflare bills what goes past it |
| the icon at a row's end, See it at Cloudflare on a phone | Cloudflare's own page for that number, in a new tab: Workers & Pages for requests, D1 for the database, R2 for the storage, Workflows for the jobs. It counts the whole account |

poplin's own count adds no row: it rides in the write that counts the day's requests, so no request reads or writes a row for it.

Cloudflare's figures are 7 questions to Cloudflare, each alone so that one that fails leaves the others standing: 6 to its analytics and 1 to the list of running jobs. They are asked when the screen opens and an instance holds no answer still kept.

From 80% of a limit on, the screen says Near the limit; the processing time alone says nothing until it is above its 10 ms. Only the database pauses an install. Once a daily limit of database rows is reached, D1 refuses until 00:00 UTC: a site shows a paused page, and the API answers `allowance_spent`.

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
