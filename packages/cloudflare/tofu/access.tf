# The login in front of the one path a person opens to prove who they are. Every other path is the Worker's to guard.
# Access keeps no mark on either object, so poplin's setup client finds them by these names.

resource "cloudflare_zero_trust_access_policy" "logins" {
  account_id = var.account_id
  name       = "poplin logins"
  decision   = "allow"
  include    = [for email in sort(var.logins) : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "login" {
  account_id = var.account_id
  name       = "poplin"
  type       = "self_hosted"
  domain     = "${local.admin_host}/login"

  destinations = [{ type = "public", uri = "${local.admin_host}/login" }]

  policies = [{ id = cloudflare_zero_trust_access_policy.logins.id, precedence = 1 }]
}
