---
title: Between sites
order: 20
---

# Between sites

What a page of one site, or of another domain, can ask of a site; [Security](security.md) says who may open a site.

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
