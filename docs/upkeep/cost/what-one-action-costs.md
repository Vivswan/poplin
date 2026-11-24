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
| Publish a site of one page | 3 | 10 | 31 | 22 | 1 | 2 |
| Open the Sites screen | 1 | 2 | 470 | 0 | 0 | 0 |
| Open a folder of a site's files | 1 | 3 | 8 | 1 | 0 | 1 |
| Open the Access screen | 3 | 6 | 258 | 0 | 0 | 0 |
| Open the Activity screen | 2 | 4 | 607 | 0 | 0 | 0 |
| Open the Usage screen | 3 | 8 | 5,332 | 0 | 0 | 0 |
| Open the Settings screen | 1 | 2 | 3 | 0 | 0 | 0 |
| Open the Domain screen | 1 | 2 | 3 | 0 | 0 | 0 |
| Copy a site of 112 files | 1 | 8 | 31 | 24 | 112 | 114 |
| Download a file of the Activity log | 1 | 4 | 2,003 | 0 | 0 | 0 |

- **A screen** counts its own requests. The frame around every screen is one more, of 2 queries.
- **A site's panel** reads its site each time it opens: one request, with no listing of the storage.
- **A site's files**, in its panel, are read a page of up to 200 rows at a time: one request with one listing of the storage for each folder that is first opened, and for each Show more. A panel that opens with Files left open opens the top folder, unless that folder is kept from before. [Sites](../../dashboard/sites.md) says when a folder is read.
- **A publish** is three requests: its start, its one file, its finish. One of more than 100 files adds a request for every 100 files, which reads 2 rows and writes none.
- **With the upload key** a file is no request to the install: a publish of 5 files is 2 requests in place of 7, and one of 500 files is 7 in place of 507. The bucket's writes stay the same, and the read before each write goes.
- **A copy** of up to 112 files is one request. A larger one goes on in rounds, each with a read and a write for every file it copies and a listing for every 1,000 files of the site.
- **A search** reads every site it passes over, so one that finds few reads more rows on an install with more sites. A sort reads the page it shows, however many sites there are.
- **A page view** is measured on a Worker that served the site a moment before. A request for a site after a minute without one costs up to 3 queries.
- **The day's count** is written for every request of a day's first 2,000, then for 1 in 2, then 1 in 3, and so on down to 1 in 50 from 98,000 on. A request that is not counted writes no row, and is 1 query on a Worker that served the site a moment before.
- **The storage** is read once for a page view. A path that names no file reads it up to 3 times.
- **A Worker that starts** with a request asks 2 queries more for it.
- **The clean-up**, every 15 minutes, removes at most 100 Activity entries and 25 ended tokens that are over 90 days old: 125 rows written. With none that old it writes no row. A run moves to the trash or removes for good at most 15 sites: a site removed for good writes about 11 rows, so a run that finds a full trash writes 168.
- **The Usage screen** reads the most rows when its graph shows 90 days of 50 sites: a row for each day of each site. A longer stretch is drawn week by week and reads one row a week of each site, so a year of 50 sites reads 3,012 rows.
- **The Activity screen** reads the most rows when it is narrowed to a site or a kind: it then looks at up to 5,000 entries.

**A copy of more than 112 files** is a background job of the Worker's Workflow, `JOBS`:

```text
the first request          checks the name, copies the first files, starts the job
each step of the job       one round: up to 113 files, 2 database queries
the last step              makes the site: 6 database queries
a step that ends the copy  gives it up: up to 5 database queries
a Worker that starts       2 database queries more for that step
a copy of 5,000 files      1 request and 46 steps
a copy of 10,000 files     1 request and 92 steps
Cloudflare's free plan     3,000 steps a day, 1,024 steps a job
```

The page or the command that began the copy only asks whether it is a site yet: 3 queries an ask, and nothing of the storage. Closing the page leaves the copy running. Cancel ends the job. A step that fails is tried five more times; then the copy is given up, its files are removed, and [Problems](../../fix/problems.md) shows `A copy of a site was not made`.

A job that stops without giving its copy up leaves an upload nobody finishes. The sweep removes it and its files once 25 hours have passed, and notes `copy_failed`: one query more in that run.

**A Worker with no binding to a Workflow** runs no job. The install's first upload binds it and an update keeps it, so only a Worker uploaded some other way has none. There the page or the command that began the copy sends one request for every round, and the copy stops when it is closed.
