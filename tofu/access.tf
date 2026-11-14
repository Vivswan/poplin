# The login in front of the two paths a person opens to prove who they are. Every other path is the Worker's to guard.

resource "cloudflare_zero_trust_access_policy" "logins" {
  account_id = var.account_id
  name       = "${var.worker_name} logins"
  decision   = "allow"
  include    = [for email in sort(var.logins) : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "login" {
  account_id = var.account_id
  name       = var.worker_name
  type       = "self_hosted"
  domain     = "${local.admin_host}/login"

  destinations = [
    { type = "public", uri = "${local.admin_host}/login" },
    { type = "public", uri = "${local.admin_host}/oauth/authorize" },
  ]

  policies = [{ id = cloudflare_zero_trust_access_policy.logins.id, precedence = 1 }]
}
