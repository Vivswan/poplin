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
  access_team_domain = "team.cloudflareaccess.com"
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
    condition     = tolist([for destination in cloudflare_zero_trust_access_application.login.destinations : destination.uri]) == tolist(["admin.example.com/login"]) && cloudflare_zero_trust_access_application.login.domain == "admin.example.com/login"
    error_message = "The login covers the login path on the admin hostname and no other path."
  }
}

run "worker_bindings" {
  command = plan

  variables {
    admin_hostname         = "admin.tools"
    gallery                = true
    max_sites              = 50
    search_engines_allowed = true
  }

  assert {
    condition     = tolist([for binding in cloudflare_workers_script.poplin.bindings : "${binding.name} ${binding.type}"]) == tolist(["SITES r2_bucket", "DB d1", "MINUTE_LIMITS ratelimit", "ZONE json", "FIRST_SETTINGS json", "ACCESS json"])
    error_message = "The Worker gets the bucket, the database, the minute limiter, the zone values, the first settings, and the Access application, under the names its code reads."
  }

  assert {
    condition     = cloudflare_workers_script.poplin.bindings[0].bucket_name == "poplin-sites"
    error_message = "The bucket binding names the module's bucket."
  }

  assert {
    condition     = cloudflare_workers_script.poplin.bindings[2].namespace_id == "1001" && cloudflare_workers_script.poplin.bindings[2].simple.limit == 1000000 && cloudflare_workers_script.poplin.bindings[2].simple.period == 60
    error_message = "The minute limiter has the limit and the period the Worker's counters weigh each request against."
  }

  # The setup client's tests read this literal and parse it with the Worker's own reader.
  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[3].json) == {
      domain         = "example.com"
      admin_hostname = "admin.tools.example.com"
      suffix         = "-page"
    }
    error_message = "The zone binding carries the domain, the whole admin hostname, and the suffix, and no other key."
  }

  # The setup client's tests read this literal too, and compare its keys with the settings the Worker stores.
  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[4].json) == {
      default_expires             = "never"
      default_search_engines      = "off"
      versions_kept               = "3"
      trash_days                  = "7"
      logins                      = "owner@example.com"
      dashboard_title             = "admin.tools.example.com"
      gallery                     = "on"
      cache_html                  = "60s"
      cache_files                 = "1h"
      private_sites               = "single-file"
      outside_pages               = "blocked"
      search_engines_allowed      = "on"
      block_bots                  = "auto"
      max_total_size              = "9GB"
      max_site_size               = "200MB"
      max_sites                   = "50"
      requests_per_day            = "100000"
      site_share_of_day           = "25%"
      site_requests_per_minute    = "60"
      visitor_requests_per_minute = "30"
    }
    error_message = "The first settings carry every setting the Worker stores, and no other key, each in the text form `poplin config` takes."
  }
}

# The Worker checks a login's token against the team and the audience tag bound here. The tag is known only once the application exists, so this run applies.
run "access_binding_names_the_login_application" {
  command = apply

  override_resource {
    target = cloudflare_zero_trust_access_application.login
    values = {
      aud = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2"
    }
  }

  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[5].json) == {
      team_domain = "team.cloudflareaccess.com"
      audience    = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2"
    }
    error_message = "The ACCESS binding holds the team domain as given and the audience tag of the module's own Access application."
  }
}

# The Worker's scheduled run is the only thing that empties the trash, so the trigger must exist and fire as often as the Worker's code expects.
run "sweep_trigger" {
  command = plan

  assert {
    condition     = cloudflare_workers_cron_trigger.sweep.script_name == "poplin" && [for schedule in cloudflare_workers_cron_trigger.sweep.schedules : schedule.cron] == ["*/15 * * * *"]
    error_message = "The sweep runs on the Worker every 15 minutes."
  }
}

