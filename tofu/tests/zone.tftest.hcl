# What each switch and each state of the zone creates. Without these an install could gain or lose a record, a route, or the rule unnoticed.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
    }
  }

  mock_data "cloudflare_dns_records" {
    defaults = {
      result = []
    }
  }
}

variables {
  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "tests/fixtures/worker.bundle"
}

run "defaults" {
  command = plan

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "An install needs the wildcard record and the admin record, nothing else."
  }

  assert {
    condition     = alltrue([for record in cloudflare_dns_record.poplin : record.proxied && record.type == "AAAA" && startswith(record.comment, "poplin: ")])
    error_message = "Every record is proxied and carries a comment that marks it as poplin's."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-page.example.com/*", "admin.example.com/*"])
    error_message = "The routes take the hostnames that end in the suffix, and the admin hostname, and no other hostname of the zone."
  }

  assert {
    condition     = alltrue([for route in cloudflare_workers_route.worker : route.script == "poplin"])
    error_message = "Every Worker route names the Worker."
  }

  assert {
    condition     = !strcontains(cloudflare_ruleset.rate[0].rules[0].expression, "http.host")
    error_message = "By default the rate rule exists and never reads the hostname: the Free plan refuses a rate rule that does."
  }

  assert {
    condition     = output.bucket_name == "poplin-sites" && output.worker_name == "poplin" && output.admin_url == "https://admin.example.com" && output.site_url_pattern == "https://<name>--<id>-page.example.com"
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
    gallery   = true
    max_sites = 50
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
      domain         = "example.com"
      admin_hostname = "admin"
      suffix         = "-page"
    }
    error_message = "The zone binding carries the domain, the admin hostname, and the suffix."
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

run "rate_rule_switched_off" {
  command = plan

  variables {
    rate_rule = "off"
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 0
    error_message = "rate_rule = off creates no rate rule."
  }
}

run "suffix_follows_the_input" {
  command = plan

  variables {
    suffix = "-site"
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-site.example.com/*", "admin.example.com/*"])
    error_message = "The site route ends in the suffix the caller chose."
  }

  assert {
    condition     = output.site_url_pattern == "https://<name>--<id>-site.example.com"
    error_message = "A site's address ends in the suffix the caller chose."
  }
}

run "own_records_are_no_records_of_the_zone" {
  command = plan

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [
        {
          name                = "*.example.com", type = "AAAA", proxied = true, comment = "poplin: every site", id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
        {
          name                = "admin.example.com", type = "AAAA", proxied = true, comment = "poplin: the dashboard, the login, the API, and the MCP server", id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
      ]
    }
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "A second run reads the module's own records back and must plan the same records, or the wildcard would be destroyed on every other apply."
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 1
    error_message = "The module's own records are no hostnames of the zone's, so the zone-wide rate rule stays."
  }
}

run "zone_with_its_own_proxied_wildcard" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "*.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["admin.example.com"])
    error_message = "The zone's own proxied wildcard already carries the site hostnames to Cloudflare: a second record beside it would answer for the zone's other names too."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-page.example.com/*", "admin.example.com/*"])
    error_message = "The routes do not depend on whose wildcard record it is."
  }
}

run "zone_with_its_own_unproxied_wildcard" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "*.example.com", type = "CNAME", proxied = false, comment = "the old host", id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  expect_failures = [cloudflare_workers_route.worker]
}

run "zone_record_under_a_name_the_site_route_takes" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "status-page.example.com", type = "CNAME", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  expect_failures = [cloudflare_workers_route.worker]
}

run "zone_record_under_the_admin_hostname" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "admin.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  expect_failures = [cloudflare_workers_route.worker]
}

run "zone_wide_rate_rule_on_a_zone_with_other_hostnames" {
  command = plan

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "www.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  expect_failures = [cloudflare_ruleset.rate]
}

run "zone_with_other_hostnames_and_the_rate_rule_off" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [
        {
          name                = "www.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
        {
          name                = "example.com", type = "MX", proxied = false, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
      ]
    }
  }

  assert {
    condition     = length(cloudflare_ruleset.rate) == 0
    error_message = "rate_rule = off creates no rate rule."
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "admin.example.com"])
    error_message = "The zone's other hostnames change no record of the install."
  }
}

run "rate_rule_on_the_hostnames" {
  command = plan

  variables {
    gallery   = true
    rate_rule = "hostnames"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "www.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  assert {
    condition     = cloudflare_ruleset.rate[0].rules[0].expression == "ends_with(http.host, \"-page.example.com\") or http.host eq \"admin.example.com\""
    error_message = "The hostnames form counts the install's hostnames alone, so the zone's other hostnames do not stop it."
  }
}
