---
title: Between sites
order: 20
---

# Between sites

What a page of one site, or of another domain, can ask of a site; [Security](security.md) says who may open a site.

Each site is its own origin, so a page's scripts cannot fetch another site's pages or files and read what comes back. A page can still run another site's script file, as the tables below say. The cookie of the dashboard's login is sent to the dashboard alone.

A browser still counts every site of the install, the dashboard, and every other hostname under the domain as one site. What a script of one site can do with that:

| A script of one site | Result |
| --- | --- |
| reads the cookie of the dashboard's login, or a cookie another hostname set for itself alone | cannot |
| sets a cookie for the whole domain under the name of Cloudflare's login cookie, `CF_Authorization` | can. A browser that holds it before its person logs in is sent to the login again and again, at the dashboard and at every private site, until the cookies for the domain are cleared. It opens nothing: the cookie holds no login |
| changes anything in the dashboard as the logged-in owner | cannot: the dashboard refuses a write that any page but its own sent |
| sets cookies for the whole domain, under a name without the `__Host-` or `__Http-` prefix | can. The browser sends them to every site, to the dashboard, and to every other hostname under the domain |
| reads a cookie that a script of any hostname set for the whole domain | can |
| sets so many that the browser's requests grow too large | can. In that browser the sites and the dashboard answer an error until the cookies for the domain are cleared |

An application on another hostname of the domain that trusts a cookie by its name alone can be handed one this way. A domain that holds nothing but the install has no such application.

| Switch | Set on | Values |
| --- | --- | --- |
| `embeddable` | one site | on, the default; off |
| `outside_pages` | the install | `blocked`, the default; `allowed` |

| `embeddable` | The site in a frame | Its images, styles, and classic scripts |
| --- | --- | --- |
| on | another page may show it | another page may load them |
| off | no page may | no page but the site's own may |

The switch means the same for a private, an unlisted, and a public site, and a change of who can open a site leaves it as it is.

| A page asks for | Another site of the install | A page of another domain, `blocked` | A page of another domain, `allowed` |
| --- | --- | --- | --- |
| a link to a site | works | works | works |
| a site's images, styles, and classic scripts, `embeddable` on | works | refused with 403 | works; never for a private site |
| a site's images, styles, and classic scripts, `embeddable` off | refused by the browser | refused with 403 | refused by the browser; a private site at its login |
| a site in a frame, `embeddable` on | works | refused | works; never for a private site |
| a site in a frame, `embeddable` off | refused | refused | refused |
| a site's files, fetched and read by its script | refused | refused | refused |

- **A private site needs the viewer's login in every row.** A browser sends Access's cookie only to the private site it was set for: with a link followed from anywhere, and with a request or a frame of a page of another site of the install. It does not send it with a request or a frame of a page of another domain.
- **A new site starts with `embeddable` on, a private one included.** Another site of the install can show it in a frame and load its files, in the browser of a viewer who may open it. A script loaded that way runs in the other page, which reads what it defines. For anything sensitive turn it off: `poplin set <site> --embeddable off`, or Allow embedding in the site's panel.
- **Off, a site's files load in its own pages alone.** Every file of the site carries `Cross-Origin-Resource-Policy: same-origin` beside its frame rule, so a browser hands its images, styles, and scripts to no page at another address, a logged-in viewer's included.
- **Off counts each address on its own.** A public site answers at two addresses. A page at one loads a file it names without a hostname, and not one it names by the other address in full. A browser that holds a file from before the switch went off loads it until its copy runs out, a day at most.
- **No script fetches another site's file and reads it.** No response carries a header that lets another origin's script read what it fetched. A script file that a page loads as a script is the row above it: it runs in that page.
- **A frame rule goes out with every file** unless the site is `embeddable` and `outside_pages` is `allowed`. For an `embeddable` site under `blocked` it names every hostname under the install's domain.

## Without a domain

An install [without a domain](../start/without-a-domain.md) has three hostnames. Every unlisted and public site is a path on one, every private site a path on another, and the dashboard has the third to itself.

**The open sites share one browser origin, and so do the private sites: publish only pages you trust, or add a domain.**

| A script of one site | Under a domain | Without a domain |
| --- | --- | --- |
| reads the dashboard's data, or changes anything in it | cannot | cannot: the dashboard is another origin |
| reads a private site, from an open site | cannot | cannot: the private sites are another origin |
| reads another open site whose address it knows | cannot | can |
| reads another private site whose address it knows, in the browser of a viewer who is logged in | cannot | can |
| reads another site's browser storage, or the cookies a script set | cannot | can, among the open sites and among the private sites |
| takes over another site with a service worker | cannot | cannot: a worker's reach ends at its own site's path |

- **One login opens every private site.** They are one hostname, so Cloudflare's login cookie is one.
- **`embeddable` off keeps a site's files from pages of another hostname alone.** A page of another site on the same hostname is the same origin, and loads them.
- **A site's browser cache is its hostname's.** When the Worker tells a browser to clear a site's cache, the browser clears it for every site on that hostname.
- **Nothing runs before the Worker.** No rule of Cloudflare's stops a request first, so every request counts against the day's quota; the limits per visitor and per site still hold.

The Worker decides from the request's `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, `Origin`, and `Referer` headers and reads no content. Opening an address as the top-level page always passes, and so does a request with no `Sec-Fetch-Site` header.

| Under `blocked`, a page under the install's domain that is not a site | Result |
| --- | --- |
| its request names it in `Origin`, or in `Referer` when `Origin` holds no address | refused with 403 |
| its request names no page | passes |

**What a page's scripts can still do:** spend requests against the day's quota. The rate limit per visitor bounds that per address.
