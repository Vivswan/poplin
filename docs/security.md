---
title: Security
order: 50
group: Reference
---

# Security

This page says what poplin protects against and what it does not.

## What unlisted covers

An unlisted site opens for anyone who has its address. No login stands in front of it.

```text
https://report--k3f9x2ab71qz-u-poplin.example.com
        |       |            | |
        |       |            | the marker: always -poplin
        |       |            the letter: u for an unlisted or a public site, p for a private one
        |       the id: 12 random characters, about 62 bits; it is the link
        the name: a label; several sites may share it, and it is not checked
```

The id alone finds the site. The letter never opens anything: the stored site decides who may read it, and a private site's files are not served at a `-u-` address.

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
- **Lists and commands show it.** The id shown in lists and commands is the link of an unlisted site. Someone who saw it while the site was private can open the site once it is unlisted, since the address differs by one known letter; running `poplin new-link` first avoids that.
- **A pasted address travels.** Paste it in a chat and the chat's preview bot fetches it; forward it and the next reader has it.
- **A plain DNS lookup shows the name.** A network between the visitor and Cloudflare can learn that the address exists, though it cannot read the page.
- **A leak is fixed by `poplin new-link`.** The site gets a new id, and the old address stops at once. Making the site private closes it to everyone but the owner.

## The three access states

| State | Address | Who opens it | What the visitor needs |
| --- | --- | --- | --- |
| private, the default | `report--k3f9x2ab71qz-p-poplin.example.com` | the owner | the login |
| unlisted | `report--k3f9x2ab71qz-u-poplin.example.com` | anyone who has the address | the address alone |
| public | the unlisted address, and a name the site claims: `report-page.example.com` | everyone | nothing |

A public name ends in the install's public word: `page`, or the word the installer chose once at install. A public name belongs to one site at a time, and stays with that site through `poplin new-link`.

A state changes in place: the site, its files, its id, and its label stay.

| Change | The address |
| --- | --- |
| within private; between unlisted and public | stays |
| private to unlisted or public | `-p-` becomes `-u-`; the `-p-` address sends a logged-in visitor to the `-u-` one |
| unlisted or public to private | `-u-` becomes `-p-`; the `-u-` address sends every visitor to the `-p-` one, where the login stands |

The CLI and the MCP tools print both addresses when a change moved a site.

What a private site costs:

- **One login step per site.** The first open of each private site passes once through Cloudflare's login. It is silent while the login session lasts.
- **Embedding needs a direct visit first.** A private site shown inside another page, as a frame, an image, or a style, loads only in a browser that opened that private site itself during the login session. Unlisted and public sites embed as before.

| Switch for search engines | Set on | Off, the default | On |
| --- | --- | --- | --- |
| `search_engines` | one public site | its files carry `X-Robots-Tag: noindex` | they do not |
| `search_engines_allowed` | the install | the bots rule at Cloudflare's edge stops the crawlers Cloudflare has verified | the rule lets the crawlers of search engines pass |

A search engine's crawler reads a public site without `noindex` only when both are on, where the zone holds the bots rule.

## Who holds which credential

| Who | Credential | Where it comes from |
| --- | --- | --- |
| a person at the dashboard | the dashboard's cookie | one login through Cloudflare Access, by email code or Google; the Worker checks the email against the list of allowed logins, then sets a cookie for the dashboard's hostname alone |
| a person at a private site | Cloudflare Access's own session, 30 days | the same login; Access puts a signed token on every request it lets through, and the Worker checks the token and the email against the list of allowed logins each time |
| the CLI, or an agent through `poplin mcp` | a token the Worker issues | the person runs `poplin login` once and allows that computer in a browser; the token is listed on the dashboard and can be revoked there |
| a machine with no browser | the same kind of token | `poplin login` prints an address and a short code to open on another device, where the person allows that computer |
| the Worker, to the bucket and the database | its bindings inside Cloudflare | no bucket key and no database key exists outside Cloudflare |

A token the Worker issues is never a Cloudflare API key. It has one of two scopes:

| Scope | Given to | May |
| --- | --- | --- |
| publisher | a computer a person logs in with `poplin login --publisher` and allows on the dashboard's Tokens tab, for an agent | publish, and manage its own sites |
| admin | a person on the list of allowed logins; the dashboard's cookie carries the same rights | everything: every site, the settings, the tokens |

A site belongs to the token that created it, or to the admin's email when it was duplicated on the dashboard. A publisher token updates and manages only the sites it created.

What guards each address:

| Address | Guarded by |
| --- | --- |
| the login and the dashboard | Cloudflare Access authenticates the person at the login path; the Worker checks the email, then sets the dashboard's cookie |
| the API, which the CLI and `poplin mcp` call | the token the Worker issued; no Access in front, so a machine needs no browser after its login |
| a private site, `-p-poplin` | Cloudflare Access, before the Worker runs; then the Worker checks Access's token and the email |
| an unlisted site; a public site | nothing |

