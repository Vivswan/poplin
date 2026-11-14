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
      name = "DB"
      type = "d1"
      id   = cloudflare_d1_database.records.id
    },
    {
      # The Worker's one-minute counters weigh each request against this limit, so it is the one the Worker's code is written for.
      name         = "MINUTE_LIMITS"
      type         = "ratelimit"
      namespace_id = "1001"
      simple       = { limit = 1000000, period = 60 }
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
    {
      # The Access application in front of the login: the Worker checks a login's token against this team and this audience tag.
      name = "ACCESS"
      type = "json"
      json = jsonencode({ team_domain = var.access_team_domain, audience = cloudflare_zero_trust_access_application.login.aud })
    },
  ]
}

# The sweep: the Worker's scheduled run moves expired sites to the trash and removes old trash and abandoned uploads.
resource "cloudflare_workers_cron_trigger" "sweep" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.poplin.script_name
  schedules   = [{ cron = "*/15 * * * *" }]
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
      error_message = "The zone has records of its own under names the routes would take: ${join(", ", local.shadowed_names)}. Rename them."
    }

    precondition {
      condition     = length(data.cloudflare_dns_records.zone.result) < local.record_limit
      error_message = "The zone has ${local.record_limit} records or more, so the module cannot see every name the routes would take."
    }
  }
}
