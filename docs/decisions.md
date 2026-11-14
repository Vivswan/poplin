---
title: Decisions
order: 40
group: Reference
---

# Decisions

This page says why poplin is built the way it is, and what each choice costs. What poplin protects against is on the [security page](security.md).

## What poplin is for

```text
poplin ./report   ->   https://page-report.example.com   only you, after one login
```

- **One call publishes.** An agent or a person publishes a static site, a folder or one HTML file, to their own Cloudflare account.
- **Private first.** A site opens only for its owner until the owner makes it unlisted (anyone with the secret link) or public (everyone).
- **One place to manage it.** The owner has an index page that lists every site, and agents reach the same actions over MCP, the protocol agents use to call tools.

## Does it exist already

No project found does all of it. Four come closest:

| Project | Has | Gap |
| --- | --- | --- |
| [handbill](https://github.com/viktoravelino/handbill) | Cloudflare Workers and R2, a secret subdomain, a public alias | no multi-file sites (left out by choice), no index, no MCP |
| [anvilnine/artifacts](https://github.com/anvilnine/artifacts) | secret links, switching a site between states, a CLI and MCP, an S3 backend | no index; it needs a running server |
| [Pagecast](https://github.com/Amal-David/pagecast) | unlisted links on Cloudflare Pages, a CLI and MCP | no index; its state is kept on one machine |
| [Birta](https://birta.dev) | a hosted service: agents publish static pages, a review link per version beside a stable public address, version history, custom domains, a free tier | closed source; self-hosting only on an enterprise plan; no MCP server or CLI named; the review link is its only private state, and no login protects it |

Further off. Each has no secret-link state, or no switch between states, or holds one file:

| Kind | Names |
| --- | --- |
| self-hosted or Workers tools | agenthost, Open Artifacts, open-artifacts, Toss, MCP Static Hosting, Smallweb |
| hosted services | ShipStatic, Spacefast, Tiiny Host, pgs.sh, Surge, Netlify Drop, Vercel, Cloudflare Pages with Access, statichost, Neocities, static.app, GitHub Pages, Render, Firebase |
| tunnels, where a machine must stay up | Tailscale Funnel, trycloudflare, ngrok |
| shutting or shut | Glitch, Fleek, val.town, Deno Deploy |

Three likely reasons for the gap, a reading of the survey and not a measured result:

- **The parts are recent.** Storage with no egress fee, a rate limit a Worker can call, and MCP are all new.
- **Privacy is a paid tier.** Hosts sell it.
- **Logins by habit.** Developer tools reach for a login where "anyone with the link", as shared documents work, would do.

## Why not extend handbill

[handbill](https://github.com/viktoravelino/handbill) by Viktor Avelino (MIT license) is the prior tool whose shape poplin shares, described in its author's post [Hand someone a page](https://viktoravelino.com/blog/hand-someone-a-page/). Poplin shares its foundation and differs in everything on top:

| | handbill | poplin |
| --- | --- | --- |
| what is published | one self-contained page | a whole site: a folder, or one HTML file |
| the secret in the address | derived from the page's content, so the link is fixed to that content | 12 random characters, about 62 bits; it survives an update and can be rotated |
| who can open it | the secret link, or a public alias | three states, private, unlisted, public, changed in place |
| a list of what is published | none | the owner's index |
| agents | no MCP | an MCP server in the Worker, and a local one |

Adding these to a one-page tool would be a rewrite of it, so poplin is a separate project. What poplin took from handbill as lessons:

- **The secret is one hostname label.** In the default layout one wildcard DNS record and one wildcard certificate cover every site, so no site's name is published.
- **Names cannot collide.** A site name never contains `--`, so a short name and a secret name cannot meet.
- **The address is the secret, so headers guard it.** Pages go out with `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.

## The decisions

| Decision | Why | What it costs |
| --- | --- | --- |
| Poplin runs only on Cloudflare: a Worker serves, R2 stores, Access is the login | it fits the free tier: 10 GB of storage with no egress fee, 100,000 requests a day, a login free for 50 users; there is nothing to host | a Cloudflare account is required; poplin does not run on a server of one's own, and R2 is its only storage |
| A site is private by default | nothing is exposed until the owner says so | the owner logs in once a month per browser; an agent without the owner's cookie cannot open a private site to check it, and hands the address back |
| The secret lives in the hostname, not the path | a site with absolute asset paths works unchanged | it needs a domain; a network that reads plain DNS lookups sees the name, though never the page |
| Each site is its own origin | a page's scripts cannot read another site or its cookie | it needs a domain; the sites share one login cookie, so the Worker must refuse a private file that another site requests, unless the private site allows that site |
| The Worker stores and serves bytes; it never reads, parses, or rewrites a site's files | files go out byte for byte, and every header comes from the address or the site's record | a page's title is read on the uploader's side, or passed by the caller; Markdown is not rendered; no content policy is forced on a site |
| Storage is one bucket: a folder per site with its record beside it, and no database | the bucket is the only state: a site, its versions, and its record sit together | a changed record shape rewrites the bucket once, in a migration |
| Guards keep usage inside the free tier: a storage cap, a size cap per site, request limits per site and per visitor | R2 bills past its free tier, so poplin refuses an upload past the cap; one busy site cannot starve the others | an upload can be refused; a busy site answers 429 until midnight UTC; the guards cannot save the day's request quota, see below |
| npm is the only install path: no Homebrew formula, no standalone binary, no container image | the library, the CLI, and the local MCP server come from one package, so nothing drifts out of step | Node 24 or newer, or Bun, is required |
| With no domain, poplin starts on the account's free `workers.dev` address; adding a domain switches on the full set | a first site costs nothing and needs no domain | sites are paths on one hostname, with [narrower guarantees](security.md#without-a-domain); every site link changes once when a domain is added; pages there cannot use browser storage, popups, or form submission |
| No backwards-compatible code outside migrations | one shape of every record exists at a time; an old shape is deleted when the new one lands | any release may change a record's shape, and a changed shape means running a one-time migration |

The request quota is the one limit poplin cannot fully guard. A refused request still counts against Cloudflare's 100,000 a day; only the firewall rules that run before the Worker save requests, and they exist only with a domain.

A flood from many addresses can stop the sites until midnight UTC. It costs no money: the Worker plan stops at its limit and never bills.
