# The login: one Access application in front of the whole dashboard hostname and of every private site's address, and a second one that lets the open paths of the dashboard past it.
# A private site's hostname ends in `-p-poplin.<domain>`, so one pattern covers them all and no site needs an application of its own.
# Access takes the longer path first: a program reaches the API and the setup page with no login, and the Worker checks the token each of them is given.
# Access keeps no mark on any of the four objects, so poplin's setup client finds them by these names.

resource "cloudflare_zero_trust_access_policy" "open_paths" {
  account_id = var.account_id
  name       = "poplin open paths policy"
  decision   = "bypass"
  include    = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "open_paths" {
  account_id = var.account_id
  name       = "poplin open paths"
  type       = "self_hosted"
  domain     = local.open_addresses[0]

  destinations = [for address in local.open_addresses : { type = "public", uri = address }]

  policies = [{ id = cloudflare_zero_trust_access_policy.open_paths.id, precedence = 1 }]

  # Nobody logs in here. The three values are the login's own, so the setup client compares both applications alike.
  session_duration           = "720h"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"

  lifecycle {
    precondition {
      condition     = alltrue([for address in concat(local.open_addresses, ["*-p-poplin.${local.domain}"]) : length(address) <= 63])
      error_message = "The domain is too long for the login: Access takes an application address of 63 characters at most, and both every open path of the dashboard, such as `<admin hostname>/setup`, and `*-p-poplin.<domain>` must fit."
    }
  }
}

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
  domain     = local.admin_host

  destinations = [
    { type = "public", uri = local.admin_host },
    { type = "public", uri = "*-p-poplin.${local.domain}" },
  ]

  policies = [{ id = cloudflare_zero_trust_access_policy.logins.id, precedence = 1 }]

  # A person logs in once in 30 days. The cookie is kept from scripts, and from requests other sites make.
  session_duration           = "720h"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"

  # The open paths exist before the whole hostname is guarded, so no moment of an apply leaves the API or the setup page behind the login.
  depends_on = [cloudflare_zero_trust_access_application.open_paths]
}