# The setup client finds the install's objects by these values and writes the same ones: packages/cloudflare/src/zone/install-objects.ts holds its copy.
run "values_shared_with_the_setup_client" {
  command = plan

  assert {
    condition = { for name, record in cloudflare_dns_record.poplin : name => "${record.type} ${record.content} ${record.comment}" } == {
      "*.example.com"     = "AAAA 100:: poplin: every site"
      "admin.example.com" = "AAAA 100:: poplin: the dashboard, the login, and the API"
    }
    error_message = "Each record points at the discard address and carries the comment the setup client writes for its name."
  }

  assert {
    condition     = cloudflare_zero_trust_access_policy.logins.name == "poplin logins" && cloudflare_zero_trust_access_application.login.name == "poplin"
    error_message = "The policy and the application carry the names the setup client finds them by."
  }

  assert {
    condition     = cloudflare_d1_database.records.name == "poplin"
    error_message = "The database carries the name the setup client finds it by."
  }

  assert {
    condition = cloudflare_ruleset.rate[0].name == "poplin rate rule" && [for rule in cloudflare_ruleset.rate[0].rules : [
      rule.ref, rule.description, rule.expression, rule.action, join(" ", rule.ratelimit.characteristics),
      tostring(rule.ratelimit.period), tostring(rule.ratelimit.requests_per_period), tostring(rule.ratelimit.mitigation_timeout),
      ]] == [[
      "poplin_rate", "poplin: 300 requests per 10 seconds per address", "starts_with(http.request.uri.path, \"/\")", "block", "cf.colo.id ip.src",
      "10", "300", "10",
    ]]
    error_message = "The rate rule is, value for value, the one the setup client writes on the Free plan."
  }

  assert {
    condition = cloudflare_ruleset.guards[0].name == "poplin guard rules" && [for rule in cloudflare_ruleset.guards[0].rules : "${rule.ref}: ${rule.description}"] == [
      "poplin_outside_pages: poplin: stop pages of other domains",
      "poplin_bots: poplin: stop verified bots",
    ]
    error_message = "The guard rules carry the refs and the descriptions the setup client writes."
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

# The setup client writes the same two records, so this is also the zone it set up.
run "own_records_are_no_records_of_the_zone" {
  command = plan

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [
        {
          name                = "*.example.com", type = "AAAA", proxied = true, comment = "poplin: every site", id = "0", content = "100::", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
        {
          name                = "admin.example.com", type = "AAAA", proxied = true, comment = "poplin: the dashboard, the login, and the API", id = "0", content = "100::", ttl = 1, proxiable = true,
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

  assert {
    condition     = output.block_bots == "set"
    error_message = "The install's own records are no hostnames of the zone's, so the bot settings stay."
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

run "guards_by_default" {
  command = plan

  assert {
    condition = tolist([for rule in cloudflare_ruleset.guards[0].rules : rule.expression]) == tolist([
      "ends_with(http.host, \"-page.example.com\") and any(http.request.headers[\"sec-fetch-site\"][*] eq \"cross-site\") and any(http.request.headers[\"sec-fetch-dest\"][*] ne \"document\")",
      "ends_with(http.host, \"-page.example.com\") and cf.client.bot",
    ])
    error_message = "By default the outside pages rule and the bots rule exist, each reads the site hostnames alone, and a request for a document or one that lacks a Fetch Metadata header passes the first."
  }

  assert {
    condition     = alltrue([for rule in cloudflare_ruleset.guards[0].rules : rule.action == "block" && startswith(rule.ref, "poplin_")])
    error_message = "Every guard rule blocks and carries a ref that marks it as poplin's."
  }

  assert {
    condition     = cloudflare_bot_management.zone[0].ai_bots_protection == "block" && cloudflare_bot_management.zone[0].fight_mode == false
    error_message = "On a zone with no hostnames of its own the AI bot block is set, and Bot Fight Mode is off: it may challenge the install's own command line."
  }

  assert {
    condition     = output.block_bots == "set" && sort(keys(output.guard_rule_expressions)) == tolist(["poplin_bots", "poplin_outside_pages"])
    error_message = "The outputs say the switches are set and carry both guard expressions."
  }
}

run "outside_pages_allowed" {
  command = plan

  variables {
    outside_pages = "allowed"
  }

  assert {
    condition     = tolist([for rule in cloudflare_ruleset.guards[0].rules : rule.ref]) == tolist(["poplin_bots"])
    error_message = "outside_pages = allowed leaves the bots rule alone in the ruleset, so an apply removes the outside pages rule."
  }
}

run "search_engines_let_through" {
  command = plan

  variables {
    search_engines_allowed = true
    suffix                 = "-site"
  }

  assert {
    condition     = cloudflare_ruleset.guards[0].rules[1].expression == "ends_with(http.host, \"-site.example.com\") and cf.client.bot and cf.verified_bot_category ne \"Search Engine Crawler\""
    error_message = "search_engines_allowed lets the search engine category pass and stops every other verified bot, on the suffix the caller chose."
  }
}

run "block_bots_on_a_zone_with_other_hostnames" {
  command = plan

  variables {
    rate_rule = "off"
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
    condition     = length(cloudflare_bot_management.zone) == 0
    error_message = "A bot switch covers the zone's own hostnames too, so `auto` sets none on a zone that has some."
  }

  assert {
    condition     = output.block_bots == "the AI bot block covers the whole zone, and the zone has hostnames of its own: www.example.com"
    error_message = "A skipped switch says why and names the hostnames."
  }

  assert {
    condition     = length(cloudflare_ruleset.guards[0].rules) == 2
    error_message = "The guard rules read the site hostnames alone, so the zone's other hostnames do not stop them."
  }
}

run "block_bots_forced_on_a_zone_with_other_hostnames" {
  command = plan

  variables {
    rate_rule  = "off"
    block_bots = "on"
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
    condition     = cloudflare_bot_management.zone[0].ai_bots_protection == "block" && cloudflare_bot_management.zone[0].fight_mode == true
    error_message = "block_bots = on is the caller's word that the whole zone may be covered: both switches are set whatever the zone holds."
  }
}
