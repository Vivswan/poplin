// Every object of an install, with the address of each block of the OpenTofu module in `packages/cloudflare/tofu/` that declares it. Both ways of installing are held to this one list, so neither gains an object the other lacks unnoticed.

/**
 * The objects by who makes them where no module does. `repair` holds the ones the setup page checks and repairs, under the name their rows carry; `deploy` the ones a deploy of the Worker makes from `wrangler.jsonc`.
 *
 * An address is `<type>.<name>` for a resource and `data.<type>.<name>` for what the module only reads.
 */
export const INSTALL_PIECES = {
  repair: {
    Zone: ["data.cloudflare_zone.this"],
    "DNS record": ["data.cloudflare_dns_records.zone", "cloudflare_dns_record.poplin"],
    "Worker route": ["cloudflare_workers_route.worker"],
    "Access application": ["cloudflare_zero_trust_access_application.login"],
    "Access policy": ["cloudflare_zero_trust_access_policy.logins"],
    "Worker variable": ["cloudflare_workers_script.poplin"],
    "Redirect rule": ["cloudflare_ruleset.https"],
    "WAF rule": ["cloudflare_ruleset.guards"],
    "Rate rule": ["cloudflare_ruleset.rate"],
    "Bot settings": ["cloudflare_bot_management.zone"],
    "D1 database": ["cloudflare_d1_database.records"],
  },
  deploy: {
    Worker: ["cloudflare_workers_script.poplin"],
    "Sweep trigger": ["cloudflare_workers_cron_trigger.sweep"],
    "R2 bucket": ["cloudflare_r2_bucket.sites", "cloudflare_r2_managed_domain.sites"],
  },
} as const;
