---
title: Security
order: 10
---

# Security

This page says what poplin protects against and what it does not. Its addresses and rows are those of an install under a domain; [Without a domain](#without-a-domain) says what differs on an install that has none.

## What unlisted covers

An unlisted site opens for anyone who has its address. No login stands in front of it.

```text
https://report--k3f9x2ab71qz-u-poplin.example.com
        |       |            | |
        |       |            | the marker: always -poplin
        |       |            the letter: u for an unlisted or a public site, p for a private one
        |       the id: 12 random characters, about 62 bits; it is the link
        the name: several sites may share it, and it is not checked
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
- **A leak is fixed by `poplin new-link`.** The site gets a new id, and the old address stops at once. Making the site private closes it to everyone but the users of the install.

## The three access states

| State | Address | Who opens it | What the visitor needs |
| --- | --- | --- | --- |
| private, the default | `report--k3f9x2ab71qz-p-poplin.example.com` | the users of the install | the login |
| unlisted | `report--k3f9x2ab71qz-u-poplin.example.com` | anyone who has the address | the address alone |
| public | the unlisted address, and a name the site claims: `report-page.example.com` | everyone | nothing |

A public name ends in the install's public word, `page`. A public name belongs to one site at a time, and stays with that site through `poplin new-link`.

A state changes in place: the site, its files, its id, and its label stay.

| Change | The address |
| --- | --- |
| within private; between unlisted and public | stays |
| private to unlisted or public | `-p-` becomes `-u-`; the `-p-` address sends a logged-in visitor to the `-u-` one |
| unlisted or public to private | `-u-` becomes `-p-`; the `-u-` address sends every visitor to the `-p-` one, where the login stands |

The CLI and the MCP tools print both addresses when a change moved a site.

What a private site costs:

- **One login step per site.** The first open of each private site passes once through Cloudflare's login. It is silent while the login session lasts.
- **Embedding needs a direct visit first.** While Allow embedding is on, as on a new site, a private site and its files load in a page of another site of the install, in a browser that opened that private site itself during the login session. Neither loads in a page of another domain. Off stops both: turn it off for anything sensitive. [Between sites](between-sites.md) has the rows.

| Switch for search engines | Set on | Off, the default | On |
| --- | --- | --- | --- |
| `search_engines` | one public site | its files carry `X-Robots-Tag: noindex` | they do not |
| `search_engines_allowed` | the install | every site's files carry `X-Robots-Tag: noindex`; the bots rule at Cloudflare's edge stops the crawlers Cloudflare has verified, and lets through an assistant that opens one page for a person and a chat app that fetches a shared link for its preview | the rule lets the crawlers of search engines pass |

A public site is without `noindex` only when both are on. The bots rule is one of the [optional edge rules](#optional-edge-rules).

## Who holds which credential

| Who | Credential | Where it comes from |
| --- | --- | --- |
| a user at the dashboard | Cloudflare Access's own session, 30 days | one login through Cloudflare Access, by a code Cloudflare sends to the email; Access puts a signed token on every request it lets through, and the Worker checks the token and the email against the list of allowed users each time. poplin sets no cookie of its own  |
| a user at a private site | Cloudflare Access's own session, 30 days | the same login; Access puts a signed token on every request it lets through, and the Worker checks the token and the email against the list of allowed users each time  |
| the CLI, or an agent through `poplin mcp` | a token the Worker issues | a user runs `poplin login` once and allows that machine in a browser; an agent on that machine acts with the same token, as that user; the token is listed on the dashboard and can be revoked there |
| a machine with no browser | the same kind of token | `poplin login` prints a URL and a short code to open on another device, where a user allows that machine      |
| the Worker, to the bucket and the database | its bindings inside Cloudflare | no database key exists outside Cloudflare; the one bucket key is the upload key below |
| the CLI, to the bucket, for the files of a publish | one ticket a file: a signed address that lives 10 minutes | the Worker signs it with the upload key, which never leaves the Worker; [The upload key](#the-upload-key) says what a ticket and the key can reach |
| the person who makes the install | a Cloudflare API token, read by `poplin install` on that person's own machine | the person makes it at Cloudflare; the command sends it to Cloudflare alone, uses it for that one run, in which it also makes the kept key, and never stores, logs, or prints it |
| a person who repairs the install | a Cloudflare API token, pasted into Repair on the Domain screen, or read by `poplin doctor --repair` on that person's own machine | the Worker uses a pasted one for that one request, in which a Repair also makes the kept key, and never stores, logs, or shows it; the command sends its own to Cloudflare alone |
| the Worker, to Cloudflare's API | one kept key, an API token named "poplin kept key" that the account owns | `poplin install` makes it in its run, and puts it on the Worker as an encrypted secret. A Repair makes a new one where the install holds none, or one Cloudflare no longer takes; [The kept key](#the-kept-key) says what it may do |
| the Worker, to update itself | the kept key | the Worker fetches the release's built files, checks each against the digests poplin's website publishes, and uploads them in place of its own code: [Update](../upkeep/update.md#with-the-kept-key) |

A token the Worker issues is never a Cloudflare API key. It has one of two scopes:

| Scope | Given to | May |
| --- | --- | --- |
| publisher | a machine or a script that should only publish, such as a build server or a shared machine: a user logs it in with `poplin login` and leaves Can change at Publisher on the page that approves it. `poplin login --publisher` saves no other kind, whatever that page chose | publish, and manage its own sites |
| admin | a user, whose email is on the list of allowed users; a user's login at the dashboard carries the same rights  | everything: every site, the settings, the tokens |

The page that allows a machine's login treats what the login says of itself as a stranger's words, since anyone can begin one:

| The page | So |
| --- | --- |
| has the fixed title `Approve this login?`, and shows the machine's name in quotes beside `Name it gave` | a login cannot write the question a user answers |
| starts at Publisher, whatever the login asked for | a token for everything is given only by a user who chose Admin |
| is reached by an address that names the login and holds no part of its code | a link someone sent gives nothing to type |
| is given no part of the code; the Worker checks the 4 letters the user types | the letters are in the terminal alone, so only its reader can allow the login |
| opened by an address and not by a press on Review, says that anyone can start a login and send its link | a user who was sent a link is told so |
| refuses a name with a line break, a control character, or a character that hides or turns text around | a name reads as it was written |

A site belongs to the token that created it, or to the admin's email when it was duplicated on the dashboard. A publisher token updates and manages only the sites it created.

## The upload key

```text
poplin ./report  ->  the Worker hands out one ticket a file  ->  each file goes straight to the bucket
```

A ticket is a signed address for one file. The bucket itself checks it:

| A ticket allows | The bucket refuses |
| --- | --- |
| one write, to the one place the publish declared | another place, a read, a removal, a second write |
| the declared length, type, and SHA-256 | other bytes, another length, another type |
| 10 minutes, or to within a second of the publish's own end where that is sooner | a ticket that ran out |

`poplin install` makes the key beside the kept key, as an API token named "poplin upload key" that the account owns. A Repair makes a new one where the install holds none.

| Question | Answer |
| --- | --- |
| Where it lives | on the Worker, as an encrypted secret, `UPLOAD_KEY`. Not in the database, a backup, or an export. What is kept is the token's id and the SHA-256 of its value: the two the bucket's API takes as its key, so whoever holds them holds the key |
| What it reaches | the objects of the install's one bucket: it can read, write, list, and delete them. Cloudflare has no narrower permission that writes |
| What it may not do | reach another bucket, the database, a Worker, the domain, or the account's settings; make another key |
| What a publisher sees | the account's id and the bucket's name, in the address of each ticket |
| How to end it | delete the token "poplin upload key" at Cloudflare, under Manage Account, Account API Tokens. Publishing goes on, through the Worker |
| How to get a new one | press Repair on the Domain screen with an account token |

Whoever holds the key itself, which only the Worker's code can read, could read and change every file of every site from outside the Worker, private sites included.

Without the key, or for the first minutes of a new one, every file goes through the Worker, checked the same way. A file the bucket refuses twice goes through the Worker too, and the install notes [a problem](../fix/problems.md#what-is-noted).

## The kept key

```text
you give one account token  ->  poplin install makes "poplin kept key" at Cloudflare  ->  a secret on the Worker, KEPT_KEY
                                Repair makes a new one where the install holds none, or one Cloudflare no longer takes
```

| Question | Answer |
| --- | --- |
| Where it lives | on the Worker, as an encrypted secret. Not in the database, a backup, or an export. No screen and no answer of poplin shows it, and Cloudflare never shows it again |
| What it reaches | your one account and your one domain; the account alone on an install without a domain |
| What it may do | read the account's usage figures and the team's name; change Access applications and their policies, notifications, and the domain's WAF rules; replace the code and the settings of a Worker; read the domain, its settings, DNS records, Worker routes, redirect rules, and bot settings |
| What it does by itself | once a day it puts the login back: the two Access applications, their policies, and the Worker's `ACCESS` variable, where one is missing or differs. Activity says what it wrote. It also makes the [budget alert](../dashboard/domain.md#optional-an-email-when-charges-reach-1-dollar), and under a domain the [certificate alert](../dashboard/domain.md#an-email-about-certificates), where the account has none |
| What it may not do | change a DNS record, a Worker route, a redirect rule, or a bot setting; make or delete a bucket or a database; make another key |
| How to end it | delete the token "poplin kept key" at Cloudflare, under Manage Account, Account API Tokens. Sites, logins, and publishing go on |
| How to get a new one | once the token is deleted, press Repair on the Domain screen with an account token: it makes a new key and deletes every other token of that name |

Cloudflare limits the key to the account and the domain, not to poplin's own objects: it reaches every Access application of the account and every WAF rule of the domain.

The [Domain](../dashboard/domain.md#check-needs-no-token) screen reads every piece with the key, so its Check asks for no token. Repair still takes a pasted account token.

**The key can replace any Worker of the account.** poplin uses that permission on its own Worker alone: to update itself, to put the version before back after an update whose database step failed, and to write the login's variable. Cloudflare gives the permission for a whole account or not at all: a key limited to one Worker is refused on every call.

So a bug or a bad release of poplin could reach every other Worker the account holds. poplin is best in an account that holds only poplin.

What guards each address:

| Address | Guarded by |
| --- | --- |
| the dashboard: every address of its hostname but `/api` | Cloudflare Access, before the Worker runs; then the Worker checks Access's token and the email on every request |
| the API, `/api`, which the CLI and `poplin mcp` call | the token the Worker issued; Access lets everyone through to it, so a machine needs no browser after its login |
| a private site, `-p-poplin` | Cloudflare Access, before the Worker runs; then the Worker checks Access's token and the email |
| an unlisted site; a public site | nothing |
| a Worker with no place to answer at yet: the moments between its first upload and the values `poplin install` writes | nothing to guard: it answers every address with two plain lines that name the command, opens no database and no bucket, and takes no token |
| the Worker's own `workers.dev` address, on an install under a domain | the install switches it off: nothing answers there |

Two Access applications do this, made once at install, never per site:

| Application | Covers | Lets in |
| --- | --- | --- |
| the login | the dashboard's whole hostname, and every address that ends in `-p-poplin.<domain>` | your users, after Cloudflare's login |
| the open path | `/api` of the dashboard's hostname | everyone: the Worker asks its own token there |

One weakness is known. A page of a site of the same install can set a cookie for the whole domain, named like Cloudflare's login cookie. A browser that holds one before it logs in is sent back to the login each time, at the dashboard and at private sites, until its cookies for the domain are cleared.

Nothing leaks. On an install whose dashboard matters, publish only pages you trust.

Every site hostname answers GET and HEAD only. The Worker refuses every other method, and the optional bots rule at Cloudflare's edge blocks it before the Worker.

## Without a domain

```text
https://poplin.your-name.workers.dev                                 the dashboard, the API
https://poplin-sites.your-name.workers.dev/report--k3f9x2ab71qz/     every unlisted and public site, a path each
https://poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/   every private site, a path each
```

An install [without a domain](../start/without-a-domain.md) answers at three hostnames of the address Cloudflare gives the account. What differs on this page:

| Here | Without a domain |
| --- | --- |
| sites in one browser | the open sites are one origin, and so are the private sites: a script of one reads another of its kind. [Between sites](between-sites.md#without-a-domain) has the rows |
| the login | covers the dashboard's hostname and the whole hostname of the private sites. One login opens every private site |
| a private site's address | a path on the hostname of the private sites. The hostname of the open sites sends a private or unknown label there, as a `-u-` address does |
| a public name | a path on the hostname of the open sites: `poplin-sites.your-name.workers.dev/docs/` |
| DNS and certificates | hold hostnames alone. A site's name and id are in the path, which neither holds |
| the `workers.dev` address | is the dashboard's own |
| the account token | six permissions to install and five to repair, all of the account |
| the kept key | the account's permissions alone: it reads and writes nothing of a domain |
| rules at Cloudflare's edge | none. Every request reaches the Worker, and its limits per visitor and per site count it |
| `block_bots` | does nothing. `search_engines_allowed` and `outside_pages` work through the Worker |

## No enumeration

```text
budget--x7k2p94mdq1c-u-poplin.example.com    private              ->  302 to the same address under -p-
budget--w8t1c5n0ze4u-u-poplin.example.com    no such site         ->  the same 302
budget--x7k2p94mdq1c-p-poplin.example.com    no login             ->  Cloudflare's login page, for every address alike
budget-page.example.com                      no such public name  ->  404
```

A `-u-` address answers one redirect when its site is private, in the trash, expired, or was never made. A probe cannot tell a private site from an address that has none. The redirect keeps the path and the query, is never cached, and counts against the visitor's requests, never the site's.

A `-p-` address is answered by Cloudflare's login before the Worker sees it. A request that reaches the Worker without Access's token gets 404: no file, and no redirect.

Poplin's icon is answered only for a site the address may open. Every address above answers `/favicon.ico` as it answers any other path.

## After an update

| A visitor | Sees |
| --- | --- |
| who opens a page of an unlisted or public site | the new version within 5 minutes; a private site's page at once |
| whose browser held the older page | the new page, and on that visit its styles, scripts, and images again, in a browser that honours `Clear-Site-Data` |
| of another page that shows a site's file | that file up to a day old |

## Hardening

| Measure | What poplin does |
| --- | --- |
| the login of the dashboard | Cloudflare Access's cookie, HttpOnly and SameSite Lax, for the dashboard's hostname alone, 30 days: no script can read it, and no site receives it. A browser counts every site of the install as the same site as the dashboard, so SameSite Lax holds back only what a page of another domain sends, a followed link aside; the row on writes covers a site's page |
| the login of a private site | Cloudflare Access's cookie, HttpOnly and SameSite Lax, one per site hostname, 30 days |
| a removed user  | the Worker checks the email against the allowed users on every request: the dashboard stops at once, a private site within one minute, whatever session Access still holds  |
| writes to the dashboard | a write is refused when its `Origin` or `Sec-Fetch-Site` header names any page but the dashboard's own, a site of the same install included, and when it is not JSON; the CLI and `poplin mcp` use bearer tokens, never the cookie |
| tokens at rest | a token itself is never stored: the database keeps its SHA-256 hash. An admin token runs out after 30 days, a publisher token lives until it is removed. Every token ends when the user who allowed it is removed |
| a token that ended | a revoked token never logs in again, and its row is removed once it ended more than 90 days ago, a few rows at a time; [Revoked tokens](../dashboard/access.md#tokens) lists the 50 that ended last in that time |
| every login at once | Sign everyone out, under Access, asks Cloudflare with the kept key to end every login of the dashboard and of private sites: each browser meets the login again at its next request, a few seconds on. A machine's token is untouched, and is revoked on its own |
| the stored key | kept in the database; the limits per visitor are made from it |
| the bucket and the database | R2 public access stays off; the database is reached only through the Worker's binding |
| site headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and correct content types on every answer of a site but three: the 308 from plain http, the 429 of a limit, and the page of a paused site carry neither header. The files of a site whose Allow embedding is off carry one more, which [Between sites](between-sites.md) describes |
| visits | a site shows about how often its pages were opened, from a sampled count per site and UTC day kept a year; it counts opens, not people: no address, cookie, or browser name of a visitor is stored |
| the dashboard | a strict Content-Security-Policy; it may never be framed |
| a published file | before a file's bytes, the CLI sends its path, its size, its type, and its fingerprint, a SHA-256 of its bytes. The storage checks the bytes against the fingerprint as they arrive. A file of other bytes is refused and stored nowhere, one of the same length included |
| content | the Worker never reads, parses, or rewrites a site's files, and adds none to them. A site that holds no `favicon.ico` is answered poplin's own icon at `/favicon.ico`, from the Worker's code |
| the activity log | the dashboard shows every action of the last 90 days under Activity: publish, state change, delete, login, token issued. [Activity](../dashboard/activity.md) says how it is paged and saved as files |
| plain http | the Worker sends every request over `http` to the same address over `https`, with a 308, before it reads anything of the install; an optional rule at Cloudflare's edge does the same before the Worker runs. The zone's other hostnames are left as they are |
| `https` alone, afterwards | every answer of a site and of the dashboard tells the browser to use `https` alone for 180 days, but for the 308 from plain http, the 429 of a limit, the page of a paused site, and the Worker's own plain answers, such as the one of an install that could not start |
| the Worker's log | Cloudflare keeps the lines the Worker writes about refusals and errors, with its own record of each request switched off. poplin writes into no line a token, a cookie, a login code, an email, a visitor's address, or a site's id: [the Worker's log](../dashboard/activity.md#the-workers-log-at-cloudflare) |
| an address in the Worker's log | Cloudflare stores each line with the whole address of its request. So the address of a private or an unlisted site, which holds its id, is in the log for a request in which the Worker wrote a line, such as one that met an error. Whoever can read the account's logs can read it: [what Cloudflare stores with a line](../dashboard/activity.md#what-cloudflare-stores-with-a-line) |
| the Worker's log, switched off | `poplin config provider_logs off`, or Keep logs on the Settings screen: Cloudflare keeps no line, so no address. It holds across updates. Problems and Activity go on, and a fault can no longer be read at Cloudflare: [switch the logs off](../dashboard/activity.md#switch-the-logs-off) |
| junk requests | the optional bots rule at Cloudflare's edge blocks, on the site hostnames, every method but GET and HEAD and the paths scanners ask for: `*.php`, `/.env`, `/.env.*`, `/.git/`, `/wp-admin/`, `/cgi-bin/`, `/phpmyadmin` |
| a release an update deploys | an install that updates with its key uploads a release's built Worker only when the manifest's SHA-256 digest is the one poplin's website publishes for that version, and each built file's digest and size are the manifest's; any other file changes nothing. [Update](../upkeep/update.md#with-the-kept-key) has each refusal |
| what a release rests on | a release publishes its built Worker, and the website publishes the manifest's digest only when GitHub attests every file was made by the project's release workflow from its main branch. What stays trusted: that branch, that workflow, GitHub's attestation, the website, and the packages the release's lockfile pins: [what a release publishes](../upkeep/update.md#what-a-release-publishes) |
| junk hostnames | Cloudflare routes to the Worker only the hostnames that end in `-poplin` or the public word, so no other hostname under the domain reaches it; an optional rate rule limits each address to 300 requests per 10 seconds, [counted in each data center](../upkeep/cost/limits.md#where-a-limit-is-counted). The install and a Repair skip it when other rules hold every rate rule the plan allows, or when a Free plan zone has hostnames of its own |

## Optional edge rules

The account token of an install under a domain needs ten permissions to install, and nine to repair. Four more are optional: with three, the install or a Repair makes rules at Cloudflare's edge, and with one it makes the budget alert and the certificate alert at once. [Domain](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) says how to add them.

| Permission | With it, Repair makes | Without it |
| --- | --- | --- |
| Zone WAF: Edit | the bots rule, the outside pages rule, and the rate rule | Repair makes none of the three. Requests no rule stops reach the Worker. It refuses a page of another domain while `outside_pages` is `blocked`, and sends `noindex` as the two switches say |
| Single Redirect: Edit | the redirect of plain http | the Worker sends the same redirect |
| Bot Management: Edit | the block of AI crawlers that `block_bots` asks for | `block_bots` is stored and nothing applies it |

Two of the rules need no added permission. On an install with a domain that holds [its key](#the-kept-key), saving `search_engines_allowed` or `outside_pages` makes both match the settings, with the key:

| Rule | After the save |
| --- | --- |
| the bots rule | there; an assistant that opens one page for a person and a chat app's fetch for a link preview pass it, and the crawlers of search engines pass it while `search_engines_allowed` is on |
| the outside pages rule | there while `outside_pages` is `blocked`, and removed while it is `allowed` |

A rule the domain lacks is made, and one its plan has no room for is left out. [Domain](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) says which install holds a key.
