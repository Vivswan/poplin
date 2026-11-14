# The two rules that run before the Worker. Their expressions are built in main.tf.

resource "cloudflare_ruleset" "host" {
  count = local.host_rule_enabled ? 1 : 0

  zone_id = var.zone_id
  name    = "poplin host rule"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  rules = [{
    ref         = "poplin_host"
    description = "poplin: block hostnames that are no site"
    expression  = local.host_rule_expression
    action      = "block"
  }]

  lifecycle {
    precondition {
      condition     = length(local.host_rule_expression) <= 4096
      error_message = "excluded_hostnames is too long: the host rule's expression must stay within 4096 characters."
    }
  }
}

resource "cloudflare_ruleset" "rate" {
  count = var.rate_rule ? 1 : 0

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
}