One Access application covers the login path and every address that ends in `-p-poplin.<domain>`. It is made once at install, never per site.

Every site hostname answers GET and HEAD only. A rule at Cloudflare's edge blocks every other method there, and the Worker refuses one that still arrives.

## No enumeration

```text
budget--x7k2p94mdq1c-u-poplin.example.com    private              ->  302 to the same address under -p-
budget--w8t1c5n0ze4u-u-poplin.example.com    no such site         ->  the same 302
budget--x7k2p94mdq1c-p-poplin.example.com    no login             ->  Cloudflare's login page, for every address alike
budget-page.example.com                      no such public name  ->  404
```

A `-u-` address answers one redirect when its site is private, in the trash, expired, or was never made. A probe cannot tell a private site from an address that has none. The redirect keeps the path and the query, is never cached, and counts against the visitor's requests, never the site's.

A `-p-` address is answered by Cloudflare's login before the Worker sees it. A request that reaches the Worker without Access's token gets 404: no file, and no redirect.

## After an update

| A visitor | Sees |
| --- | --- |
| who opens a page of an unlisted or public site | the new version within 5 minutes; a private site's page at once |
| whose browser held the older page | the new page, and on that visit its styles, scripts, and images again, in a browser that honours `Clear-Site-Data` |
| of another page that shows a site's file | that file up to a day old |

## Hardening

| Measure | What poplin does |
| --- | --- |
| the dashboard's cookie | HttpOnly, Secure, SameSite Lax, for the dashboard's hostname alone: no script can read it, no site receives it, and a cross-site post does not carry it |
| the login of a private site | Cloudflare Access's cookie, HttpOnly and SameSite Lax, one per site hostname, 30 days |
| a removed login | the Worker checks the email against the allowed logins on every request: the dashboard stops at once, a private site within one minute, whatever session Access still holds |
| writes to the dashboard | the Origin header must be the dashboard itself; agents use bearer tokens, never the cookie |
| tokens at rest | stored hashed; an admin token expires after 30 days, a publisher token lives until revoked |
| the signing key | kept in the database, where the Worker can rotate it; "sign everyone out" rotates it and ends every dashboard session. A private site's login is Access's own: removing the login ends it. Agent tokens are revoked one by one |
| the bucket and the database | R2 public access stays off; the database is reached only through the Worker's binding |
| site headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, correct content types |
| page views | a site shows about how often its pages were opened, from a sampled count per site and UTC day kept seven days; it counts opens, not people: no address, cookie, or browser name of a visitor is stored |
| the dashboard | a strict Content-Security-Policy; it may never be framed |
| content | the Worker never reads, parses, or rewrites a site's files |
| the activity log | the dashboard's Activity tab shows every action, 50 a page, with an Older link: publish, state change, delete, login, token issued |
| plain http | the Worker sends every request over `http` to the same address over `https`, with a 308, before it reads anything of the install; a rule at Cloudflare's edge does the same before the Worker runs, where the token had the permission for it. Every answer of a site and of the dashboard tells the browser to use `https` alone for 180 days. The zone's other hostnames are left as they are |
| junk requests | a rule at Cloudflare's edge blocks, on the site hostnames, every method but GET and HEAD and the paths scanners ask for: `*.php`, `/.env`, `/.env.*`, `/.git/`, `/wp-admin/`, `/cgi-bin/`, `/phpmyadmin` |
| junk hostnames | Cloudflare routes to the Worker only the hostnames that end in `-poplin` or the public word, so no other hostname under the domain reaches it; a rate rule limits each address to 300 requests per 10 seconds. Setup skips it when other rules hold every rate rule the plan allows, or when a Free plan zone has hostnames of its own; the OpenTofu module, which owns the zone's rate rules, stops with a message in that second case |

## Between sites

Each site is its own origin, so a page's scripts cannot read another site or its cookie. The dashboard's cookie is sent to the dashboard alone.

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

- **A private site needs the viewer's login in every row.** A browser sends Access's cookie only to the private site it was set for, and not with a request that a page of another domain makes.
- **No script reads another site's files.** No response carries a header that lets another origin's script read it.
- **A frame rule goes out with every file** unless the site is `embeddable` and `outside_pages` is `allowed`. For an `embeddable` site under `blocked` it names every hostname under the install's domain.

The Worker decides from the request's `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, `Origin`, and `Referer` headers and reads no content. Opening an address as the top-level page always passes, and so does a request with no `Sec-Fetch-Site` header.

| Under `blocked`, a page under the install's domain that is not a site | Result |
| --- | --- |
| its request names it in `Origin`, or in `Referer` when `Origin` holds no address | refused with 403 |
| its request names no page | passes |

**What a page's scripts can still do:** spend requests against the day's quota. The rate limit per visitor bounds that per address.
