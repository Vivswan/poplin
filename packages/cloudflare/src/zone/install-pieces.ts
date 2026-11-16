// Every object of an install, with the address of each block of the OpenTofu module in `packages/cloudflare/tofu/` that declares it. Both ways of installing are held to this one list, so neither gains an object the other lacks unnoticed.

/** Every object by who makes it: `repair` and `deploy` beside the module, the repair alone, the module alone, or the repair of an install without a domain, which the module never makes. An address is `<type>.<name>`, or `data.<type>.<name>` for a read. */
export const INSTALL_PIECES = {
  repair: {
    Zone: ["data.cloudflare_zone.this"],
    "DNS record": ["data.cloudflare_dns_records.zone", "cloudflare_dns_record.poplin"],
    "Worker route": ["cloudflare_workers_route.worker"],
    "Access application": ["cloudflare_zero_trust_access_application.login"],
    "Access policy": ["cloudflare_zero_trust_access_policy.logins"],
    "Access open paths": ["cloudflare_zero_trust_access_application.open_paths", "cloudflare_zero_trust_access_policy.open_paths"],
    "Worker variable": ["cloudflare_workers_script.poplin"],
    "Redirect rule": ["cloudflare_ruleset.https"],
    "WAF rule": ["cloudflare_ruleset.guards"],
    "Rate rule": ["cloudflare_ruleset.rate"],
    "Bot settings": ["cloudflare_bot_management.zone"],
    "D1 database": ["cloudflare_d1_database.records"],
    Workflow: ["cloudflare_workflow.jobs"],
  },
  deploy: {
    Worker: ["cloudflare_workers_script.poplin"],
    "Sweep trigger": ["cloudflare_workers_cron_trigger.sweep"],
    "R2 bucket": ["cloudflare_r2_bucket.sites", "cloudflare_r2_managed_domain.sites"],
  },
  repairAlone: {
    "Budget alert": [],
    Key: [],
    "Upload key": [],
  },
  moduleAlone: {
    "Bucket cleanup": ["cloudflare_r2_bucket_lifecycle.sites"],
    "Usage alert": ["cloudflare_notification_policy.usage"],
  },
  noDomain: {
    Forwarder: [],
    "Access application": [],
    "Access policy": [],
    "Access open paths": [],
    "Worker variable": [],
    "D1 database": [],
    Workflow: [],
    Key: [],
    "Upload key": [],
  },
} as const;
