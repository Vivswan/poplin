# The OpenTofu module

Sets up a poplin install on one Cloudflare zone.

```hcl
module "poplin" {
  source = "github.com/Vivswan/poplin//packages/cloudflare/tofu?ref=<release tag>"

  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "./worker.js"
}
```

The caller configures the `cloudflare` provider, major 5, and runs OpenTofu 1.13 or newer. `worker_bundle_path` is the path of a Worker bundle file the caller provides. An install with no domain needs no zone and is not set up by this module.

## What it creates

| Resource | Purpose |
| --- | --- |
| R2 bucket | holds every site's files; its public access is off |
| D1 database | holds every record: the sites, the tokens, the settings, the audit log. The module applies no schema: the Worker does when it opens the database |
| Worker script | serves the sites, the dashboard, the API, and the MCP server; uploaded from the bundle with the bucket, the database, the minute limiter, the zone values, and the first settings bound to it |
| Worker routes | send the install's hostnames, and no other hostname of the zone, to the Worker |
| DNS records | proxied, each with a comment starting `poplin: ` |
| Access policy and application | the login on `/login` of the admin hostname, allowing exactly `logins` |
| Rate rule | blocks an address for 10 seconds after 300 requests in 10 seconds |
| Guard rules | two custom rules that block a request to a site hostname before the Worker runs: one from a page of another domain, one from a verified bot |
| Bot settings | the zone's AI bot block, on a zone with no hostnames of its own |

Records and routes, for `example.com` with the default hostnames:

| Hostname | Example | DNS record | Worker route |
| --- | --- | --- | --- |
| a site | `report--k3f9x2ab71qz-page.example.com` | `*.example.com` | `*-page.example.com/*` |
| a public site's public name | `docs-page.example.com` | `*.example.com` | `*-page.example.com/*` |
| the dashboard | `admin.example.com` | `admin.example.com` | `admin.example.com/*` |
| the gallery, while `gallery` is on | `gallery-page.example.com` | `*.example.com` | `*-page.example.com/*` |

DNS has no partial wildcard, so the wildcard record covers every name under the domain that has no record of its own, while the route sends only the names ending in the suffix to the Worker. The module reads the zone's records and follows what it finds:

| The zone has | The module |
| --- | --- |
| no record named `*.example.com` | creates the wildcard record. A name under it that no route takes gets a Cloudflare error page, and no Worker runs |
| its own proxied `*.example.com` | creates no wildcard record: the site hostnames already reach Cloudflare, and every other name keeps its origin |
| its own `*.example.com` that is not proxied | stops with an error: the site hostnames would resolve to that record's origin |
| its own record under a name the routes take, such as `status-page.example.com` or `admin.example.com` | stops with an error that names it |
| its own hostnames, while `rate_rule` is `zone` | stops with an error that names them |
| its own hostnames, while `zone_bots` is `auto` | sets no bot setting, and the `zone_bots` output names them |

## Names and marks

Each object carries a fixed name or mark, the same one poplin's own setup code writes and looks for:

| Object | Name or mark |
| --- | --- |
| DNS records | the comments `poplin: every site` and `poplin: the dashboard, the login, and the API` |
| Worker routes | the Worker's name, `worker_name` |
| Access policy | the name `poplin logins` |
| Access application | the name `poplin` |
| D1 database | the name `poplin` |
| Rate rule | the ref `poplin_rate`, in a ruleset named `poplin rate rule` |
| Guard rules | the refs `poplin_outside_pages` and `poplin_bots`, in a ruleset named `poplin guard rules` |

The Worker reads two of its bindings as JSON:

| Binding | Holds |
| --- | --- |
| `ZONE` | `domain`, `admin_hostname` (the whole hostname, such as `admin.example.com`), and `suffix` |
| `FIRST_SETTINGS` | every setting of `poplin config`, by its name, in its text form |

`MINUTE_LIMITS` is a rate limiting binding with the limit 1000000 per 60 seconds, the one the Worker's per-minute counters are written for.

## What is stopped before the Worker

