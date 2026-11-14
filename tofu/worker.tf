# The Worker, uploaded from the built bundle, and the routes that send the install's hostnames to it.

resource "cloudflare_workers_script" "poplin" {
  account_id         = var.account_id
  script_name        = var.worker_name
  content_file       = var.worker_bundle_path
  content_sha256     = filesha256(var.worker_bundle_path)
  main_module        = "worker.js"
  compatibility_date = "2026-11-01"

  # FIRST_SETTINGS seeds the stored settings once: the Worker writes them only while no settings record exists, so a later apply never overwrites a change made on the dashboard.
  # ZONE is read as it is: the module owns the zone values and moves the records, routes, and rules with them.
  bindings = [
    {
      name        = "SITES"
      type        = "r2_bucket"
      bucket_name = cloudflare_r2_bucket.sites.name
    },
    {
      name = "ZONE"
      type = "json"
      json = jsonencode(local.zone_binding)
    },
    {
      name = "FIRST_SETTINGS"
      type = "json"
      json = jsonencode(local.first_settings)
    },
  ]
}

resource "cloudflare_workers_route" "worker" {
  for_each = local.worker_route_hosts

  zone_id = var.zone_id
  pattern = "${each.value}/*"
  script  = cloudflare_workers_script.poplin.script_name
}

# A route with no Worker: the wildcard route never catches an excluded hostname, so it keeps its own origin.
resource "cloudflare_workers_route" "excluded" {
  for_each = local.excluded_hosts

  zone_id = var.zone_id
  pattern = "${each.value}/*"

  lifecycle {
    precondition {
      condition     = each.value == local.domain || endswith(each.value, ".${local.domain}")
      error_message = "excluded_hostnames must hold hostnames of the zone: ${each.value} is not ${local.domain} or under it."
    }

    precondition {
      condition     = each.value != local.admin_host && each.value != local.pages_host
      error_message = "excluded_hostnames must not hold the admin hostname or the pages hostname: ${each.value} is the install's own."
    }

    precondition {
      condition     = !local.sites_under_pages || !endswith(each.value, ".${local.pages_host}")
      error_message = "excluded_hostnames must not hold a hostname under the pages hostname in a subdomain layout: ${each.value} sits where the sites sit."
    }
  }
}
