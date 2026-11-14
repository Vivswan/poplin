output "bucket_name" {
  description = "The R2 bucket that holds every site's files."
  value       = cloudflare_r2_bucket.sites.name
}

output "database_id" {
  description = "The D1 database that holds every record."
  value       = cloudflare_d1_database.records.id
}

output "worker_name" {
  description = "The Worker script."
  value       = cloudflare_workers_script.poplin.script_name
}

output "admin_url" {
  description = "The address of the dashboard."
  value       = "https://${local.admin_host}"
}

output "site_url_pattern" {
  description = "The address of a site, with `<name>` and `<id>` standing for the site's name and id."
  value       = "https://<name>--<id>${var.suffix}.${local.domain}"
}

output "guard_rule_expressions" {
  description = "The expression of each guard rule by its ref, for a zone that keeps custom rules of its own and adds these to them."
  value       = { for rule in local.guard_rules : rule.ref => rule.expression }
}

output "zone_bots" {
  description = "What the module did with the zone's bot switches: `set`, or the reason it left them alone."
  value       = coalesce(local.zone_bots_skipped, "set")
}
