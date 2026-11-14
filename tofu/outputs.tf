output "bucket_name" {
  description = "The R2 bucket that holds every site and every record."
  value       = cloudflare_r2_bucket.sites.name
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
