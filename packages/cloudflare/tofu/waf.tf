# The rules that run before the Worker, and the zone's bot switches. The expressions are built in main.tf.

resource "cloudflare_ruleset" "rate" {
  count = var.rate_rule == "off" ? 0 : 1

  zone_id = var.zone_id
  name    = "poplin rate rule"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [{
    ref         = "poplin_rate"
    description = "poplin: 300 requests per 10 seconds per address"
    expression  = local.rate_rule_expression
    action      = "block"

    ratelimit = {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 300
      mitigation_timeout  = 10
    }
  }]

  lifecycle {
    precondition {
      condition     = var.rate_rule != "zone" || length(local.other_names) == 0
      error_message = "rate_rule = \"zone\" counts every request of the zone, and the zone has hostnames of its own: ${join(", ", local.other_names)}. Set rate_rule to \"hostnames\" on a paid plan, or to \"off\"."
    }
  }
}

# The guard rules stop a request before the Worker runs. Each reads the site hostnames alone.
resource "cloudflare_ruleset" "guards" {
  count = var.guard_rules ? 1 : 0

  zone_id = var.zone_id
  name    = "poplin guard rules"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  rules = [
    for rule in local.guard_rules : {
      ref         = rule.ref
      description = rule.description
      expression  = rule.expression
      action      = "block"
    }
  ]
}

# The zone's bot settings, which cover every hostname of the zone: `auto` takes them only on a zone with no hostnames of its own.
resource "cloudflare_bot_management" "zone" {
  count = local.block_bots_skipped == null ? 1 : 0

  zone_id            = var.zone_id
  ai_bots_protection = "block"

  # No rule can exempt a request from Bot Fight Mode, and it may challenge poplin's own command line and agents, so only `on` switches it on.
  fight_mode = var.block_bots == "on"
}
