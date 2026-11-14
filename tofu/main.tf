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

locals {
  domain = data.cloudflare_zone.this.name

  # Sites sit one level under the domain, or one level under the pages hostname.
  sites_under_pages = var.layout != "domain"

  admin_host = "${var.admin_hostname}.${local.domain}"

  # An empty pages hostname is the bare domain.
  pages_host = var.pages_hostname == "" ? local.domain : "${var.pages_hostname}.${local.domain}"

  # The pages hostname answers only while the gallery or a subdomain layout uses it.
  pages_in_use = local.sites_under_pages || var.gallery

  # The wildcard every site hostname falls under.
  wildcard_host = local.sites_under_pages ? "*.${local.pages_host}" : "*.${local.domain}"

  # Every DNS record of the install, each with the comment that marks it as poplin's.
  records = merge(
    {
      (local.wildcard_host) = "poplin: every site"
      (local.admin_host)    = "poplin: the dashboard, the login, the API, and the MCP server"
    },
    local.pages_in_use ? { (local.pages_host) = "poplin: the gallery" } : {},
  )

  # Under `domain` the wildcard route already covers the admin and pages hostnames; the bare domain is never under it.
  worker_route_hosts = toset(concat(
    [local.wildcard_host],
    local.sites_under_pages ? [local.admin_host, local.pages_host] : [],
    !local.sites_under_pages && local.pages_in_use && var.pages_hostname == "" ? [local.domain] : [],
  ))

  excluded_hosts = toset(var.excluded_hostnames)

  # The set literals of the rule language: quoted hostnames separated by spaces. The inputs are validated, so no quote can appear in one.
  listed_hosts_set = join(" ", formatlist("%q", sort(distinct(concat([local.admin_host, local.pages_host], var.excluded_hostnames)))))

  under_domain = format("ends_with(http.host, %q)", ".${local.domain}")

  # What makes a hostname a site's: the prefix under `domain`, anything under the pages hostname otherwise.
  site_match = local.sites_under_pages ? format("ends_with(http.host, %q)", ".${local.pages_host}") : format("(starts_with(http.host, %q) and %s)", var.prefix, local.under_domain)

  # With an empty prefix a site cannot be told from a made-up name, so no host rule exists.
  host_rule_enabled = var.host_rule && (local.sites_under_pages || var.prefix != "")

  # Blocks every hostname under the domain that is not a site, the admin hostname, the pages hostname, or an excluded hostname.
  host_rule_expression = "${local.under_domain} and not (http.host in {${local.listed_hosts_set}}) and not ${local.site_match}"

  # A Free plan rate rule may match on the path alone, so it counts every request to the zone.
  rate_rule_expression = "starts_with(http.request.uri.path, \"/\")"

  # The zone values the module owns: the records, routes, and rules above follow them in the same apply.
  zone_binding = {
    domain             = local.domain
    names              = var.layout
    admin_hostname     = var.admin_hostname
    pages_hostname     = var.pages_hostname
    prefix             = var.prefix
    excluded_hostnames = sort(var.excluded_hostnames)
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
