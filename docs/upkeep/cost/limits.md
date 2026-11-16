---
title: Limits
order: 20
---

# Limits

What an install caps or protects, and what a day counts; none of the limits is a cap on what Cloudflare bills.

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
| one address at one Cloudflare location: 300 requests in 10 seconds, [counted in each data center](#where-a-limit-is-counted) | Repair: Rate rule, skipped on a Free plan domain with other hostnames and where the plan has no room for it. | Cloudflare blocks the address for 10 seconds, before the Worker runs |
| verified bots, methods other than GET and HEAD, and scanner paths, on site addresses. An assistant that opens one page for a person and a chat app's fetch for a link preview pass, and search engines pass while `search_engines_allowed` is on | Repair: WAF rule, skipped where the plan has no room for it. | Cloudflare blocks the request before the Worker runs |
| AI crawlers: while `block_bots` is `auto`, on a domain with no other hostnames; while it is `on`, on any domain | Repair: Bot settings | Cloudflare blocks them on the whole domain |
| plain http | Repair: Redirect rule. The Worker does the same | the request is sent to https |
| the dashboard and private sites | Repair: Access application and Access policy | Cloudflare's login, for the `logins` alone |
| the bucket's public address | the bucket [the install](../../start/install.md#4-read-what-it-made) makes has none | files are read through the Worker alone |
| uploads in parts that nobody finished | Cloudflare's own rule on the bucket, after seven days | Cloudflare removes them. No bucket rule deletes a stored file: a site's live files and its dropped ones sit under the same folder of random letters, so only the Worker removes dropped files |
| the account's usage charges of a billing period: 1 US dollar | the install's key, within a day of the install; or Repair: Budget alert, with the optional permission Notifications: Edit. Under a domain or without one | Cloudflare emails the first user. Nothing is stopped |

Repair is the button on the Domain screen, and the command `npx poplin doctor --repair`. The budget alert exists where the install's key or a Repair made it.

**What no setting bounds.** Every request the Worker answers spends the Workers plan's requests of the day: a 404, a redirect to the login, a call of the API, and a request a limit refused with 429 too. `requests_per_day` counts the requests at the address of a live site alone.

| Workers plan | One address that keeps asking | What stops it before the Worker runs |
| --- | --- | --- |
| free, 100000 requests a day | can use up the day: every site and the dashboard stop until midnight UTC | the rate rule, at 300 requests in 10 seconds: about 2.6 million a day, far above the plan's day |
| paid | is billed as any request is | the same rule |

## Where a limit is counted

| Limit | Counted | For a visitor whose requests reach several Cloudflare data centers |
| --- | --- | --- |
| the rate rule: 300 requests in 10 seconds | in each data center, with a count of its own. The data centers at one geographical location share a count | more than 300 in 10 seconds can pass before the rule blocks |
| `site_requests_per_minute` and `visitor_requests_per_minute` | in each location, with a count of its own | more than the setting can pass in a minute |
| `requests_per_day` | in one place, the database, from a sample | one count takes the requests of every data center. It is an estimate, and each instance of the Worker keeps what it last read for up to half a minute, so more than the setting can pass |

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
