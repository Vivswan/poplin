---
title: Security
order: 50
group: Reference
---

# Security

This page describes the design. It is updated as the product is built.

It says what poplin protects against and what it does not. Why the design is this way is on the [decisions page](decisions.md). Everything below assumes a domain on Cloudflare, except the last section, [Without a domain](#without-a-domain).

## What a secret link covers

An unlisted site promises what a shared document promises: anyone with the secret link can open it.

```text
https://page-report--7f3k9x2mq4ab.example.com      12 random characters, about 62 bits
```

| Threat | Covered | How |
| --- | --- | --- |
| guessing the address | yes | 62 random bits, and a rate limit per visitor that counts a miss three times |
| search engines | yes | `X-Robots-Tag: noindex` on every unlisted site, a robots file, and no public listing of unlisted sites |
| certificate logs | yes, in the default layout | one wildcard certificate covers every site, so no name is published; in the optional layout that orders a certificate per site, each certificate names its site |
| DNS listing | yes | one wildcard record |
| the next site's referrer | yes | `Referrer-Policy: no-referrer` on every page |
| a network reading plain DNS | partly | hidden when the browser uses encrypted DNS and Encrypted Client Hello; a plain lookup shows the name, never the page |
| whoever sees the address | no | see below |

## What a secret link does not cover

- **The address is the whole secret.** Anyone who sees it can open the site. No login stands behind it.
- **A pasted address travels.** Paste it in a chat and the chat's preview bot fetches it; forward it and the next reader has it.
- **A plain DNS lookup shows the name.** A network between the visitor and Cloudflare can learn that the address exists, though it cannot read the page.
- **A leak is fixed by rotating.** Rotating gives the site a new secret link and the old one stops working at once. Making the site private closes it to everyone but the owner.

## The three access states

| State | Address | Who opens it | What the visitor needs |
| --- | --- | --- | --- |
| private, the default | the short name | the owner | the login cookie |
| unlisted | the secret link; the short name still works for the owner | anyone with the secret link | the address alone |
| public | the short name | everyone | nothing |

A state changes in place: the site, its files, and its short name stay. A public site is kept out of search engines until the owner switches that on for the site.

## Who holds which credential

| Who | Credential | Where it comes from |
| --- | --- | --- |
| a person at the index or a private site | a login cookie | one login through Cloudflare Access, by email code or Google; the Worker checks the email against the list of allowed logins, then sets the cookie |
| an agent or the CLI | a token the Worker issues | the person clicks Authorize once in a browser; the token is listed on the index and can be revoked there |
| an agent with no browser | the same kind of token | authorized once from another machine, or created on the index and placed where the agent runs |
| the Worker, to the bucket | its binding inside Cloudflare | no bucket key exists outside Cloudflare |

A token the Worker issues is never a Cloudflare API key. It has one of two scopes:

| Scope | Given to | May |
| --- | --- | --- |
| publisher | an agent at Authorize, or a token created on the index | publish, and manage its own sites |
| admin | a person on the list of allowed logins; the login cookie carries the same rights | everything: every site, the settings, the tokens |

A site belongs to the token that created it, or to the admin's email when it was uploaded on the index. The Worker refuses another publisher token that publishes to a taken name.

What guards each address:

| Address | Guarded by |
| --- | --- |
| the login, the index, and the Authorize page | Cloudflare Access authenticates the person; the Worker checks the email, then sets the cookie |
| the token exchange, where an agent trades its code for a token | nothing in front; the standard OAuth exchange, proven by the code |
| the MCP server and the API | the token the Worker issued; no Access in front, so an agent needs no browser |
| a private or unlisted site, by its short name | the cookie |
| an unlisted site by its secret link; a public site | nothing |

Every site hostname answers GET and HEAD only. The Worker refuses every other method.

## No enumeration

```text
page-budget.example.com     private, no cookie   ->  404, with a small "log in" link
page-nothing.example.com    no such site         ->  the same 404
```

A private site without the cookie answers exactly like a name that does not exist, so a probe cannot learn which names are taken. The owner reaches private sites from the index.

## Hardening

| Measure | What the design does |
| --- | --- |
| the cookie | HttpOnly, Secure, SameSite Lax, set on the parent domain: no script can read it, and a cross-site post does not carry it |
| a removed login | the cookie names the email, and the Worker checks it against the allowed logins on every request; a removed login stops working within the settings cache, one minute |
| writes to the index | the Origin header must be the index itself; agents use bearer tokens, never the cookie |
| tokens at rest | stored hashed; an admin token expires after 30 days, a publisher token lives until revoked |
| the signing key | kept in the bucket, where the Worker can rotate it; "sign everyone out" rotates it and ends every cookie session; agent tokens are revoked one by one |
| the bucket | R2 public access stays off, and poplin's install check reports it when it is on |
| site headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, correct content types |
| the index | a strict Content-Security-Policy; it may never be framed |
| content | the Worker never reads, parses, or rewrites a site's files |
| the activity log | the index shows the last 100 actions: publish, state change, delete, login, token issued |
| junk hostnames | a firewall rule blocks, before the Worker, every hostname under the domain that is not a site, one of poplin's own, or one of the zone's other hostnames; a second rule limits each address to 300 requests per 10 seconds, and is skipped when the zone's one free rate rule is already in use |

## Between sites

Each site is its own origin, so a page's scripts cannot read another site or its cookie. No content policy is forced on a site.

| One page asks for | Result |
| --- | --- |
| a link to another site | always works; the visitor goes there themselves |
| a public or an unlisted site's files | works from any page; for an unlisted site the page must know the secret link |
| a private site's files | refused, unless the private site's own list of allowed sites names the asking site; the list is empty by default |

All sites of a domain share the login cookie, which is why the Worker refuses the third row. It decides from the request's `Origin` and `Sec-Fetch-Site` headers and reads no content. The owner opening a private address is a top-level navigation and is unaffected.

**What a page's scripts can still do:** spend requests against the day's quota. The rate limit per visitor bounds that per address.

## Without a domain

**Narrower guarantees.** With no domain, poplin starts on the account's free `workers.dev` address, which is one hostname. Every site is a path on it, and the guarantees below replace the ones above.

Adding a domain removes every limit in this section.

| | On `workers.dev` | With a domain |
| --- | --- | --- |
| a secret link | the secret is in the path | the secret is in the hostname |
| separation between sites | the Worker serves every site page sandboxed, with `Content-Security-Policy: sandbox allow-scripts`, so the browser treats each page as its own origin | each site is its own origin |
| what a page can use | no browser storage (localStorage, cookies), no popups, no form submission | anything |
| links inside a site | relative only | anything |
| a private site | one self-contained file by default | a whole folder |
| junk traffic | no firewall rules in front; the Worker's own limit per visitor is the guard, and every probe costs a request | firewall rules run before the Worker: the hostname rule, and the rate rule when the zone's free slot allows it |
| the cookie | on that one hostname | on the parent domain |

What the sandbox keeps a site page from doing, in Chromium, Firefox, and WebKit:

- **Reading another site.** Each page is an origin of its own, so the other paths are closed to it.
- **Reading the login cookie.** The cookie is not available to the page.
- **Acting as the owner.** A page cannot call the owner's index or the API with the owner's login.

This separation depends on the login cookie being Secure, HttpOnly, and SameSite=Lax. The design sets all three explicitly.

### A private site without a domain

A private site is one self-contained file by default. A sandboxed page's requests for its own extra files do not carry the login, so the Worker refuses them as it would refuse anyone.

One setting for the whole install allows a private site to be a whole folder instead:

```text
1. the owner opens the private address with the cookie
2. the Worker checks the cookie, then redirects to an address carrying a short-lived secret, 10 minutes by default
3. every file of the site is served under that address, with no cookie
```

**What the owner accepts by switching it on:** anyone holding that address can open the site until it expires. The Worker sends `Referrer-Policy: no-referrer` on every site response, so the address never leaks to another site.
