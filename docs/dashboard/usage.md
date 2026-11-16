---
title: Usage
order: 30
---

# Usage

The day's database rows, and the graph of visits.

## Database rows by day

The dashboard's Usage screen sets the day's database rows beside what Cloudflare's free plan takes:

```text
What                           Used               Limit       Share of the limit
Requests today                 1,240              100,000     1%
Database rows read today       about 12,400       5,000,000   0%
Database rows written today    about 310          100,000     0%
```

| On the screen | Is |
| --- | --- |
| Database rows read today, Database rows written today | poplin's own count of the rows its database read and wrote on the UTC day. D1 counts its daily allowance in the same rows |
| `about` | the count can read low, never high. What an instance of the Worker counted and had not written when it ended, or when the day ended, is missing: on a busy day about 1 in 100 rows, on a quiet day up to a few thousand rows |
| the limit | the free plan's, for every database of the account together. No setting moves it |
| the icon at a row's end, See it at Cloudflare on a phone | Cloudflare's own page for that number, in a new tab: Workers & Pages for requests, D1 for the database, R2 for the storage. Its figures are the exact ones, and they count the whole account |

The count costs nothing: it rides in the write that counts the day's requests, so no request reads or writes a row for it. From 80% of a limit on, the screen says Near the limit. Once a limit is reached, D1 refuses until 00:00 UTC: a site shows a paused page, and the API answers `allowance_spent`.

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
