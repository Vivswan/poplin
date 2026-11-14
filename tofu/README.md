# The OpenTofu module

Sets up a poplin install on one Cloudflare zone.

```hcl
module "poplin" {
  source = "github.com/Vivswan/poplin//tofu?ref=<release tag>"

  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "./worker.js"
  excluded_hostnames = ["www.example.com"]
}
```

The caller configures the `cloudflare` provider, major 5, and runs OpenTofu 1.13 or newer. `worker_bundle_path` is the Worker bundle attached to the release of the same tag. An install with no domain needs no zone and is not set up by this module.

## What it creates

| Resource | Purpose |
| --- | --- |
| R2 bucket | holds every site and every record; its public access is off |
| Worker script | serves the sites, the dashboard, the API, and the MCP server; uploaded from the bundle with the bucket, the zone values, and the first settings bound to it |
| Worker routes | send the install's hostnames to the Worker |
| Routes with no Worker | one per excluded hostname, so it keeps its own origin |
| DNS records | proxied, each with a comment starting `poplin:` |
| Access policy and application | the login on `/login` and `/oauth/authorize` of the admin hostname, allowing exactly `logins` |
| Host rule | blocks, before the Worker, every hostname under the domain that is not a site, the admin hostname, the pages hostname, or an excluded hostname |
| Rate rule | blocks an address for 10 seconds after 300 requests in 10 seconds |

Records and routes by layout, for `example.com` with the default hostnames:

| Layout | A site | DNS records | Worker routes |
| --- | --- | --- | --- |
| `domain` | `page-report.example.com` | `*.example.com`, `admin.example.com`; `pages.example.com` while `gallery` is on | `*.example.com/*` |
| `subdomain-per-site`, `subdomain-wildcard` | `report.pages.example.com` | `*.pages.example.com`, `pages.example.com`, `admin.example.com` | `*.pages.example.com/*`, `pages.example.com/*`, `admin.example.com/*` |

With an empty `pages_hostname` and `gallery` on, the gallery's record and route sit on the bare domain.

## Inputs

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `account_id` | string | required | the Cloudflare account, the one the zone belongs to: 32 lowercase hexadecimal characters |
| `zone_id` | string | required | the zone of the domain: 32 lowercase hexadecimal characters |
| `logins` | list of strings | required | the emails that may log in: lowercase, at least one, each once |
| `worker_bundle_path` | string | required | the path to the built Worker bundle, one JavaScript module file |
| `layout` | string | `domain` | `domain`, `subdomain-per-site`, or `subdomain-wildcard` |
| `admin_hostname` | string | `admin` | the label of the dashboard's hostname: one label, different from `pages_hostname` |
| `pages_hostname` | string | `pages` | the label of the gallery's hostname; empty means the bare domain, under the `domain` layout only |
| `prefix` | string | `page-` | the label in front of every site name under the `domain` layout: empty, or up to 9 lowercase letters, digits, or dashes, starting with a letter or a digit. Empty creates no host rule under that layout |
| `excluded_hostnames` | list of strings | `[]` | the zone's other exact hostnames: at most 200, and a host rule expression of at most 4096 characters |
| `host_rule` | bool | `true` | `false` when the zone has custom rules of its own |
| `rate_rule` | bool | `true` | `false` when the zone's one Free-plan rate rule is already used |
| `worker_name` | string | `poplin` | the name of the Worker script |
| `bucket_name` | string | `poplin-sites` | the name of the R2 bucket |

The first settings. The names and text forms are those of `poplin config`:

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `default_expires` | string | `never` | the expiry a new site gets: `never`, or a span such as `7d` |
| `default_search_engines` | bool | `false` | whether a new public site is open to search engines |
| `versions_kept` | number | `3` | versions kept per site, the live one included |
| `trash_days` | number | `7` | days a deleted site waits in the trash |
| `dashboard_title` | string | `null` | the title of the dashboard; null means the admin hostname |
| `gallery` | bool | `false` | the public page listing the public sites |
| `cache_html` | string | `60s` | how long HTML is cached |
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
| `worker_name` | the Worker script |
| `admin_url` | the address of the dashboard, `https://admin.example.com` |
| `site_url_pattern` | the address of a site, `https://page-<name>.example.com` |

## Cloudflare token permissions

| Permission | Scope | For |
| --- | --- | --- |
| Workers R2 Storage: Edit | the account | the bucket |
| Workers Scripts: Edit | the account | the Worker |
| Access: Apps and Policies: Edit | the account | the login |
| Zone: Read | the zone | the domain's name |
| DNS: Edit | the zone | the records |
| Workers Routes: Edit | the zone | the routes |
| Zone WAF: Edit | the zone | the host rule and the rate rule |

## What it does not do

| It does not | Instead |
| --- | --- |
| build the Worker | pass the release's bundle in `worker_bundle_path` |
| configure the provider or hold a token | the caller's provider block does |
| add to rules the zone already has | each ruleset owns its phase for the zone: the host rule is the whole custom rules ruleset, the rate rule the whole rate limiting ruleset. `host_rule` and `rate_rule` switch them off |
| limit the rate rule to the install's hostnames | a Free plan rate rule matches on the path alone, so it counts every request to the zone |
| block a made-up name several levels deep | the host rule lets through a name that starts with the prefix, or sits under the pages hostname, at any depth |
| check that the Worker's name is free | an existing Worker named `worker_name` in the account is replaced |
| find the zone's other hostnames | list them in `excluded_hostnames` |
| check that the bare domain is free | leave `pages_hostname` set unless nothing answers at the bare domain |
| order a certificate | `subdomain-wildcard` needs a wildcard certificate for `*.pages.example.com` on the zone |
| store a Cloudflare key in the Worker | `subdomain-per-site` needs one to order a certificate per site |
| follow a login added on the dashboard | add the email to `logins` as well, so the login screen lets it in |
