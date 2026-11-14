# The rule that runs before the Worker. Its expression is built in main.tf.

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
