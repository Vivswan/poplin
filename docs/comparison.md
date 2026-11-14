---
title: Comparison
order: 40
group: Reference
---

# Comparison

This page lists what poplin and four other tools do. Each cell is taken from the tool's own pages; "not stated" means those pages do not say.

| | Poplin | [handbill](https://handbill.dev) | [anvilnine/artifacts](https://github.com/anvilnine/artifacts) | [Pagecast](https://github.com/Amal-David/pagecast) | [Birta](https://birta.dev) |
| --- | --- | --- | --- | --- | --- |
| Where it runs | your own Cloudflare account: one Worker, one R2 bucket | your own Cloudflare account (one Worker, one R2 bucket), or the hosted handbill.dev | one container on a server you run | an app on your computer, which publishes to Cloudflare Pages in your account | Birta's hosted service |
| Private pages behind a login | yes, the default; open to the admins of the install | no | no; a password per page | no; a password per page | yes; an access setting limits a project to invited people, signed in |
| A secret link | yes | yes; every page has one | yes, the default | yes, the default | yes; a review link per version |
| Public pages | yes | yes, at a name you choose; self-hosted only | yes | yes | yes |
| Changing access without changing the address | yes; the short name stays, and visitors of an unlisted site use its secret link | no; the secret link and the name are separate addresses | yes; the address stays, and a private link carries a token | a password is set or removed in place; a short public link is a new address, and the old one redirects | yes; access is a setting on the project address |
| Whole folders (multi-file sites) | yes | no; one HTML file per link | yes, as a folder or a zip | yes | yes |
| A page listing all your sites | yes, private to the owner | not stated; the CLI lists them | yes, behind the admin login | yes, in the app on your computer | yes |
| MCP for agents | yes; one in the Worker, one on your machine | not stated; ships an agent skill | yes, in the server | yes, on your machine | yes; one hosted, one on your machine |
| A CLI | yes | yes | yes | yes | yes |
| Versions and rollback | yes; the last 3 versions by default | no; a revised page gets a new link and the old link is removed | a version history with the git storage backend; rollback not stated | a deploy history; rollback not stated | yes; the last 10 publishes |
| Source code | public; Individual and Small Organization License | public; MIT | public; MIT | public; MIT | not stated |
| Needs a domain | no; starts on the account's free `workers.dev` address | self-hosted: yes; hosted: no | the address is the `BASE_URL` you set; its default is `http://localhost:3000` | no; uses a `pages.dev` address | no; uses a `birta.link` address |
| Needs a server kept running | no | no | yes | no; Cloudflare Pages serves the pages | no |

Poplin's one-Worker, one-bucket shape follows [handbill](https://github.com/viktoravelino/handbill) by Viktor Avelino (MIT).

Three wider groups of tools, with one difference each:

| Group | Examples | What differs |
| --- | --- | --- |
| Hosted static hosts | [Surge](https://surge.sh), [GitHub Pages](https://docs.github.com/en/pages) | the files are stored with the host; poplin stores them in a bucket in your own Cloudflare account |
| Tunnels | [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [ngrok](https://ngrok.com/docs/) | a tunnel gives a public address to a program running on your machine; poplin serves stored files |
| Self-hosted tools | [Smallweb](https://www.smallweb.run) | the tool serves from a folder on a machine you operate; poplin runs on Cloudflare Workers |
