# What each layout and each switch creates. Without these a layout could gain or lose a record, a route, or a rule unnoticed.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
    }
  }
}

variables {
  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "tests/fixtures/worker.bundle"
}

run "domain_layout_by_default" {
  command = plan

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "The domain layout needs the wildcard record and the admin record, nothing else."
  }

  assert {
    condition     = alltrue([for record in cloudflare_dns_record.poplin : record.proxied && record.type == "AAAA" && startswith(record.comment, "poplin: ")])
    error_message = "Every record is proxied and carries a comment that marks it as poplin's."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.example.com/*"])
    error_message = "The domain layout needs one Worker route, on the wildcard."
  }

  assert {
    condition     = alltrue([for route in cloudflare_workers_route.worker : route.script == "poplin"])
    error_message = "Every Worker route names the Worker."
  }

  assert {
    condition     = length(cloudflare_workers_route.excluded) == 0
    error_message = "No excluded hostname means no route without a Worker."
  }

  assert {
    condition = cloudflare_ruleset.host[0].rules[0].expression == join(" and ", [
      "ends_with(http.host, \".example.com\")",
      "not (http.host in {\"admin.example.com\" \"pages.example.com\"})",
      "not (starts_with(http.host, \"page-\") and ends_with(http.host, \".example.com\"))",
    ])
    error_message = "The host rule blocks every hostname under the domain that is not the admin hostname, the pages hostname, or a prefixed site."
  }

  assert {
    condition     = output.bucket_name == "poplin-sites" && output.worker_name == "poplin" && output.admin_url == "https://admin.example.com" && output.site_url_pattern == "https://page-<name>.example.com"
    error_message = "The outputs name the bucket, the Worker, the dashboard, and a site's address."
  }
}

run "login_allows_exactly_the_logins" {
  command = plan

  variables {
    logins = ["second@example.com", "owner@example.com"]
  }

  assert {
    condition     = sort([for rule in cloudflare_zero_trust_access_policy.logins.include : rule.email.email]) == tolist(["owner@example.com", "second@example.com"])
    error_message = "The policy includes each login and nobody else."
  }

  assert {
    condition     = tolist([for destination in cloudflare_zero_trust_access_application.login.destinations : destination.uri]) == tolist(["admin.example.com/login", "admin.example.com/oauth/authorize"])
    error_message = "The login covers the two login paths on the admin hostname and no other path."
  }
}

run "worker_bindings" {
  command = plan

  variables {
    excluded_hostnames = ["www.example.com"]
    gallery            = true
    max_sites          = 50
  }

  assert {
    condition     = tolist([for binding in cloudflare_workers_script.poplin.bindings : binding.name]) == tolist(["SITES", "ZONE", "FIRST_SETTINGS"])
    error_message = "The Worker gets the bucket, the zone values, and the first settings."
  }

  assert {
    condition     = cloudflare_workers_script.poplin.bindings[0].bucket_name == "poplin-sites"
    error_message = "The bucket binding names the module's bucket."
  }

  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[1].json) == {
      domain             = "example.com"
      names              = "domain"
      admin_hostname     = "admin"
      pages_hostname     = "pages"
      prefix             = "page-"
      excluded_hostnames = ["www.example.com"]
    }
    error_message = "The zone binding carries the domain, the layout, the two hostnames, the prefix, and the excluded hostnames."
  }

  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[2].json) == {
      default_expires             = "never"
      default_search_engines      = "off"
      versions_kept               = "3"
      trash_days                  = "7"
      logins                      = "owner@example.com"
      dashboard_title             = "admin.example.com"
      gallery                     = "on"
      cache_html                  = "60s"
      private_sites               = "single-file"
      max_total_size              = "9GB"
      max_site_size               = "200MB"
      max_sites                   = "50"
      requests_per_day            = "100000"
      site_share_of_day           = "25%"
      site_requests_per_minute    = "60"
      visitor_requests_per_minute = "30"
    }
    error_message = "The first settings carry every key in the text form `poplin config` takes."
  }
}

run "gallery_adds_the_pages_record" {
  command = plan

  variables {
    gallery = true
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com", "pages.example.com"])
    error_message = "With the gallery on the domain layout also needs the pages record."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.example.com/*"])
    error_message = "The wildcard route already covers the pages hostname."
  }
}

run "gallery_on_the_bare_domain" {
  command = plan

  variables {
    gallery        = true
    pages_hostname = ""
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com", "example.com"])
    error_message = "An empty pages hostname puts the gallery's record on the bare domain."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.example.com/*", "example.com/*"])
    error_message = "The wildcard route never covers the bare domain, so it needs its own route."
  }
}

run "bare_domain_untouched_while_the_gallery_is_off" {
  command = plan

  variables {
    pages_hostname = ""
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "With the gallery off nothing is created on the bare domain."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.example.com/*"])
    error_message = "With the gallery off the bare domain has no route."
  }
}

run "subdomain_per_site_layout" {
  command = plan

  variables {
    layout = "subdomain-per-site"
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.pages.example.com", "admin.example.com", "pages.example.com"])
    error_message = "A subdomain layout needs the admin record, the pages record, and the wildcard under the pages hostname."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.pages.example.com/*", "admin.example.com/*", "pages.example.com/*"])
    error_message = "A subdomain layout needs one route for each of its three records."
  }

  assert {
    condition     = endswith(cloudflare_ruleset.host[0].rules[0].expression, " and not ends_with(http.host, \".pages.example.com\")")
    error_message = "Under a subdomain layout a site is anything under the pages hostname."
  }

  assert {
    condition     = output.site_url_pattern == "https://<name>.pages.example.com"
    error_message = "Under a subdomain layout a site sits under the pages hostname, with no prefix."
  }
}

run "subdomain_wildcard_layout" {
  command = plan

  variables {
    layout         = "subdomain-wildcard"
    pages_hostname = "sites"
    prefix         = ""
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.sites.example.com", "admin.example.com", "sites.example.com"])
    error_message = "The records follow the pages hostname."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*.sites.example.com/*", "admin.example.com/*", "sites.example.com/*"])
    error_message = "The routes follow the pages hostname."
  }

  assert {
    condition     = length(cloudflare_ruleset.host) == 1
    error_message = "A subdomain layout does not use the prefix, so an empty one keeps the host rule."
  }
}

run "empty_prefix_has_no_host_rule" {
  command = plan

  variables {
    prefix = ""
  }

  assert {
    condition     = length(cloudflare_ruleset.host) == 0
    error_message = "With an empty prefix under the domain layout a site cannot be told from a made-up name, so no host rule exists."
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 1
    error_message = "The rate rule does not depend on the prefix."
  }

  assert {
    condition     = output.site_url_pattern == "https://<name>.example.com"
    error_message = "With an empty prefix a site sits right under the domain."
  }
}

run "rate_rule_switched_off" {
  command = plan

  variables {
    rate_rule = false
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 0
    error_message = "rate_rule = false creates no rate rule."
  }

  assert {
    condition     = length(cloudflare_ruleset.host) == 1
    error_message = "The host rule does not depend on the rate rule."
  }
}

run "host_rule_switched_off" {
  command = plan

  variables {
    host_rule = false
  }

  assert {
    condition     = length(cloudflare_ruleset.host) == 0
    error_message = "host_rule = false creates no host rule, so the zone keeps its own custom rules."
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 1
    error_message = "The rate rule does not depend on the host rule."
  }
}

run "excluded_hostname" {
  command = plan

  variables {
    excluded_hostnames = ["www.example.com", "example.com"]
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.excluded : route.pattern]) == tolist(["example.com/*", "www.example.com/*"])
    error_message = "Each excluded hostname gets one route."
  }

  assert {
    condition     = alltrue([for route in cloudflare_workers_route.excluded : route.script == null])
    error_message = "An excluded hostname's route names no Worker."
  }

  assert {
    condition     = alltrue([for host in ["www.example.com", "example.com"] : strcontains(cloudflare_ruleset.host[0].rules[0].expression, "\"${host}\"")])
    error_message = "Each excluded hostname is on the host rule's list."
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "An excluded hostname gets no record: it keeps its own."
  }
}
