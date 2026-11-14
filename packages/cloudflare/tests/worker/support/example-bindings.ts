// The values a real install sets on its Worker, written by hand for the tests: the repository's wrangler.jsonc holds none, so a deployed copy starts with none.

/** The account every test's Worker runs in, in the form of a Cloudflare account id. */
export const EXAMPLE_ACCOUNT = "0123456789abcdef0123456789abcdef";

/** The variables of an install that is set up: the three a person sets, and `ACCESS` as setup writes it. */
export const EXAMPLE_BINDINGS = {
  ACCOUNT_ID: EXAMPLE_ACCOUNT,
  ZONE: { domain: "example.com" },
  ACCESS: { team_domain: "team.cloudflareaccess.com", audience: "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2" },
  FIRST_SETTINGS: {
    default_expires: "never",
    default_search_engines: "off",
    versions_kept: "3",
    trash_days: "7",
    logins: "owner@example.com",
    dashboard_title: "poplin.example.com",
    outside_pages: "blocked",
    search_engines_allowed: "off",
    block_bots: "auto",
    max_total_size: "9GB",
    max_site_size: "200MB",
    max_sites: "none",
    max_files_per_publish: "5000",
    max_files_per_day: "25000",
    requests_per_day: "100000",
    site_share_of_day: "25%",
    site_requests_per_minute: "6000",
    visitor_requests_per_minute: "600",
  },
} as const;
