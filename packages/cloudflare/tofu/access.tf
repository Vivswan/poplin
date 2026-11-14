# The login: one Access application in front of the one path a person opens to reach the dashboard, and in front of every private site's address.
# A private site's hostname ends in `-p-poplin.<domain>`, so one pattern covers them all and no site needs an application of its own.
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

  destinations = [
    { type = "public", uri = "${local.admin_host}/login" },
    { type = "public", uri = "*-p-poplin.${local.domain}" },
  ]

  policies = [{ id = cloudflare_zero_trust_access_policy.logins.id, precedence = 1 }]

  # A person logs in once in 30 days. The cookie is kept from scripts, and from requests other sites make.
  session_duration           = "720h"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"

  lifecycle {
    precondition {
      condition     = length("${local.admin_host}/login") <= 63 && length("*-p-poplin.${local.domain}") <= 63
      error_message = "The domain is too long for the login: Access takes an application address of 63 characters at most, and both `<admin hostname>/login` and `*-p-poplin.<domain>` must fit."
    }
  }
}
