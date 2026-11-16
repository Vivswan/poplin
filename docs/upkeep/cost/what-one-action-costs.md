---
title: What one action costs
order: 30
---

# What one action costs

Each action as the tests measure it on a Worker that is already running: a full page of the list, the longest file, a site that keeps every version it may. The queries and the storage calls are the most the action makes. The rows read are those of the measured case.

```text
Cloudflare's free plan     one request: 50 database queries
                           one day: 5,000,000 rows read, 100,000 rows written
```

| Action | Requests | Database queries | Rows read | Rows written | Storage reads | Storage writes and listings |
| --- | --- | --- | --- | --- | --- | --- |
| A visitor opens a page of a public site | 1 | 2 | 4 | 2 | 1 | 0 |
| A visitor opens a page of a private site | 1 | 2 | 4 | 2 | 1 | 0 |
| Publish a site of one page | 3 | 10 | 31 | 19 | 1 | 2 |
| Open the Sites screen | 1 | 2 | 651 | 0 | 0 | 0 |
| Open the Access screen | 3 | 6 | 258 | 0 | 0 | 0 |
| Open the Activity screen | 2 | 4 | 607 | 0 | 0 | 0 |
| Open the Usage screen | 3 | 8 | 37,748 | 0 | 0 | 0 |
| Open the Settings screen | 1 | 2 | 3 | 0 | 0 | 0 |
| Open the Domain screen | 1 | 2 | 3 | 0 | 0 | 0 |
| Copy a site of 112 files | 1 | 8 | 31 | 21 | 112 | 114 |
| Download a file of the Activity log | 1 | 4 | 2,003 | 0 | 0 | 0 |

- **A screen** counts its own requests. The frame around every screen is one more, of 2 queries.
- **A publish** is three requests: its start, its one file, its finish. One of more than 100 files adds a request for every 100 files, which reads 2 rows and writes none.
- **A copy** of up to 112 files is one request. A larger one takes several, each with a read and a write for every file it copies and a listing for every 1,000 files of the site.
- **A search or a sort** reads every row it passes over, so a list reads more rows on an install with more sites.
- **A page view** is measured on a Worker that served the site a moment before. A request for a site after a minute without one costs up to 3 queries.
- **The day's count** is written for every request of a day's first 2,000, then for 1 in 2, then 1 in 3, and so on down to 1 in 50 from 98,000 on. A request that is not counted writes no row, and is 1 query on a Worker that served the site a moment before.
- **The storage** is read once for a page view. A path that names no file reads it up to 3 times.
- **A Worker that starts** with a request asks 2 queries more for it.
- **The clean-up**, every 15 minutes, removes at most 100 Activity entries and 25 ended tokens that are over 90 days old: 125 rows written. With none that old it writes no row.
- **The Usage screen** reads the most rows when its graph shows a year of 50 sites, and the Activity screen when it is narrowed to a site or a kind: it then looks at up to 5,000 entries.
