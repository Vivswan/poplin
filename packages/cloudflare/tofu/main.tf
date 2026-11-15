# A poplin install on one Cloudflare zone. The caller configures the cloudflare provider.

terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

data "cloudflare_zone" "this" {
  zone_id = var.zone_id

  lifecycle {
    postcondition {
      condition     = self.account.id == var.account_id
      error_message = "zone_id must name a zone of the account in account_id: a route finds its Worker in the zone's own account."
    }

    postcondition {
      condition     = var.paid_plan_allowed || self.plan.legacy_id == "free"
      error_message = "The zone is on a plan Cloudflare bills for, not the Free plan. Move the zone to the Free plan, or set paid_plan_allowed to true."
    }
  }
}

# Every record of the zone: the module reads which names are already taken and never changes a record it did not create.
data "cloudflare_dns_records" "zone" {
  zone_id   = var.zone_id
  max_items = local.record_limit
}

locals {
  # The most records the module reads; a zone with as many is refused, since the rest would go unseen.
  record_limit = 50000

  domain = data.cloudflare_zone.this.name

  # Whether the zone is on the Free plan, whose rate rules read the path alone and which alone has Bot Fight Mode.
  free_plan = data.cloudflare_zone.this.plan.legacy_id == "free"

  # The dashboard, the login, and the API: always `poplin` under the domain. No site hostname is that name, since each ends in a dash and a word.
  admin_host = "poplin.${local.domain}"

  # The fixed word every site hostname label ends in. The Worker reads the same word, so it is no input.
  marker = "-poplin"

  # What a site hostname ends with: the label addresses' ending, then the public names' when their word is another.
  site_host_endings = distinct(["${local.marker}.${local.domain}", "-${var.public_word}.${local.domain}"])

  # One term of the rule language per ending. The inputs are validated, so no quote can appear in one.
  site_terms = [for ending in local.site_host_endings : format("ends_with(http.host, %q)", ending)]

  # True for a request to a site hostname and for no other, the admin hostname included. Several terms stand in brackets, so the whole binds in front of an `and`.
  sites_expression = length(local.site_terms) == 1 ? local.site_terms[0] : "(${join(" or ", local.site_terms)})"

  # The wildcard record every site hostname resolves through. DNS has no partial wildcard, so it covers the whole level.
  wildcard_host = "*.${local.domain}"

  # The records that answer for a hostname and are not the install's. The module and poplin's setup client both start the comment of a record they create with `poplin: `.
  zone_records = [
    for record in data.cloudflare_dns_records.zone.result : record
    if contains(["A", "AAAA", "CNAME"], record.type) && !startswith(coalesce(record.comment, "none"), "poplin: ")
  ]

  # The zone's own records under the wildcard name: proxied ones already carry the site hostnames to Cloudflare, any other sends them to its own origin.
  zone_wildcards           = [for record in local.zone_records : record if record.name == local.wildcard_host]
  zone_wildcards_unproxied = [for record in local.zone_wildcards : record if !coalesce(record.proxied, false)]

  # The zone's own records under a name the routes take.
  shadowed_names = sort(distinct([
    for record in local.zone_records : record.name
    if record.name == local.admin_host || anytrue([for ending in local.site_host_endings : endswith(record.name, ending)])
  ]))

  # The zone's own hostnames, a wildcard of its own included: a rate rule that reads the path alone, or a bot switch of the zone, would cover them too.
  other_names = sort(distinct(local.zone_records[*].name))

  # Every DNS record of the install, each with the comment that marks it as poplin's.
  records = merge(
    length(local.zone_wildcards) == 0 ? { (local.wildcard_host) = "poplin: every site" } : {},
    { (local.admin_host) = "poplin: the dashboard, the login, and the API" },
  )

  # A route may begin with a wildcard and hold no other, so Cloudflare itself sends only the hostnames that end in one of the endings to the Worker: one route per ending.
  worker_route_hosts = toset(concat([for ending in local.site_host_endings : "*${ending}"], [local.admin_host]))

  # The hostnames the routes send to the Worker, as the rule language reads them.
  served_expression = join(" or ", concat(local.site_terms, [format("http.host eq %q", local.admin_host)]))

  # A request over `http` to one of those hostnames: the redirect rule sends it to `https` before the Worker runs.
  plain_http_expression = "not ssl and (${local.served_expression})"

  # A Free plan rate rule may read the path alone, so `zone` counts every request of the zone.
  rate_rule_expression = var.rate_rule == "zone" ? "starts_with(http.request.uri.path, \"/\")" : local.served_expression

  # A browser marks a request another site's page made, and says what it is for. One for a document is a visitor following a link, and one that lacks either mark passes.
  outside_pages_expression = "${local.sites_expression} and any(http.request.headers[\"sec-fetch-site\"][*] eq \"cross-site\") and any(http.request.headers[\"sec-fetch-dest\"][*] ne \"document\")"

  # The bots Cloudflare has verified: all of them, or all but the crawlers of search engines.
  verified_bots = var.search_engines_allowed ? "(cf.client.bot and cf.verified_bot_category ne \"Search Engine Crawler\")" : "cf.client.bot"

  # A site answers GET and HEAD alone. The dashboard and the API take other methods on the admin hostname, which no site term matches.
  other_methods = "not http.request.method in {\"GET\" \"HEAD\"}"

  # The paths scanners ask every host for. No static site answers one: it holds no PHP, and a `.env` file or a `.git` folder published by mistake is better not served.
  scanner_paths = [
    "ends_with(http.request.uri.path, \".php\")",
    "ends_with(http.request.uri.path, \"/.env\")",
    "http.request.uri.path contains \"/.env.\"",
    "http.request.uri.path contains \"/.git/\"",
    "starts_with(http.request.uri.path, \"/wp-admin/\")",
    "starts_with(http.request.uri.path, \"/cgi-bin/\")",
    "starts_with(lower(http.request.uri.path), \"/phpmyadmin\")",
  ]

  # Cloudflare's own paths, where the login of a private site answers: the bots rule leaves them alone.
  edge_paths = "not starts_with(http.request.uri.path, \"/cdn-cgi/\")"

  # What the bots rule stops on a site hostname: a verified bot, a method no site answers, and a scanner path.
  bots_expression = "${local.sites_expression} and ${local.edge_paths} and (${local.verified_bots} or ${local.other_methods} or ${join(" or ", local.scanner_paths)})"

  # The guard rules in the order they run.
  guard_rules = concat(
    var.outside_pages == "blocked" ? [{ ref = "poplin_outside_pages", description = "poplin: stop pages of other domains", expression = local.outside_pages_expression }] : [],
    [{ ref = "poplin_bots", description = "poplin: stop verified bots, other methods, and scanner paths", expression = local.bots_expression }],
  )

  # Why the zone's bot switches are left alone, or null when the module sets them.
  block_bots_skipped = (
    var.block_bots == "off" ? "block_bots is off" :
    var.block_bots == "auto" && length(local.other_names) > 0 ? "the AI bot block covers the whole zone, and the zone has hostnames of its own: ${join(", ", local.other_names)}" :
    null
  )

  # The zone values the module owns: the records, routes, and rules above follow them in the same apply.
  zone_binding = {
    domain      = local.domain
    public_word = var.public_word
  }

  # Every setting in the text form `poplin config` takes.
  first_settings = {
    default_expires             = var.default_expires
    default_search_engines      = var.default_search_engines ? "on" : "off"
    versions_kept               = tostring(var.versions_kept)
    trash_days                  = tostring(var.trash_days)
    logins                      = join(",", var.logins)
    dashboard_title             = coalesce(var.dashboard_title, local.admin_host)
    outside_pages               = var.outside_pages
    search_engines_allowed      = var.search_engines_allowed ? "on" : "off"
    block_bots                  = var.block_bots
    max_total_size              = var.max_total_size
    max_site_size               = var.max_site_size
    max_sites                   = var.max_sites == null ? "none" : tostring(var.max_sites)
    max_files_per_publish       = tostring(var.max_files_per_publish)
    max_files_per_day           = tostring(var.max_files_per_day)
    max_storage_writes_per_day  = tostring(var.max_storage_writes_per_day)
    requests_per_day            = tostring(var.requests_per_day)
    site_share_of_day           = "${var.site_share_of_day}%"
    site_requests_per_minute    = tostring(var.site_requests_per_minute)
    visitor_requests_per_minute = tostring(var.visitor_requests_per_minute)
    update_check                = var.update_check ? "on" : "off"
  }
}
