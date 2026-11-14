---
title: Security
order: 50
group: Reference
---

# Security

This page says what poplin protects against and what it does not. Everything below assumes a domain on Cloudflare, except the last section, [Without a domain](#without-a-domain).

## What unlisted covers

An unlisted site opens for anyone who has its address. It is the address the site had while private; only the login is gone.

```text
https://report--k3f9x2ab71qz-page.example.com
        |       |            |
        |       |            the marker every site address ends in, -page by default
        |       the id: 12 random characters, about 62 bits; it is the link
        the name: a label; several sites may share it
```

| Threat | Covered | How |
| --- | --- | --- |
| guessing the address | yes | 62 random bits, and a limit on the requests one visitor makes in a minute |
| search engines | yes | `X-Robots-Tag: noindex` on every file of an unlisted site, and no public listing of unlisted sites |
| certificate logs | yes | one wildcard certificate covers every site, so no name is published |
| DNS listing | yes | one wildcard record |
| the next site's referrer | yes | `Referrer-Policy: no-referrer` on every page |
| a network reading plain DNS | partly | hidden when the browser uses encrypted DNS and Encrypted Client Hello; a plain lookup shows the name, never the page |
| whoever sees the address | no | see below |

## What unlisted does not cover

- **The address is the whole secret.** Anyone who sees it can open the site. No login stands behind it.
- **Lists and commands show it.** The id shown in lists and commands is the link of an unlisted site. Someone who saw it while the site was private can open the site once it is unlisted; running `poplin new-link` first avoids that.
- **A pasted address travels.** Paste it in a chat and the chat's preview bot fetches it; forward it and the next reader has it.
- **A plain DNS lookup shows the name.** A network between the visitor and Cloudflare can learn that the address exists, though it cannot read the page.
- **A leak is fixed by `poplin new-link`.** The site gets a new id, and the old address stops at once. Making the site private closes it to everyone but the owner.

## The three access states

| State | Address | Who opens it | What the visitor needs |
| --- | --- | --- | --- |
| private, the default | `report--k3f9x2ab71qz-page.example.com` | the owner | the login cookie |
| unlisted | the same address | anyone who has the address | the address alone |
| public | the same address, and a name the site claims: `report-page.example.com` | everyone | nothing |

A state changes in place: the site, its files, and its address stay. A public name belongs to one site at a time, and stays with that site through `poplin new-link`.

| Switch for search engines | Set on | Off, the default | On |
| --- | --- | --- | --- |
| `search_engines` | one public site | its files carry `X-Robots-Tag: noindex` | they do not |
| `search_engines_allowed` | the install | the bots rule at Cloudflare's edge stops the crawlers Cloudflare has verified | the rule lets the crawlers of search engines pass |

A search engine's crawler reads a public site without `noindex` only when both are on, where the zone holds the bots rule.

## Who holds which credential

| Who | Credential | Where it comes from |
| --- | --- | --- |
| a person at the dashboard or a private site | a login cookie | one login through Cloudflare Access, by email code or Google; the Worker checks the email against the list of allowed logins, then sets the cookie |
| the CLI, or an agent through `poplin mcp` | a token the Worker issues | the person runs `poplin login` once and allows that computer in a browser; the token is listed on the dashboard and can be revoked there |
| a machine with no browser | the same kind of token | `poplin login` prints an address and a short code to open on another device, where the person allows that computer |
| the Worker, to the bucket and the database | its bindings inside Cloudflare | no bucket key and no database key exists outside Cloudflare |

A token the Worker issues is never a Cloudflare API key. It has one of two scopes:

| Scope | Given to | May |
| --- | --- | --- |
| publisher | a machine a person logs in as a publisher, for an agent; or a token created on the dashboard | publish, and manage its own sites |
| admin | a person on the list of allowed logins; the login cookie carries the same rights | everything: every site, the settings, the tokens |

A site belongs to the token that created it, or to the admin's email when it was uploaded on the dashboard. A publisher token updates and manages only the sites it created.

What guards each address:

| Address | Guarded by |
| --- | --- |
| the login and the dashboard | Cloudflare Access authenticates the person; the Worker checks the email, then sets the cookie |
| the API, which the CLI and `poplin mcp` call | the token the Worker issued; no Access in front, so a machine needs no browser after its login |
| a private site | the cookie |
| an unlisted site; a public site | nothing |

Every site hostname answers GET and HEAD only. The Worker refuses every other method.

## No enumeration

```text
budget--x7k2p94mdq1c-page.example.com    private, no cookie   ->  302 to the dashboard's login
budget--w8t1c5n0ze4u-page.example.com    no such site         ->  the same 302
budget-page.example.com                  no such public name  ->  404
```

Without the cookie, an address with a name and an id answers one redirect when its site is private, in the trash, expired, or was never made. A probe cannot tell a private site from an address that has none. The redirect names the requested address as the place to return to after the login.

## Hardening

| Measure | What poplin does |
| --- | --- |
| the cookie | HttpOnly, Secure, SameSite Lax, set on the parent domain: no script can read it, and a cross-site post does not carry it |
| a removed login | the cookie names the email, and the Worker checks it against the allowed logins on every request; a removed login stops working within the settings cache, one minute |
| writes to the dashboard | the Origin header must be the dashboard itself; agents use bearer tokens, never the cookie |
| tokens at rest | stored hashed; an admin token expires after 30 days, a publisher token lives until revoked |
| the signing key | kept in the database, where the Worker can rotate it; "sign everyone out" rotates it and ends every cookie session; agent tokens are revoked one by one |
| the bucket and the database | R2 public access stays off, and poplin's install check reports it when it is on; the database is reached only through the Worker's binding |
| site headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, correct content types |
| the dashboard | a strict Content-Security-Policy; it may never be framed |
| content | the Worker never reads, parses, or rewrites a site's files |
| the activity log | the dashboard shows the last 100 actions: publish, state change, delete, login, token issued |
| junk hostnames | Cloudflare routes to the Worker only the hostnames that end in the marker, `-page` by default, so no other hostname under the domain reaches it; a rate rule limits each address to 300 requests per 10 seconds. Setup skips it when other rules hold every rate rule the plan allows, or when a Free plan zone has hostnames of its own; the OpenTofu module, which owns the zone's rate rules, stops with a message in that second case |

## Between sites

Each site is its own origin, so a page's scripts cannot read another site or its cookie.

| Switch | Set on | Values |
| --- | --- | --- |
| `embeddable` | one site | on, the default; off: no page may show the site in a frame |
| `outside_pages` | the install | `blocked`, the default; `allowed` |

| A page asks for | Another site of the install | A page of another domain, `blocked` | A page of another domain, `allowed` |
| --- | --- | --- | --- |
| a link to a site | works | works | works |
| a site's images, styles, and classic scripts | works | refused with 403 | works |
| a site in a frame, `embeddable` on | works | refused | works |
| a site in a frame, `embeddable` off | refused | refused | refused |
| a site's files, read by its script | refused | refused | refused |

- **A private site needs the viewer's login in every row.** A browser sends no login cookie with a request that a page of another domain makes, so a private site answers none of them.
- **No script reads another site's files.** No response carries a header that lets another origin's script read it.
- **A frame rule goes out with every file** unless the site is `embeddable` and `outside_pages` is `allowed`. For an `embeddable` site under `blocked` it names every hostname under the install's domain.

All sites of a domain share the login cookie. The Worker decides from the request's `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, `Origin`, and `Referer` headers and reads no content. Opening an address as the top-level page always passes, and so does a request with no `Sec-Fetch-Site` header.

| Under `blocked`, a page under the install's domain that is not a site | Result |
| --- | --- |
| its request names it in `Origin`, or in `Referer` when `Origin` holds no address | refused with 403 |
| its request names no page | passes |

**What a page's scripts can still do:** spend requests against the day's quota. The rate limit per visitor bounds that per address.

## Without a domain

**Narrower guarantees.** With no domain, poplin starts on the account's free `workers.dev` address, which is one hostname. Every site is a path on it, and the guarantees below replace the ones above.

Adding a domain removes every limit in this section.

| | On `workers.dev` | With a domain |
| --- | --- | --- |
| a site's address | the name and the id are a path: `/report--k3f9x2ab71qz/` | the name and the id are in the hostname |
| separation between sites | the Worker serves every site page sandboxed, with `Content-Security-Policy: sandbox allow-scripts`, so the browser treats each page as its own origin | each site is its own origin |
| what a page can use | no browser storage (localStorage, cookies), no popups, no form submission | anything |
| links inside a site | relative only | anything |
| a private site | one self-contained file by default | a whole folder |
| junk traffic | nothing in front; the Worker's own limit per visitor is the guard, and every probe costs a request | only hostnames that end in the marker reach the Worker, and the rate rule runs before it when the zone's free slot allows it |
| the cookie | on that one hostname | on the parent domain |

What the sandbox keeps a site page from doing, in Chromium, Firefox, and WebKit:

- **Reading another site.** Each page is an origin of its own, so the other paths are closed to it.
- **Reading the login cookie.** The cookie is not available to the page.
- **Acting as the owner.** A page cannot call the owner's dashboard or the API with the owner's login.

This separation depends on the login cookie being Secure, HttpOnly, and SameSite=Lax. Poplin sets all three.

### A private site without a domain

A private site is one self-contained file by default. A sandboxed page's requests for its own extra files do not carry the login, so the Worker refuses them as it would refuse anyone.

One setting for the whole install allows a private site to be a whole folder instead:

```text
1. the owner opens the private address with the cookie
2. the Worker checks the cookie, then redirects to an address carrying a short-lived secret, 10 minutes by default
3. every file of the site is served under that address, with no cookie
```

**What the owner accepts by switching it on:** anyone holding that address can open the site until it expires. The Worker sends `Referrer-Policy: no-referrer` on every site response, so the address is not sent to another site in a referrer header.
