# The Worker, uploaded from the built bundle, and the routes that send the install's hostnames to it.

resource "cloudflare_workers_script" "poplin" {
  account_id         = var.account_id
  script_name        = var.worker_name
  content_file       = var.worker_bundle_path
  content_sha256     = filesha256(var.worker_bundle_path)
  main_module        = "worker.js"
  compatibility_date = "2026-11-01"

  # FIRST_SETTINGS seeds the stored settings once: the Worker writes them only while no settings record exists, so a later apply never overwrites a change made on the dashboard.
  # ZONE is read as it is: the module owns the zone values and moves the records, routes, and rule with them.
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

  lifecycle {
    precondition {
      condition     = length(local.zone_wildcards_unproxied) == 0
      error_message = "The zone's own record ${local.wildcard_host} is not proxied, so every site hostname would resolve to its origin and never reach the Worker. Switch its proxy on, or remove it."
    }

    precondition {
      condition     = length(local.shadowed_names) == 0
      error_message = "The zone has records of its own under names the routes would take: ${join(", ", local.shadowed_names)}. Choose another suffix or admin_hostname, or rename them."
    }

    precondition {
      condition     = length(data.cloudflare_dns_records.zone.result) < local.record_limit
      error_message = "The zone has ${local.record_limit} records or more, so the module cannot see every name the routes would take."
    }
  }
}
