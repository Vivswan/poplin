# The OpenTofu module

Sets up a poplin install on one Cloudflare zone.

```hcl
module "poplin" {
  source = "github.com/Vivswan/poplin//packages/cloudflare/tofu?ref=<release tag>"

  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "./worker.js"
  access_team_domain = "team.cloudflareaccess.com"
}
```

The caller configures the `cloudflare` provider, major 5, and runs OpenTofu 1.13 or newer. An install with no domain needs no zone and is not set up by this module.

The module sets every value the Worker starts from itself: its domain, its first settings, its account, and its login. A Worker it deployed never shows the setup page's two boxes for a domain and a first login.

`worker_bundle_path` is the path of the Worker bundle, which the caller builds from a checkout of this repository:

```sh
bun install
bun run --cwd packages/cloudflare build   # writes packages/cloudflare/dist/worker.js
```

## What it creates

| Resource | Purpose |
| --- | --- |
| R2 bucket | holds every site's files; its public access is off |
| R2 bucket lifecycle | ends an upload in parts nobody finished after a day. It deletes no stored file, unless `test_install_file_days` is set |
| Usage alerts | none by default. With `usage_alert_percents` set, one notification policy per R2 meter and share: Cloudflare emails the `logins` when the account's R2 bytes stored, write operations, or read operations pass that share of the free monthly allowance. The product names are unconfirmed |
| D1 database | holds every record: the sites, the tokens, the settings, the audit log. The module applies no schema: the Worker does when it opens the database |
| Worker script | serves the sites, the dashboard, the login, and the API; uploaded from the bundle with the bucket, the database, the minute limiter, the zone values, the first settings, the Access application, the account's id, and the Worker's own name bound to it |
| Worker cron trigger | runs the Worker's sweep every 15 minutes: expired sites go to the trash, and sites past `trash_days` in the trash and uploads nobody finished are removed with their files |
| Worker routes | send the install's hostnames, and no other hostname of the zone, to the Worker |
| DNS records | proxied, each with a comment starting `poplin: ` |
| Access policy and application | one login, allowing exactly `logins`, in front of the whole dashboard hostname and of every private site's address, `*-p-poplin.example.com`; a login lasts 30 days |
| Access open paths | a second application and its policy, which let everyone past the login on two paths of the dashboard's hostname: `/api`, where the Worker checks a caller's own token, and `/setup`, the setup page |
| Redirect rule | sends a request over `http` to one of the install's hostnames to `https`, with a 301, before the Worker runs |
| Rate rule | blocks an address for 10 seconds after 300 requests in 10 seconds, [counted in each data center](../../../docs/run/limits-and-cost.md#where-a-limit-is-counted) |
| Guard rules | two custom rules that block a request to a site hostname before the Worker runs: one from a page of another domain; one from a verified bot, with a method other than GET and HEAD, or for a scanner path |
| Bot settings | the zone's AI bot block, on a zone with no hostnames of its own |

Records and routes, for `example.com` with the default hostnames:

| Hostname | Example | DNS record | Worker route |
| --- | --- | --- | --- |
| a site | `report--k3f9x2ab71qz-p-poplin.example.com` | `*.example.com` | `*-poplin.example.com/*` |
| a public site's public name | `docs-page.example.com` | `*.example.com` | `*-page.example.com/*` |
| the dashboard | `poplin.example.com` | `poplin.example.com` | `poplin.example.com/*` |

With `public_word = "poplin"` every site hostname ends in `-poplin`, and one site route takes them all.

DNS has no partial wildcard, so the wildcard record covers every name under the domain that has no record of its own, while the routes send only the names ending in `-poplin` or in the public word to the Worker. The module reads the zone's records and follows what it finds:

| The zone has | The module |
| --- | --- |
| no record named `*.example.com` | creates the wildcard record. A name under it that no route takes gets a Cloudflare error page, and no Worker runs |
| its own proxied `*.example.com` | creates no wildcard record: the site hostnames already reach Cloudflare, and every other name keeps its origin |
| its own `*.example.com` that is not proxied | stops with an error: the site hostnames would resolve to that record's origin |
| its own record under a name the routes take, such as `status-poplin.example.com` or `poplin.example.com` | stops with an error that names it |
| its own hostnames, while `rate_rule` is `zone` | stops with an error that names them |
| its own hostnames, while `block_bots` is `auto` | sets no bot setting, and the `block_bots` output names them |
| the Free plan, while `rate_rule` is `hostnames` | stops with an error: a rate rule of the Free plan reads the path alone |
| a paid plan, while `block_bots` is `on` | blocks AI bots and leaves Bot Fight Mode off: only the Free plan has it |

## The same objects as the setup page

The setup page's Repair and this module make the same objects with the same values, but for the budget alert, which only Repair makes, and the last three rows, which only this module has. A test holds both to one list, `src/zone/install-pieces.ts`, and a second to one table of values, `src/zone/install-objects.ts`.

| Object | The setup page | This module | Where they differ |
| --- | --- | --- | --- |
| DNS records | Repair | `cloudflare_dns_record.poplin` | Repair also removes a marked record the install no longer uses, and skips a name an NS record holds; here a record outside the state stays, and Cloudflare refuses a name an NS record holds |
| Worker routes | Repair | `cloudflare_workers_route.worker` | Repair also removes a route of the Worker the install no longer uses, and skips a pattern another Worker holds; here a route outside the state stays, and Cloudflare refuses a pattern that is taken |
| Access policy and application | Repair | `cloudflare_zero_trust_access_policy.logins`, `cloudflare_zero_trust_access_application.login` | nowhere |
| Access open paths | Repair | `cloudflare_zero_trust_access_policy.open_paths`, `cloudflare_zero_trust_access_application.open_paths` | nowhere |
| the Worker's values | Repair | the bindings of `cloudflare_workers_script.poplin` | Repair writes the domain, the first login, the account, and the login's audience, and keeps every other binding; here every binding is declared, with the public word and every first setting |
| Redirect rule | Repair | `cloudflare_ruleset.https` | Repair writes none where the zone's own Always Use HTTPS is on and the install has no rule yet; here `https_redirect` says so |
| Guard rules | Repair | `cloudflare_ruleset.guards` | Repair adds its rules beside the zone's own; here they are the whole ruleset |
| Rate rule | Repair | `cloudflare_ruleset.rate` | Repair picks `zone` on the Free plan and `hostnames` on a paid one, and skips a rule the zone cannot hold; here `rate_rule` says which, and an apply stops |
| Bot settings | Repair | `cloudflare_bot_management.zone` | Repair only switches on; here an apply also switches Bot Fight Mode off unless `block_bots` is `on` and the zone is on the Free plan |
| D1 database | Repair, or the deploy | `cloudflare_d1_database.records` | nowhere |
| R2 bucket, public access off | the deploy; a new bucket has no public address | `cloudflare_r2_bucket.sites`, `cloudflare_r2_managed_domain.sites` | Repair does not read the bucket |
| Worker and its sweep trigger | the deploy | `cloudflare_workers_script.poplin`, `cloudflare_workers_cron_trigger.sweep` | nowhere |
| Budget alert | Repair, with the right Notifications: Edit | not made: the provider's `cloudflare_notification_policy` takes neither the alert type `billing_budget_alert` nor its filter `total_spend_dollars` | only Repair makes it. On an install this module made, add the right to an account token and press Repair on the Domain screen |
| Key | Repair, with the right Account API Tokens: Edit | not made: the module declares no API token and binds no secret | only Repair makes it. On an install this module made, press Repair on the Domain screen with an account token that holds the right |
| R2 bucket lifecycle | not made: its token has no R2 permission. A new bucket has Cloudflare's own rule, which ends an unfinished upload after seven days | `cloudflare_r2_bucket_lifecycle.sites` | one day here, seven there |
| Usage alerts | not made | `cloudflare_notification_policy.usage` | only this module makes them, and only with `usage_alert_percents` set |
| the Free plan check | Repair reads the plan and changes nothing for it | a postcondition of `data.cloudflare_zone.this` | here an apply on a paid plan stops unless `paid_plan_allowed` is true |

## Names and marks

Each object carries a fixed name or mark, the same one poplin's own setup code writes and looks for:

| Object | Name or mark |
| --- | --- |
| DNS records | the comments `poplin: every site` and `poplin: the dashboard, the login, and the API` |
| Worker routes | the Worker's name, `worker_name` |
| Access policy | the name `poplin logins` |
| Access application | the name `poplin` |
| Access open paths | the application's name `poplin open paths` and the policy's name `poplin open paths policy` |
| D1 database | the name `poplin` |
| Rate rule | the ref `poplin_rate`, in a ruleset named `poplin rate rule` |
| Guard rules | the refs `poplin_outside_pages` and `poplin_bots`, in a ruleset named `poplin guard rules` |
| Redirect rule | the ref `poplin_https`, in a ruleset named `poplin redirect rule` |

The Worker reads three of its bindings as JSON:

| Binding | Holds |
| --- | --- |
| `ZONE` | `domain`, and `public_word` |
| `FIRST_SETTINGS` | every setting of `poplin config`, by its name, in its text form |
| `ACCESS` | `team_domain`, the input `access_team_domain`, and `audience`, the audience tag of the Access application the module creates |

`MINUTE_LIMITS` is a rate limiting binding with the limit 1000000 per 60 seconds, the one the Worker's per-minute counters are written for.

## What is stopped before the Worker

A request Cloudflare blocks never reaches the Worker. Both guard rules read only the site hostnames, the ones ending in `-poplin` or in the public word, such as `report--k3f9x2ab71qz-u-poplin.example.com`. Neither reads the dashboard's hostname:

| Request to a site hostname | Outside pages rule | Bots rule |
| --- | --- | --- |
| a visitor types the address, or follows a link from any site | passes | passes |
| a page of another site loads it as an image, a script, a style sheet, a frame, or with `fetch` | blocked | passes |
| a page under the same domain loads it, a site of the install or the zone's own | passes: the Worker decides | passes |
| a browser or a tool that sends no `Sec-Fetch-Site` or no `Sec-Fetch-Dest` header | passes | passes |
| a bot Cloudflare has verified, such as a search engine, a link preview, or a monitor | passes | blocked |
| a search engine's crawler, while `search_engines_allowed` is true | passes | passes |
| a bot Cloudflare has not verified that presents as a browser | passes | passes |
| any method but GET and HEAD | passes | blocked |
| a path that ends in `.php` or in `/.env`, or holds `/.env.` or `/.git/` | passes | blocked |
| a path that starts with `/wp-admin/` or `/cgi-bin/`, or with `/phpmyadmin` in any case | passes | blocked |
| a path under `/cdn-cgi/`, where Cloudflare's own login answers | passes | passes |

The bots rule is 549 characters for the default hostnames, and 607 with search engines let through. The two guard rules are the only custom rules the module creates; the Free plan allows five.

The zone's bot settings cover every hostname of the zone, the dashboard and the zone's own included:

| `block_bots` | The zone has no hostnames of its own | The zone has hostnames of its own |
| --- | --- | --- |
| `auto` | AI bots blocked, Bot Fight Mode off | nothing set |
| `on` | AI bots blocked, Bot Fight Mode on | AI bots blocked, Bot Fight Mode on |
| `off` | nothing set | nothing set |

Bot Fight Mode is a switch of the Free plan: on a paid plan `on` blocks AI bots and leaves it off. No rule can exempt a request from Bot Fight Mode, and it may challenge `poplin` run from a cloud host.

## Inputs

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `account_id` | string | required | the Cloudflare account, the one the zone belongs to: 32 lowercase hexadecimal characters |
| `zone_id` | string | required | the zone of the domain: 32 lowercase hexadecimal characters |
| `logins` | list of strings | required | the emails that may log in: lowercase, at least one, each once |
| `worker_bundle_path` | string | required | the path to the built Worker bundle, one JavaScript module file |
| `access_team_domain` | string | required | the account's Zero Trust team domain, such as `team.cloudflareaccess.com`, shown in the Zero Trust settings. The module does not read it from the account: that takes a permission beyond the ones below |
| `public_word` | string | `page` | the word every public site's address ends in, as in `docs-page.example.com`: 2 to 9 lowercase letters. It is chosen once: another word later breaks every public address |
| `https_redirect` | bool | `true` | whether the module creates the redirect rule |
| `rate_rule` | string | `zone` | what the rate rule counts: `zone`, every request of the zone, the one form the Free plan takes; `hostnames`, the install's hostnames alone, on a paid plan; `off`, no rule |
| `guard_rules` | bool | `true` | whether the module creates the two guard rules |
| `outside_pages` | string | `blocked` | whether a page of another domain may frame a site or load its files: `blocked` or `allowed` |
| `search_engines_allowed` | bool | `false` | whether the crawlers of search engines pass the bots rule |
| `block_bots` | string | `auto` | the zone's bot settings: `auto`, `on`, or `off` |
| `paid_plan_allowed` | bool | `false` | whether the zone may be on a plan Cloudflare bills for. While false, an apply on a zone that is not on the Free plan stops |
| `usage_alert_percents` | list of numbers | `[]` | set it to turn the usage alerts on: the shares of R2's free monthly allowance at which Cloudflare emails the logins, whole numbers from 1 to 100, such as `[50, 90]`. It needs the Notifications permission, and applies on accounts where Cloudflare offers usage alerts |
| `test_install_file_days` | number | `null` | days after which the bucket deletes every file, a live site's included: for an install that only tests. Null creates no such rule |
| `worker_name` | string | `poplin` | the name of the Worker script |
| `bucket_name` | string | `poplin-sites` | the name of the R2 bucket |

`outside_pages`, `search_engines_allowed`, and `block_bots` are first settings too. Each lives in two places, and `poplin config` changes the stored setting alone. For the Cloudflare side, change the input and apply:

| Setting | The Worker, from the stored setting | Cloudflare, from the module's input |
| --- | --- | --- |
| `outside_pages` | while `blocked`, refuses a request to a site that a page other than one of the install's sites made, and names the pages under the domain as the only ones that may frame a site | the outside pages rule: created while `blocked`, with `guard_rules` on |
| `search_engines_allowed` | reads nothing from it | the bots rule: whether the crawlers of search engines pass it, with `guard_rules` on |
| `block_bots` | reads nothing from it | the zone's AI bot block and Bot Fight Mode |

The first settings. The names and text forms are those of `poplin config`:

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `default_expires` | string | `never` | the expiry a new site gets: `never`, or a span such as `7d` |
| `default_search_engines` | bool | `false` | whether a new public site is open to search engines |
| `versions_kept` | number | `3` | versions kept per site, the live one included |
| `trash_days` | number | `7` | days a deleted site waits in the trash |
| `max_total_size` | string | `9GB` | limit: all sites together |
| `max_site_size` | string | `200MB` | limit: one site |
| `max_sites` | number | `null` | limit: how many sites; null means none |
| `max_files_per_publish` | number | `5000` | limit: the files of one publish, import, or copy; 10000 at most |
| `max_files_per_day` | number | `25000` | limit: the files of all publishes begun in one UTC day |
| `max_storage_writes_per_day` | number | `30000` | limit: the times the bucket is written to or listed in one UTC day |
| `requests_per_day` | number | `100000` | limit: the day's requests, all sites |
| `site_share_of_day` | number | `25` | limit: one site's share of the day, in percent |
| `site_requests_per_minute` | number | `6000` | limit: one site |
| `visitor_requests_per_minute` | number | `600` | limit: one visitor |
| `update_check` | bool | `true` | whether the install asks the project's website, once a day, which version is the newest |
| `auto_update` | bool | `false` | whether the install starts an update by itself, three days after it first knew of the version; never one that changes the database |

The Worker stores the first settings once, while it has none. After that the dashboard is the authority: changing one of these inputs and applying again changes no stored setting.

## Outputs

| Name | Value |
| --- | --- |
| `bucket_name` | the R2 bucket |
| `database_id` | the D1 database |
| `worker_name` | the Worker script |
| `admin_url` | the address of the dashboard, `https://poplin.example.com` |
| `site_url_pattern` | the address of a site, `https://<name>--<id>-<letter>-poplin.example.com`: the letter is `p` for a private site and `u` for every other |
| `public_url_pattern` | the address of a public site under its public name, `https://<public name>-page.example.com` |
| `guard_rule_expressions` | the expression of each guard rule, by its ref |
| `block_bots` | `set`, or the reason the module left the zone's bot settings alone |

## Cloudflare token permissions

| Permission | Scope | For |
| --- | --- | --- |
| Workers R2 Storage: Edit | the account | the bucket and its lifecycle |
| Notifications: Edit | the account | the usage alerts; not needed while `usage_alert_percents` is empty, its default |
| D1: Edit | the account | the database |
| Workers Scripts: Edit | the account | the Worker and its cron trigger |
| Access: Apps and Policies: Edit | the account | the login |
| Zone: Read | the zone | the domain's name and its plan |
| DNS: Edit | the zone | the records, and reading the zone's own |
| Workers Routes: Edit | the zone | the routes |
| Zone WAF: Edit | the zone | the rate rule and the guard rules |
| Single Redirect: Edit | the zone | the redirect rule |
| Bot Management: Edit | the zone | the bot settings |

The Domain screen's Check and Repair take two permissions more, and a third for the budget alert, Notifications: Edit on the account. Zone Settings: Read on the zone: they read whether the zone's own Always Use HTTPS is on, and write no redirect rule where it is. Access: Organizations, Identity Providers, and Groups: Read on the account: they read the team domain, and compare it and the application's audience tag with the Worker's `ACCESS` binding.

## Update the install

An install this module made updates by a new bundle and an apply. In a checkout of this repository, with `0.2.0` standing for the release:

```sh
git fetch --tags
git checkout v0.2.0
bun install
bun run --cwd packages/cloudflare build
```

The build writes `packages/cloudflare/dist/worker.js`. Put that file where `worker_bundle_path` names, move `ref` in the module's `source` to the same tag, and apply:

```sh
tofu init -upgrade
tofu apply
```

| On such an install                  | Does                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| the update notice                   | shows while `update_check` is true, where [Update](../../../docs/run/update.md#a-newer-version) says |
| `poplin update --check`             | says which version is out, and whether an update link is saved                                 |
| `poplin update`                     | answers `no_update_address` with no update link saved: the module makes no build to call |
| the build variable `POPLIN_VERSION` | nothing: no build reads it. The tag you check out is the version                               |

## What it does not do

| It does not | Instead |
| --- | --- |
| warn when the account's charges reach 1 US dollar | the dashboard's Repair makes that budget alert, with an account token that holds Notifications: Edit: [Domain](../../../docs/run/domain.md#optional-an-email-when-charges-reach-1-dollar). The provider's resource does not take the alert type |
| stop a write once R2's free allowance is used | Cloudflare has no spending cap on R2. The limits the Worker enforces, `max_total_size` and `max_files_per_day` among them, bound what a publish stores and declares, and the usage alerts, once `usage_alert_percents` is set, tell the logins at the shares it names |
| delete the files of a dropped version or of a site past its days in the trash | the Worker's sweep does. Every site keeps its files under a folder of random letters, live or dropped alike, so no bucket rule can tell the two apart |
| read the zone's plan without a warning | the provider marks the zone's `plan` as deprecated, so every plan and apply prints one warning that names `data.cloudflare_zone.this.plan`. The module reads it for the Free plan check, the rate rule, and Bot Fight Mode. The provider's other source of the plan, `cloudflare_zone_subscription`, takes Billing: Read on the account, a permission the module does not ask for |
| check the account's Workers plan | the provider reads the zone's plan, which the module checks, and not the account's Workers plan |
| build the Worker | build the bundle with `bun run --cwd packages/cloudflare build` and pass its path in `worker_bundle_path` |
| read the Zero Trust team domain | pass it in `access_team_domain` |
| apply the database's schema | the Worker brings the database up to its own schema when it opens it |
| set up two installs in one account | the Access policies, the Access applications, and the database have fixed names |
| take over an object it did not create | an object that already exists under one of the names above is imported into the state first |
| configure the provider or hold a token | the caller's provider block does |
| add to rate rules the zone already has | the rate rule is the zone's whole rate limiting ruleset. Set `rate_rule` to `off` on a zone with rate rules of its own |
| add to redirect rules the zone already has | the redirect rule is the zone's whole redirect ruleset. Set `https_redirect` to `false` on a zone with redirect rules of its own, or one whose Always Use HTTPS is on |
| fit a domain of more than 50 characters | Access takes an application address of 63 characters, and `poplin.<domain>/setup` must fit |
| add to custom rules the zone already has | the guard rules are the zone's whole custom ruleset. Set `guard_rules` to `false` on a zone with custom rules of its own, and add the `guard_rule_expressions` to them |
| keep bot settings the zone already has | the module sets the AI bot block and Bot Fight Mode both. Set `block_bots` to `off` on a zone that sets its own |
| stop a bot Cloudflare has not verified | a bot that presents as a browser passes both rules; telling it apart takes a bot score, which the Free plan does not have |
| pick the rate rule from the zone's plan | `rate_rule` is explicit: `zone` on the Free plan, `hostnames` on a paid plan. An apply stops where the plan refuses the one chosen |
| keep a name several levels deep from the Worker | `a.b-poplin.example.com` also matches the site route; the Worker answers that it is no site |
| put a login in front of an unlisted or a public site | only an address that ends in `-p-poplin` is behind Access; the Worker sends a private site asked for at any other address there |
| change a record the zone already has | a record whose comment does not start with `poplin: ` is read and never changed |
| check that the Worker's name is free | an existing Worker named `worker_name` in the account is replaced |
| follow a login added on the dashboard | add the email to `logins` as well, so the login screen lets it in |
