---
title: Limits and cost
order: 40
---

# Limits and cost

What can cost money, what an install caps or protects, what a day counts, and the graph of visits; none of the limits is a cap on what Cloudflare bills.

## What can cost money

```text
billed by use on an install        R2, the storage that holds the sites' files
everything else an install uses    a free plan with a limit, until the account's owner buys another plan
```

Cloudflare's pricing page for R2 names what a month takes for free: 10 GB stored, 1,000,000 writes and listings, 10,000,000 reads. Past that, on an account with a payment method, Cloudflare bills. Cloudflare has no setting that stops R2 at an amount.

The other way to a bill is a plan the account's owner buys. Poplin, its setup, and its OpenTofu module buy nothing and change no plan.

**What poplin does.** Three settings bound what an install asks of R2, and poplin refuses what would pass one: `max_total_size`, `max_storage_writes_per_day`, and `requests_per_day`. [What is capped or protected](#what-is-capped-or-protected) lists every limit and what happens at it.

On the free Workers plan, a month at the settings a new install starts with stays inside R2's free writes, listings, and reads. [What a day counts](#what-a-day-counts) has the arithmetic.

**What poplin cannot do.** It cannot stop Cloudflare from billing. Every limit is a refusal by the Worker, from poplin's own count, and Cloudflare's count decides the bill. Outside poplin's count:

- the files of an upload that was given up, until the sweep removes them
- a setting raised above a free allowance: it is taken, with a warning beside it
- what reaches the storage without the Worker

Cloudflare's changelog of 2026-11-13 describes spend limits for Workers and Durable Objects. It does not name R2, and it says recorded spend can exceed a limit.

**Your own safety net** is Cloudflare's budget alert: Manage Account, then Billing, then Billable Usage, then Create budget alert. It sends an email when the account's usage-based charges pass the amount you name. It pauses nothing.

## What is capped or protected

The limits and alerts below are the protection, and none of them is a cap on what Cloudflare bills.

| What is capped or protected | Where it is declared | What happens at the cap |
| --- | --- | --- |
| the bytes of every kept version, the trash, and every upload under way: 9 GB | the setting `max_total_size` | a publish that would pass it is refused with `too_large`. The files of an upload that was given up are not counted while they wait for the sweep |
| the files that the publishes begun in one UTC day declare: 25000 | the setting `max_files_per_day` | a publish that would pass it is refused with `too_large` |
| the writes and listings of the storage that poplin counts in one UTC day: 30000. An upload's files are counted on the day it begins, and the sweep has 1000 listings a day of its own | the setting `max_storage_writes_per_day` | what would pass it is refused with `allowance_spent` until the next UTC day. A file of an upload that is sent again is not written a second time |
| the day's requests for sites, counted from a sample: about 100000 | the setting `requests_per_day` | a site's visitors get status 429 until the next UTC day |
| one site's and one visitor's requests in a minute | the settings `site_requests_per_minute` and `visitor_requests_per_minute` | status 429, with the seconds to wait |
| the versions a publish leaves a site, and the days in the trash | the settings `versions_kept` and `trash_days` | a publish that goes live deletes the versions past the count, and the Worker's sweep deletes a site past its days in the trash, each with its files |
| one address at one Cloudflare location: 300 requests in 10 seconds | Repair: Rate rule, skipped on a Free plan domain with other hostnames and where the plan has no room for it. Module: `cloudflare_ruleset.rate`, unless `rate_rule` is `off` | Cloudflare blocks the address for 10 seconds, before the Worker runs |
| verified bots, methods other than GET and HEAD, and scanner paths, on site addresses. Search engines pass while `search_engines_allowed` is on | Repair: WAF rule, skipped where the plan has no room for it. Module: `cloudflare_ruleset.guards`, unless `guard_rules` is false | Cloudflare blocks the request before the Worker runs |
| AI crawlers: while `block_bots` is `auto`, on a domain with no other hostnames; while it is `on`, on any domain | Repair: Bot settings. Module: `cloudflare_bot_management.zone` | Cloudflare blocks them on the whole domain |
| plain http | Repair: Redirect rule. Module: `cloudflare_ruleset.https`. The Worker does the same | the request is sent to https |
| the dashboard and private sites | Repair: Access application and Access policy. Module: `cloudflare_zero_trust_access_application.login` and its policy | Cloudflare's login, for the `logins` alone |
| the bucket's public address | Module: `cloudflare_r2_managed_domain.sites`. A bucket [step 2](../start/by-hand.md#the-steps) made has none | it stays off: files are read through the Worker alone |
| uploads in parts that nobody finished | Module: `cloudflare_r2_bucket_lifecycle.sites`, after one day. A bucket step 2 made has Cloudflare's own rule, after seven days | Cloudflare removes them. No bucket rule deletes a stored file: a site's live files and its dropped ones sit under the same folder of random letters, so only the Worker removes dropped files |
| every file of an install that only tests | Module alone: `test_install_file_days`, not set by default | the bucket deletes every file at that age, a live site's included |
| R2's bytes stored, write operations, and read operations | Module alone, and off until `usage_alert_percents` is set: `cloudflare_notification_policy.usage`. It needs the Notifications permission, and applies on accounts where Cloudflare offers usage alerts | Cloudflare emails the logins at each share of the free allowance the list names. Nothing is stopped |
| the domain's plan | Module alone: `paid_plan_allowed` | an apply on a plan other than Free stops with an error, unless the input is true |

Repair is the button on the setup page and the Domain screen. Module is [the OpenTofu module](with-opentofu.md). The rows marked Module alone, and the one-day rule, exist only on an install the module made: the setup page's token holds no permission for R2 or for notifications.

## What a day counts

An import and a copy count as a publish, with every version an import holds. A publish that is given up or runs out gives none of the day's files back.

The day's writes to the storage are counted like this:

| What                                              | Counts                          |
| ------------------------------------------------- | ------------------------------- |
| a publish or an import, when it begins            | 1 for each file it declares     |
| a copy, when it begins                            | 2 for each file                 |
| a listing of the storage, when it is made         | 1                               |
| a file whose write fails                          | 1                               |
| a file the storage already holds, sent again      | nothing                         |
| a read, a delete                                  | nothing                         |

On the free Workers plan, a month at the settings a new install starts with stays inside what R2 takes for free:

| R2 operations         | Free a month | At most, in a month of 31 full days |
| --------------------- | ------------ | ----------------------------------- |
| writes and listings   | 1,000,000    | 991,000                             |
| reads                 | 10,000,000   | 9,765,000                           |

A finish, a look at an upload, a delete, a copy, and a backup's list of files each list the storage. At the limit they answer `allowance_spent` until 00:00 UTC; a delete still removes the site, and its files go later.

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

[Manage sites](../use/manage-sites.md#look-go-back-re-link-delete) says which opens count, and where one site's count shows.
