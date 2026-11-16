---
title: Between sites
order: 20
---

# Between sites

What a page of one site, or of another domain, can ask of a site; [Security](security.md) says who may open a site.

Each site is its own origin, so a page's scripts cannot read another site's pages or files. The dashboard's cookie is sent to the dashboard alone.

A browser still counts every site of the install, the dashboard, and every other hostname under the domain as one site. What a script of one site can do with that:

| A script of one site | Result |
| --- | --- |
| reads the dashboard's cookie, or a cookie another hostname set for itself alone | cannot |
| sets or replaces the dashboard's cookie | cannot: its name starts with `__Host-`, which a browser takes from the dashboard's hostname alone |
| changes anything in the dashboard as the logged-in owner | cannot: the dashboard refuses a write that any page but its own sent |
| sets cookies for the whole domain, under a name without the `__Host-` or `__Http-` prefix | can. The browser sends them to every site, to the dashboard, and to every other hostname under the domain |
| reads a cookie that a script of any hostname set for the whole domain | can |
| sets so many that the browser's requests grow too large | can. In that browser the sites and the dashboard answer an error until the cookies for the domain are cleared |

An application on another hostname of the domain that trusts a cookie by its name alone can be handed one this way. A domain that holds nothing but the install has no such application.

| Switch | Set on | Values |
| --- | --- | --- |
| `embeddable` | one site | on, the default; off: no page may show the site in a frame |
| `outside_pages` | the install | `blocked`, the default; `allowed` |

| A page asks for | Another site of the install | A page of another domain, `blocked` | A page of another domain, `allowed` |
| --- | --- | --- | --- |
| a link to a site | works | works | works |
| a site's images, styles, and classic scripts | works; never for a private site | refused with 403 | works; never for a private site |
| a site in a frame, `embeddable` on | works | refused | works; never for a private site |
| a site in a frame, `embeddable` off | refused | refused | refused |
| a site's files, read by its script | refused | refused | refused |

- **A private site needs the viewer's login in every row.** A browser sends Access's cookie only to the private site it was set for: with a link followed from anywhere, and with a request or a frame of a page of another site of the install. It does not send it with a request or a frame of a page of another domain.
- **A private site's files load in its own pages alone.** Every file of a private site carries `Cross-Origin-Resource-Policy: same-origin`, so a browser hands its images, styles, and scripts to no other page, a logged-in viewer's included. A frame is not held back by it.
- **No script reads another site's files.** No response carries a header that lets another origin's script read it.
- **A frame rule goes out with every file** unless the site is `embeddable` and `outside_pages` is `allowed`. For an `embeddable` site under `blocked` it names every hostname under the install's domain.

The Worker decides from the request's `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, `Origin`, and `Referer` headers and reads no content. Opening an address as the top-level page always passes, and so does a request with no `Sec-Fetch-Site` header.

| Under `blocked`, a page under the install's domain that is not a site | Result |
| --- | --- |
| its request names it in `Origin`, or in `Referer` when `Origin` holds no address | refused with 403 |
| its request names no page | passes |

**What a page's scripts can still do:** spend requests against the day's quota. The rate limit per visitor bounds that per address.