A request Cloudflare blocks never reaches the Worker. Both guard rules read only hostnames ending in the suffix, such as `report-page.example.com`:

| Request to a site hostname | Outside pages rule | Bots rule |
| --- | --- | --- |
| a visitor types the address, or follows a link from any site | passes | passes |
| a page of another site loads it as an image, a script, a style sheet, a frame, or with `fetch` | blocked | passes |
| a page under the same domain loads it, a site of the install or the zone's own | passes: the Worker decides | passes |
| a browser or a tool that sends no `Sec-Fetch-Site` or no `Sec-Fetch-Dest` header | passes | passes |
| a bot Cloudflare has verified, such as a search engine, a link preview, or a monitor | passes | blocked |
| a search engine's crawler, while `search_engines_allowed` is true | passes | passes |
| a bot Cloudflare has not verified that presents as a browser | passes | passes |

The zone's bot settings cover every hostname of the zone, the dashboard and the zone's own included:

| `zone_bots` | The zone has no hostnames of its own | The zone has hostnames of its own |
| --- | --- | --- |
| `auto` | AI bots blocked, Bot Fight Mode off | nothing set |
| `on` | AI bots blocked, Bot Fight Mode on | AI bots blocked, Bot Fight Mode on |
| `off` | nothing set | nothing set |

No rule can exempt a request from Bot Fight Mode, and it may challenge `poplin` run from a cloud host.

## Inputs

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `account_id` | string | required | the Cloudflare account, the one the zone belongs to: 32 lowercase hexadecimal characters |
| `zone_id` | string | required | the zone of the domain: 32 lowercase hexadecimal characters |
| `logins` | list of strings | required | the emails that may log in: lowercase, at least one, each once |
| `worker_bundle_path` | string | required | the path to the built Worker bundle, one JavaScript module file |
| `admin_hostname` | string | `admin` | the dashboard's hostname, written without the domain: `admin` gives `admin.example.com`, and `admin.tools` gives `admin.tools.example.com`. Any hostname under the domain that does not end in the suffix |
| `suffix` | string | `-page` | the ending of every site hostname label: 2 to 9 characters, a dash, then lowercase letters, digits, or single dashes, with no dash last |
| `rate_rule` | string | `zone` | what the rate rule counts: `zone`, every request of the zone, the one form the Free plan takes; `hostnames`, the install's hostnames alone, on a paid plan; `off`, no rule |
| `guard_rules` | bool | `true` | whether the module creates the two guard rules |
| `outside_pages` | string | `blocked` | whether a page of another domain may frame a site or load its files: `blocked` or `allowed` |
| `search_engines_allowed` | bool | `false` | whether the crawlers of search engines pass the bots rule |
| `zone_bots` | string | `auto` | the zone's bot settings: `auto`, `on`, or `off` |
| `worker_name` | string | `poplin` | the name of the Worker script |
| `bucket_name` | string | `poplin-sites` | the name of the R2 bucket |

`outside_pages`, `search_engines_allowed`, and `zone_bots` are first settings too. Each lives in two places, and `poplin config` changes the stored setting alone. For the Cloudflare side, change the input and apply:

| Setting | The Worker, from the stored setting | Cloudflare, from the module's input |
| --- | --- | --- |
| `outside_pages` | while `blocked`, refuses a request to a site that a page other than one of the install's sites made, and names the pages under the domain as the only ones that may frame a site | the outside pages rule: created while `blocked`, with `guard_rules` on |
| `search_engines_allowed` | reads nothing from it | the bots rule: whether the crawlers of search engines pass it, with `guard_rules` on |
| `zone_bots` | reads nothing from it | the zone's AI bot block and Bot Fight Mode |

