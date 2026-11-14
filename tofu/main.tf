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

  admin_host = "${var.admin_hostname}.${local.domain}"

  # What every site hostname ends with, the gallery's included.
  site_host_ending = "${var.suffix}.${local.domain}"

  # The wildcard record every site hostname resolves through. DNS has no partial wildcard, so it covers the whole level.
  wildcard_host = "*.${local.domain}"

  # The records that answer for a hostname and that the module did not create.
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
    if record.name == local.admin_host || endswith(record.name, local.site_host_ending)
  ]))

  # The zone's own hostnames, a wildcard of its own included: a rate rule that reads the path alone would count their requests too.
  other_names = sort(distinct(local.zone_records[*].name))

  # Every DNS record of the install, each with the comment that marks it as poplin's.
  records = merge(
    length(local.zone_wildcards) == 0 ? { (local.wildcard_host) = "poplin: every site" } : {},
    { (local.admin_host) = "poplin: the dashboard, the login, the API, and the MCP server" },
  )

  # A route may begin with a wildcard and hold no other, so Cloudflare itself sends only the hostnames that end in the suffix to the Worker.
  worker_route_hosts = toset(["*${local.site_host_ending}", local.admin_host])

  # The hostnames the routes send to the Worker, as the rule language reads them. The inputs are validated, so no quote can appear in one.
  served_expression = format("ends_with(http.host, %q) or http.host eq %q", local.site_host_ending, local.admin_host)

  # A Free plan rate rule may read the path alone, so `zone` counts every request of the zone.
  rate_rule_expression = var.rate_rule == "zone" ? "starts_with(http.request.uri.path, \"/\")" : local.served_expression

  # The zone values the module owns: the records, routes, and rule above follow them in the same apply.
  zone_binding = {
    domain         = local.domain
    admin_hostname = var.admin_hostname
    suffix         = var.suffix
  }

  # Every setting in the text form `poplin config` takes.
  first_settings = {
    default_expires             = var.default_expires
    default_search_engines      = var.default_search_engines ? "on" : "off"
    versions_kept               = tostring(var.versions_kept)
    trash_days                  = tostring(var.trash_days)
    logins                      = join(",", var.logins)
    dashboard_title             = coalesce(var.dashboard_title, local.admin_host)
    gallery                     = var.gallery ? "on" : "off"
    cache_html                  = var.cache_html
    private_sites               = "single-file"
    max_total_size              = var.max_total_size
    max_site_size               = var.max_site_size
    max_sites                   = var.max_sites == null ? "none" : tostring(var.max_sites)
    requests_per_day            = tostring(var.requests_per_day)
    site_share_of_day           = "${var.site_share_of_day}%"
    site_requests_per_minute    = tostring(var.site_requests_per_minute)
    visitor_requests_per_minute = tostring(var.visitor_requests_per_minute)
  }
}
