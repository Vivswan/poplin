# What each switch and each state of the zone creates. Without these an install could gain or lose a record, a route, or the rule unnoticed.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "free", name = "Free Website", id = "0", price = 0, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
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
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "poplin.example.com"])
    error_message = "An install needs the wildcard record and the admin record, nothing else."
  }

  assert {
    condition     = alltrue([for record in cloudflare_dns_record.poplin : record.proxied && record.type == "AAAA" && startswith(record.comment, "poplin: ")])
    error_message = "Every record is proxied and carries a comment that marks it as poplin's."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-page.example.com/*", "*-poplin.example.com/*", "poplin.example.com/*"])
    error_message = "The routes take the hostnames that end in the marker, and the admin hostname, and no other hostname of the zone."
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
    condition     = output.bucket_name == "poplin-sites" && output.worker_name == "poplin" && output.admin_url == "https://poplin.example.com" && output.site_url_pattern == "https://<name>--<id>-<letter>-poplin.example.com" && output.public_url_pattern == "https://<public name>-page.example.com"
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
    condition     = tolist([for destination in cloudflare_zero_trust_access_application.login.destinations : "${destination.type} ${destination.uri}"]) == tolist(["public poplin.example.com", "public *-p-poplin.example.com"])
    error_message = "The guarded application covers the whole admin hostname and every private site's address, and nothing else: no open site."
  }

  assert {
    condition     = cloudflare_zero_trust_access_application.login.domain == "poplin.example.com" && length(cloudflare_zero_trust_access_application.login.policies) == 1
    error_message = "The application's first address is the admin hostname, and one policy decides who passes."
  }

  assert {
    condition     = cloudflare_zero_trust_access_application.login.session_duration == "720h" && cloudflare_zero_trust_access_application.login.http_only_cookie_attribute && cloudflare_zero_trust_access_application.login.same_site_cookie_attribute == "lax"
    error_message = "A login lasts 30 days, and its cookie is kept from scripts and from requests other sites make."
  }
}

# A program has no login to give: the API and the setup page must pass Access, and nothing else of the dashboard may. The module joins each address from the hostname and a path.
run "open_paths_are_the_api_and_the_setup_page" {
  command = plan

  assert {
    condition     = tolist([for destination in cloudflare_zero_trust_access_application.open_paths.destinations : "${destination.type} ${destination.uri}"]) == tolist(["public poplin.example.com/api", "public poplin.example.com/setup"])
    error_message = "The open application covers the API and the setup page on the admin hostname, in that order, and no other path."
  }
}

# Access takes an application address of 63 characters at most. Under a domain of 51 the setup page's address is 64.
run "domain_too_long_for_the_login" {
  command = plan

  override_data {
    target = data.cloudflare_zone.this
    values = {
      name    = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "free", name = "Free Website", id = "0", price = 0, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
    }
  }

  expect_failures = [cloudflare_zero_trust_access_application.open_paths]
}

# The public word is one of the install's two endings: it gets a route of its own, every rule reads it, and the Worker is told it.
run "public_word_of_the_installs_own" {
  command = plan

  variables {
    public_word = "wiki"
    rate_rule   = "hostnames"

    paid_plan_allowed = true
  }

  override_data {
    target = data.cloudflare_zone.this
    values = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "pro", name = "Pro Website", id = "0", price = 25, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
    }
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-poplin.example.com/*", "*-wiki.example.com/*", "poplin.example.com/*"])
    error_message = "The public names' ending has a route of its own beside the label addresses' and the admin hostname's."
  }

  assert {
    condition     = jsondecode(cloudflare_workers_script.poplin.bindings[3].json).public_word == "wiki"
    error_message = "The zone binding tells the Worker the public word, so it reads the hostnames the routes send it."
  }

  assert {
    condition     = cloudflare_ruleset.rate[0].rules[0].expression == "ends_with(http.host, \"-poplin.example.com\") or ends_with(http.host, \"-wiki.example.com\") or http.host eq \"poplin.example.com\""
    error_message = "The hostnames the rules read are the ones the routes take."
  }

  # The address the module prints for a public site and for a label must each end as one route's pattern does: an address no route takes dies at Cloudflare.
  assert {
    condition = alltrue([
      for address in [output.public_url_pattern, output.site_url_pattern] :
      anytrue([for route in cloudflare_workers_route.worker : endswith("${address}/*", trimprefix(route.pattern, "*"))])
    ])
    error_message = "Every address the module prints is one a Worker route takes."
  }

  assert {
    condition     = output.public_url_pattern == "https://<public name>-wiki.example.com" && cloudflare_zero_trust_access_application.login.destinations[1].uri == "*-p-poplin.example.com"
    error_message = "A public site's address ends in the word, and the private sites' pattern never follows it."
  }
}

# With the public word `poplin` every site hostname ends alike: one route, and one term with no brackets around it.
run "public_word_poplin" {
  command = plan

  variables {
    public_word = "poplin"
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-poplin.example.com/*", "poplin.example.com/*"])
    error_message = "One ending needs one site route."
  }

  assert {
    condition     = startswith(cloudflare_ruleset.guards[0].rules[0].expression, "ends_with(http.host, \"-poplin.example.com\") and any(")
    error_message = "One term stands without brackets in front of the rule's condition."
  }
}

# A request over http to one of the install's hostnames is redirected before the Worker runs, and no other hostname of the zone is.
run "https_redirect" {
  command = plan

  assert {
    condition = cloudflare_ruleset.https[0].name == "poplin redirect rule" && cloudflare_ruleset.https[0].phase == "http_request_dynamic_redirect" && [for rule in cloudflare_ruleset.https[0].rules : [
      rule.ref, rule.description, rule.action, rule.action_parameters.from_value.target_url.expression,
      tostring(rule.action_parameters.from_value.status_code), tostring(rule.action_parameters.from_value.preserve_query_string),
      ]] == [[
      "poplin_https", "poplin: send http to https", "redirect", "concat(\"https://\", http.host, http.request.uri.path)",
      "301", "true",
    ]]
    error_message = "The redirect rule is, value for value, the one the setup client writes: the same host and path over https, the query kept, answered 301."
  }

  assert {
    condition     = cloudflare_ruleset.https[0].rules[0].expression == "not ssl and (ends_with(http.host, \"-poplin.example.com\") or ends_with(http.host, \"-page.example.com\") or http.host eq \"poplin.example.com\")"
    error_message = "The rule reads plain http to the site hostnames and the admin hostname, and no other hostname of the zone."
  }
}

run "https_redirect_switched_off" {
  command = plan

  variables {
    https_redirect = false
  }

  assert {
    condition     = length(cloudflare_ruleset.https) == 0
    error_message = "https_redirect = false creates no redirect ruleset, for a zone that keeps redirect rules of its own."
  }
}

run "worker_bindings" {
  command = plan

  variables {
    max_sites              = 50
    search_engines_allowed = true
  }

  assert {
    condition     = tolist([for binding in cloudflare_workers_script.poplin.bindings : "${binding.name} ${binding.type}"]) == tolist(["SITES r2_bucket", "DB d1", "MINUTE_LIMITS ratelimit", "ZONE json", "FIRST_SETTINGS json", "ACCESS json", "ACCOUNT_ID plain_text", "WORKER_NAME plain_text", "JOBS workflow"])
    error_message = "The Worker gets the bucket, the database, the minute limiter, the zone values, the first settings, the Access application, its account, its own name, and its Workflow, under the names its code reads."
  }

  assert {
    condition     = cloudflare_workers_script.poplin.keep_bindings == toset(["secret_text"])
    error_message = "The module asks the upload to keep the secrets the Worker has: without that, an apply with a new bundle would drop the key a Repair wrote."
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
      domain      = "example.com"
      public_word = "page"
    }
    error_message = "The zone binding carries the domain and the public word, and no other key."
  }

  # The setup client's tests read this literal too, and compare its keys with the settings the Worker stores.
  assert {
    condition = jsondecode(cloudflare_workers_script.poplin.bindings[4].json) == {
      default_expires             = "never"
      default_search_engines      = "off"
      versions_kept               = "3"
      trash_days                  = "7"
      logins                      = "owner@example.com"
      outside_pages               = "blocked"
      search_engines_allowed      = "on"
      block_bots                  = "auto"
      max_total_size              = "9GB"
      max_site_size               = "200MB"
      max_sites                   = "50"
      max_files_per_publish       = "5000"
      max_files_per_day           = "25000"
      max_storage_writes_per_day  = "30000"
      requests_per_day            = "100000"
      site_share_of_day           = "25%"
      site_requests_per_minute    = "6000"
      visitor_requests_per_minute = "600"
      update_check                = "on"
      auto_update                 = "off"
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

# A copy too large for one request is run by the Workflow the binding names, so the binding and the Workflow must name the same one, of the same class, on the module's own Worker.
run "jobs_workflow" {
  command = plan

  assert {
    condition     = cloudflare_workflow.jobs.script_name == cloudflare_workers_script.poplin.script_name
    error_message = "The Workflow runs the code of the module's own Worker."
  }

  assert {
    condition     = cloudflare_workers_script.poplin.bindings[8].workflow_name == cloudflare_workflow.jobs.workflow_name && cloudflare_workers_script.poplin.bindings[8].class_name == cloudflare_workflow.jobs.class_name
    error_message = "The Worker's binding names the module's own Workflow and its class."
  }
}

# An account names a Workflow in 64 characters at most, and a Worker's name may have 63.
run "jobs_workflow_of_the_longest_worker_name" {
  command = plan

  variables {
    worker_name = "a23456789b23456789c23456789d23456789e23456789f23456789g23456789"
  }

  assert {
    condition     = cloudflare_workflow.jobs.workflow_name == "a23456789b23456789c23456789d23456789e23456789f23456789g2345-jobs"
    error_message = "The Worker's name is cut so that the Workflow's name fits, and still ends in -jobs."
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
      "*.example.com"      = "AAAA 100:: poplin: every site"
      "poplin.example.com" = "AAAA 100:: poplin: the dashboard, the login, and the API"
    }
    error_message = "Each record points at the discard address and carries the comment the setup client writes for its name."
  }

  assert {
    condition     = cloudflare_zero_trust_access_policy.logins.name == "poplin logins" && cloudflare_zero_trust_access_application.login.name == "poplin" && cloudflare_zero_trust_access_policy.open_paths.name == "poplin open paths policy" && cloudflare_zero_trust_access_application.open_paths.name == "poplin open paths"
    error_message = "Both policies and both applications carry the names the setup client finds them by."
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
      "poplin_bots: poplin: stop verified bots, other methods, and scanner paths",
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
          name                = "poplin.example.com", type = "AAAA", proxied = true, comment = "poplin: the dashboard, the login, and the API", id = "0", content = "100::", ttl = 1, proxiable = true,
          comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
          private_routing     = null, settings = null, tags = null, tags_modified_on = null
        },
      ]
    }
  }

  assert {
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "poplin.example.com"])
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
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["poplin.example.com"])
    error_message = "The zone's own proxied wildcard already carries the site hostnames to Cloudflare: a second record beside it would answer for the zone's other names too."
  }

  assert {
    condition     = sort([for route in cloudflare_workers_route.worker : route.pattern]) == tolist(["*-page.example.com/*", "*-poplin.example.com/*", "poplin.example.com/*"])
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
        name                = "status-poplin.example.com", type = "CNAME", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
        comment_modified_on = null, created_on = null, data = null, meta = null, modified_on = null, priority = null,
        private_routing     = null, settings = null, tags = null, tags_modified_on = null
      }]
    }
  }

  expect_failures = [cloudflare_workers_route.worker]
}

run "zone_record_under_a_name_the_public_route_takes" {
  command = plan

  variables {
    rate_rule = "off"
  }

  override_data {
    target = data.cloudflare_dns_records.zone
    values = {
      result = [{
        name                = "home-page.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
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
        name                = "poplin.example.com", type = "A", proxied = true, comment = null, id = "0", content = "192.0.2.1", ttl = 1, proxiable = true,
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
    condition     = sort(keys(cloudflare_dns_record.poplin)) == tolist(["*.example.com", "poplin.example.com"])
    error_message = "The zone's other hostnames change no record of the install."
  }
}

run "rate_rule_on_the_hostnames" {
  command = plan

  variables {
    rate_rule         = "hostnames"
    paid_plan_allowed = true
  }

  override_data {
    target = data.cloudflare_zone.this
    values = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "pro", name = "Pro Website", id = "0", price = 25, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
    }
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
    condition     = cloudflare_ruleset.rate[0].rules[0].expression == "ends_with(http.host, \"-poplin.example.com\") or ends_with(http.host, \"-page.example.com\") or http.host eq \"poplin.example.com\""
    error_message = "The hostnames form counts the install's hostnames alone, so the zone's other hostnames do not stop it."
  }
}

run "guards_by_default" {
  command = plan

  assert {
    condition = tolist([for rule in cloudflare_ruleset.guards[0].rules : rule.expression]) == tolist([
      "(ends_with(http.host, \"-poplin.example.com\") or ends_with(http.host, \"-page.example.com\")) and any(http.request.headers[\"sec-fetch-site\"][*] eq \"cross-site\") and any(http.request.headers[\"sec-fetch-dest\"][*] ne \"document\")",
      join(" or ", [
        "(ends_with(http.host, \"-poplin.example.com\") or ends_with(http.host, \"-page.example.com\")) and not starts_with(http.request.uri.path, \"/cdn-cgi/\") and (cf.client.bot",
        "not http.request.method in {\"GET\" \"HEAD\"}",
        "ends_with(http.request.uri.path, \".php\")",
        "ends_with(http.request.uri.path, \"/.env\")",
        "http.request.uri.path contains \"/.env.\"",
        "http.request.uri.path contains \"/.git/\"",
        "starts_with(http.request.uri.path, \"/wp-admin/\")",
        "starts_with(http.request.uri.path, \"/cgi-bin/\")",
        "starts_with(lower(http.request.uri.path), \"/phpmyadmin\"))",
      ]),
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
  }

  assert {
    condition     = strcontains(cloudflare_ruleset.guards[0].rules[1].expression, " and ((cf.client.bot and cf.verified_bot_category ne \"Search Engine Crawler\") or not http.request.method in ")
    error_message = "search_engines_allowed lets the search engine category pass and stops every other verified bot."
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

# The setup page skips a rate rule that reads the hostname on the Free plan, which refuses one. The module stops instead of sending it.
run "rate_rule_on_the_hostnames_of_a_free_zone" {
  command = plan

  variables {
    rate_rule = "hostnames"
  }

  expect_failures = [cloudflare_ruleset.rate]
}

# The setup page switches Bot Fight Mode on only on the Free plan, the one plan that has it.
run "block_bots_forced_on_a_paid_plan" {
  command = plan

  variables {
    block_bots        = "on"
    rate_rule         = "hostnames"
    paid_plan_allowed = true
  }

  override_data {
    target = data.cloudflare_zone.this
    values = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "pro", name = "Pro Website", id = "0", price = 25, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
    }
  }

  assert {
    condition     = cloudflare_bot_management.zone[0].ai_bots_protection == "block" && cloudflare_bot_management.zone[0].fight_mode == false
    error_message = "On a paid plan the AI bot block is set and Bot Fight Mode is never switched on."
  }
}

# R2 has no spending cap, so the alerts are what tells the logins before the free allowance ends.
run "usage_alerts_at_two_shares" {
  command = plan

  variables {
    logins               = ["owner@example.com", "editor@example.com"]
    usage_alert_percents = [50, 90]
  }

  assert {
    condition = tomap({ for key, policy in cloudflare_notification_policy.usage : key => policy.filters.limit[0] }) == tomap({
      r2_storage_50            = "5000000000"
      r2_storage_90            = "9000000000"
      r2_class_a_operations_50 = "500000"
      r2_class_a_operations_90 = "900000"
      r2_class_b_operations_50 = "5000000"
      r2_class_b_operations_90 = "9000000"
    })
    error_message = "Each of R2's three meters has an alert at half and at nine tenths of its free monthly allowance, written as a whole number."
  }

  assert {
    condition     = alltrue([for key, policy in cloudflare_notification_policy.usage : policy.alert_type == "billing_usage_alert" && policy.enabled && startswith(key, policy.filters.product[0])])
    error_message = "Every alert is a usage alert, switched on, for the one product its key names."
  }

  assert {
    condition     = alltrue([for policy in cloudflare_notification_policy.usage : toset([for email in policy.mechanisms.email : email.id]) == toset(["editor@example.com", "owner@example.com"])])
    error_message = "Every alert goes to exactly the logins."
  }
}

# The default, an empty list, hands the merge three empty maps, which must still plan to no alert.
run "usage_alerts_off_by_default" {
  command = plan

  assert {
    condition     = length(cloudflare_notification_policy.usage) == 0
    error_message = "By default no alert is made, so a token without the Notifications permission still applies."
  }
}

# A site's live files and its dropped ones sit under the same random folder, so by default the bucket deletes no file at all.
run "bucket_cleanup_by_default" {
  command = plan

  assert {
    condition     = [for rule in cloudflare_r2_bucket_lifecycle.sites.rules : rule.id] == ["poplin-unfinished-uploads"]
    error_message = "By default the bucket has the one rule for uploads nobody finished."
  }

  assert {
    condition     = cloudflare_r2_bucket_lifecycle.sites.rules[0].abort_multipart_uploads_transition.condition.max_age == 86400 && cloudflare_r2_bucket_lifecycle.sites.rules[0].delete_objects_transition == null
    error_message = "The rule ends an unfinished upload after a day and deletes no stored file, so no live site loses one."
  }
}

# The two rules carry different transitions, and must still make one list the provider takes.
run "bucket_cleanup_of_a_test_install" {
  command = plan

  variables {
    test_install_file_days = 2
  }

  assert {
    condition     = [for rule in cloudflare_r2_bucket_lifecycle.sites.rules : rule.id] == ["poplin-unfinished-uploads", "poplin-test-install-files"]
    error_message = "A test install keeps the first rule and gains the one that deletes every file."
  }

  assert {
    condition     = cloudflare_r2_bucket_lifecycle.sites.rules[1].delete_objects_transition.condition.max_age == 172800 && cloudflare_r2_bucket_lifecycle.sites.rules[1].conditions.prefix == ""
    error_message = "The test rule deletes every file of the bucket at the age given, in seconds."
  }
}

# A paid plan is a bill: the apply stops unless the caller says the plan is meant.
run "paid_plan_without_the_callers_word" {
  command = plan

  override_data {
    target = data.cloudflare_zone.this
    values = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
      plan    = { legacy_id = "pro", name = "Pro Website", id = "0", price = 25, currency = "USD", frequency = "", can_subscribe = false, is_subscribed = false, legacy_discount = false, externally_managed = false }
    }
  }

  expect_failures = [data.cloudflare_zone.this]
}
