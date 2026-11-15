# The one bucket that holds every site's files.

resource "cloudflare_r2_bucket" "sites" {
  account_id = var.account_id
  name       = var.bucket_name
}

# Public access stays off: the bucket is read through the Worker's binding alone.
resource "cloudflare_r2_managed_domain" "sites" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.sites.name
  enabled     = false
}

# What the bucket removes by itself. Every site keeps its files under a folder of random letters, live or in the trash alike, so no rule here can tell a file a site still serves from one it dropped: the Worker's sweep removes those.
resource "cloudflare_r2_bucket_lifecycle" "sites" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.sites.name

  rules = concat(
    [{
      id         = "poplin-unfinished-uploads"
      enabled    = true
      conditions = { prefix = "" }

      # The Worker stores each file in one request and never starts an upload in parts, so one left unfinished is nobody's: it goes after a day.
      abort_multipart_uploads_transition = { condition = { type = "Age", max_age = 86400 } }
    }],
    var.test_install_file_days == null ? [] : [{
      id         = "poplin-test-install-files"
      enabled    = true
      conditions = { prefix = "" }

      # Every file goes at this age, a live site's included: for an install that only tests.
      delete_objects_transition = { condition = { type = "Age", max_age = var.test_install_file_days * 86400 } }
    }],
  )
}
