---
title: What can cost money
order: 10
---

# What can cost money

```text
billed by use on an install        R2, the storage that holds the sites' files
everything else an install uses    a free plan with a limit, until the account's owner buys another plan
```

Cloudflare's pricing page for R2 names what a month takes for free: 10 GB stored, 1,000,000 writes and listings, 10,000,000 reads. Past that, on an account with a payment method, Cloudflare bills. Cloudflare has no setting that stops R2 at an amount.

The other way to a bill is a plan the account's owner buys. Poplin, its setup, and its OpenTofu module buy nothing and change no plan.

**What poplin does.** Three settings bound what an install asks of R2, and poplin refuses what would pass one: `max_total_size`, `max_storage_writes_per_day`, and `requests_per_day`. [What is capped or protected](limits.md#what-is-capped-or-protected) lists every limit and what happens at it.

On the free Workers plan, a month at the settings a new install starts with stays inside R2's free writes, listings, and reads. [What a day counts](limits.md#what-a-day-counts) has the arithmetic.

**What poplin cannot do.** It cannot stop Cloudflare from billing. Every limit is a refusal by the Worker, from poplin's own count, and Cloudflare's count decides the bill. Outside poplin's count:

- the files of an upload that was given up, until the sweep removes them
- a setting raised above a free allowance: it is taken, with a warning beside it
- what reaches the storage without the Worker

Cloudflare's changelog of 2026-11-13 describes spend limits for Workers and Durable Objects. It does not name R2, and it says recorded spend can exceed a limit.

**The warning** is a budget alert in your Cloudflare account. It pauses nothing.

```text
when     the account's usage charges for the billing period reach 1 US dollar
who      Cloudflare emails your first user
made by  Repair, with an account token that also holds Notifications: Edit
```

| Install | Gets the alert |
| --- | --- |
| by the Deploy button or by hand | once you add the permission to the account token and press Repair: [Domain](../../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar) |
| by the OpenTofu module | the same way. The module makes no budget alert |

Without the permission, Repair makes no alert and fails nothing. You can also make one by hand: Manage Account, then Billing, then Billable Usage, then Create budget alert.