The first settings. The names and text forms are those of `poplin config`:

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `default_expires` | string | `never` | the expiry a new site gets: `never`, or a span such as `7d` |
| `default_search_engines` | bool | `false` | whether a new public site is open to search engines |
| `versions_kept` | number | `3` | versions kept per site, the live one included |
| `trash_days` | number | `7` | days a deleted site waits in the trash |
| `dashboard_title` | string | `null` | the title of the dashboard; null means the admin hostname |
| `gallery` | bool | `false` | the public page listing the public sites, at `gallery-page.example.com` |
| `cache_html` | string | `60s` | how long HTML is cached |
| `cache_files` | string | `1h` | how long a site's other files are cached; `off` switches the cache off |
| `max_total_size` | string | `9GB` | limit: all sites together |
| `max_site_size` | string | `200MB` | limit: one site |
| `max_sites` | number | `null` | limit: how many sites; null means none |
| `requests_per_day` | number | `100000` | limit: the day's requests, all sites |
| `site_share_of_day` | number | `25` | limit: one site's share of the day, in percent |
| `site_requests_per_minute` | number | `60` | limit: one site |
| `visitor_requests_per_minute` | number | `30` | limit: one visitor |

The Worker stores the first settings once, while it has none. After that the dashboard is the authority: changing one of these inputs and applying again changes no stored setting.

## Outputs

| Name | Value |
| --- | --- |
| `bucket_name` | the R2 bucket |
| `database_id` | the D1 database |
| `worker_name` | the Worker script |
| `admin_url` | the address of the dashboard, `https://admin.example.com` |
| `site_url_pattern` | the address of a site, `https://<name>--<id>-page.example.com` |
| `guard_rule_expressions` | the expression of each guard rule, by its ref |
| `zone_bots` | `set`, or the reason the module left the zone's bot settings alone |

## Cloudflare token permissions

| Permission | Scope | For |
| --- | --- | --- |
| Workers R2 Storage: Edit | the account | the bucket |
| D1: Edit | the account | the database |
| Workers Scripts: Edit | the account | the Worker |
| Access: Apps and Policies: Edit | the account | the login |
| Zone: Read | the zone | the domain's name |
| DNS: Edit | the zone | the records, and reading the zone's own |
| Workers Routes: Edit | the zone | the routes |
| Zone WAF: Edit | the zone | the rate rule and the guard rules |
| Bot Management: Edit | the zone | the bot settings |

## What it does not do

| It does not | Instead |
| --- | --- |
| build the Worker | pass the path of a Worker bundle file in `worker_bundle_path` |
| apply the database's schema | the Worker brings the database up to its own schema when it opens it |
| set up two installs in one account | the Access policy, the Access application, and the database have fixed names |
| issue a certificate for a deeper `admin_hostname` | Cloudflare's Universal SSL covers `example.com` and `*.example.com`. A hostname such as `admin.tools.example.com` needs a certificate of its own |
| take over an object it did not create | an object that already exists under one of the names above is imported into the state first |
| configure the provider or hold a token | the caller's provider block does |
| add to rate rules the zone already has | the rate rule is the zone's whole rate limiting ruleset. Set `rate_rule` to `off` on a zone with rate rules of its own |
| add to custom rules the zone already has | the guard rules are the zone's whole custom ruleset. Set `guard_rules` to `false` on a zone with custom rules of its own, and add the `guard_rule_expressions` to them |
| keep bot settings the zone already has | the module sets the AI bot block and Bot Fight Mode both. Set `zone_bots` to `off` on a zone that sets its own |
| stop a bot Cloudflare has not verified | a bot that presents as a browser passes both rules; telling it apart takes a bot score, which the Free plan does not have |
| read the zone's plan | a Free plan rate rule reads the path alone: `rate_rule` is `zone` there, and `hostnames` on a paid plan. The input is explicit here; poplin's own setup takes the same three values and only offers the plan's as its default. Bot Fight Mode is a setting of the Free plan: `zone_bots` is `auto` or `off` on a paid plan |
| keep a name several levels deep from the Worker | `a.b-page.example.com` also matches the site route; the Worker answers that it is no site |
| change a record the zone already has | a record whose comment does not start with `poplin: ` is read and never changed |
| check that the Worker's name is free | an existing Worker named `worker_name` in the account is replaced |
| follow a login added on the dashboard | add the email to `logins` as well, so the login screen lets it in |
