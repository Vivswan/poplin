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
