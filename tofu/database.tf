# The one database that holds every site's record, the tokens, the settings, and the audit log. The Worker applies its own schema when it opens it.
# D1 keeps no mark on a database, so poplin's setup client finds it by this name.

resource "cloudflare_d1_database" "records" {
  account_id = var.account_id
  name       = "poplin"
}
