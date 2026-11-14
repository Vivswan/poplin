# A request over `http` to one of the install's hostnames is sent to `https` before the Worker runs. The rule reads those hostnames alone, so the zone's other hostnames stay as they are.

resource "cloudflare_ruleset" "https" {
  count = var.https_redirect ? 1 : 0

  zone_id = var.zone_id
  name    = "poplin redirect rule"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "poplin_https"
    description = "poplin: send http to https"
    expression  = local.plain_http_expression
    action      = "redirect"

    action_parameters = {
      from_value = {
        target_url            = { expression = "concat(\"https://\", http.host, http.request.uri.path)" }
        status_code           = 301
        preserve_query_string = true
      }
    }
  }]
}
