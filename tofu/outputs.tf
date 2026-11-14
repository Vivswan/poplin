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
  description = "The address of a site, with `<name>` standing for the site's name."
  value       = local.sites_under_pages ? "https://<name>.${local.pages_host}" : "https://${var.prefix}<name>.${local.domain}"
}
