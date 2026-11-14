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
  description = "The address of a site, with `<name>` and `<id>` standing for the site's name and id, and `<letter>` for `p` on a private site and `u` on every other."
  value       = "https://<name>--<id>-<letter>${local.marker}.${local.domain}"
}

output "public_url_pattern" {
  description = "The address of a public site under its public name, with `<public name>` standing for that name."
  value       = "https://<public name>-${var.public_word}.${local.domain}"
}

output "guard_rule_expressions" {
  description = "The expression of each guard rule by its ref, for a zone that keeps custom rules of its own and adds these to them."
  value       = { for rule in local.guard_rules : rule.ref => rule.expression }
}

output "block_bots" {
  description = "What the module did with the zone's bot switches: `set`, or the reason it left them alone."
  value       = coalesce(local.block_bots_skipped, "set")
}
