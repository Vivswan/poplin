# The Cloudflare account and zone.

variable "account_id" {
  description = "The Cloudflare account that holds the Worker, the bucket, and the login."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be 32 lowercase hexadecimal characters."
  }
}

variable "zone_id" {
  description = "The Cloudflare zone of the domain the install lives under."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be 32 lowercase hexadecimal characters."
  }
}

# Where the sites and the dashboard sit in the zone.

variable "layout" {
  description = "Where sites sit: `domain` (page-report.example.com), `subdomain-per-site` or `subdomain-wildcard` (report.pages.example.com)."
  type        = string
  default     = "domain"

  validation {
    condition     = contains(["domain", "subdomain-per-site", "subdomain-wildcard"], var.layout)
    error_message = "layout must be one of: domain, subdomain-per-site, subdomain-wildcard."
  }
}

variable "admin_hostname" {
  description = "The label of the dashboard's hostname under the domain: `admin` gives admin.example.com."
  type        = string
  default     = "admin"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.admin_hostname))
    error_message = "admin_hostname must be one hostname label: 1 to 63 lowercase letters, digits, or dashes, with no dash first or last."
  }

  validation {
    condition     = var.admin_hostname != var.pages_hostname
    error_message = "admin_hostname must differ from pages_hostname."
  }
}

variable "pages_hostname" {
  description = "The label of the gallery's hostname under the domain: `pages` gives pages.example.com. Empty means the bare domain."
  type        = string
  default     = "pages"

  validation {
    condition     = var.pages_hostname == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.pages_hostname))
    error_message = "pages_hostname must be empty or one hostname label: 1 to 63 lowercase letters, digits, or dashes, with no dash first or last."
  }

  validation {
    condition     = var.layout == "domain" || var.pages_hostname != ""
    error_message = "pages_hostname must not be empty under a subdomain layout: the sites sit under it."
  }
}

variable "prefix" {
  description = "The label in front of every site name under the `domain` layout. Empty on a domain that holds nothing but sites; then no host rule is created."
  type        = string
  default     = "page-"

  validation {
    condition     = var.prefix == "" || can(regex("^[a-z0-9][a-z0-9-]{0,8}$", var.prefix))
    error_message = "prefix must be empty or 1 to 9 lowercase letters, digits, or dashes, starting with a letter or a digit."
  }
}

variable "excluded_hostnames" {
  description = "The zone's other exact hostnames, such as www.example.com. Each stays out of the Worker and out of the host rule."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for host in var.excluded_hostnames : length(host) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", host))])
    error_message = "excluded_hostnames must hold exact hostnames in lowercase, such as www.example.com: no wildcard, no scheme, no path."
  }

  validation {
    condition     = length(distinct(var.excluded_hostnames)) == length(var.excluded_hostnames)
    error_message = "excluded_hostnames must list each hostname once."
  }

  validation {
    condition     = length(var.excluded_hostnames) <= 200
    error_message = "excluded_hostnames must hold at most 200 hostnames: the list is written into one rule expression."
  }
}

variable "host_rule" {
  description = "Whether to create the host rule. Set false when the zone has custom rules of its own: the module's ruleset owns that phase for the zone."
  type        = bool
  default     = true
}

variable "rate_rule" {
  description = "Whether to create the rate rule. Set false when the zone's one Free-plan rate rule is already used."
  type        = bool
  default     = true
}

# The Worker and the bucket.

variable "worker_bundle_path" {
  description = "The path to the built Worker bundle, one JavaScript module file. The module never builds it."
  type        = string

  validation {
    condition     = fileexists(var.worker_bundle_path)
    error_message = "worker_bundle_path must name an existing file: the built Worker bundle."
  }
}

variable "worker_name" {
  description = "The name of the Worker script."
  type        = string
  default     = "poplin"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.worker_name))
    error_message = "worker_name must be 1 to 63 lowercase letters, digits, or dashes, with no dash first or last."
  }
}

variable "bucket_name" {
  description = "The name of the R2 bucket that holds every site and every record."
  type        = string
  default     = "poplin-sites"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be 3 to 63 lowercase letters, digits, or dashes, with no dash first or last."
  }
}

# The first settings. The dashboard is the authority once the install runs.

variable "logins" {
  description = "The emails that may log in. The login allows exactly these."
  type        = list(string)

  validation {
    condition     = length(var.logins) > 0
    error_message = "logins must hold at least one email."
  }

  validation {
    condition = alltrue([
      for email in var.logins :
      length(email) <= 254 && length(split("@", email)[0]) <= 64 && can(regex("^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", email))
    ])
    error_message = "logins must hold plain email addresses in lowercase, with no spaces, such as owner@example.com."
  }

  validation {
    condition     = length(distinct(var.logins)) == length(var.logins)
    error_message = "logins must list each email once."
  }
}

variable "default_expires" {
  description = "The expiry a new site gets: `never`, or a time span such as `7d`."
  type        = string
  default     = "never"

  validation {
    condition     = var.default_expires == "never" || can(regex("^[1-9][0-9]*[smhd]$", var.default_expires))
    error_message = "default_expires must be `never` or a whole number of at least 1 followed by s, m, h, or d, such as 7d."
  }
}

variable "default_search_engines" {
  description = "Whether a new public site is open to search engines."
  type        = bool
  default     = false
}

variable "versions_kept" {
  description = "Versions kept per site, the live one included."
  type        = number
  default     = 3

  validation {
    condition     = var.versions_kept >= 1 && floor(var.versions_kept) == var.versions_kept
    error_message = "versions_kept must be a whole number of at least 1."
  }
}

variable "trash_days" {
  description = "Days a deleted site waits in the trash."
  type        = number
  default     = 7

  validation {
    condition     = var.trash_days >= 1 && floor(var.trash_days) == var.trash_days
    error_message = "trash_days must be a whole number of at least 1."
  }
}

variable "dashboard_title" {
  description = "The title of the dashboard. Null means the admin hostname."
  type        = string
  default     = null

  validation {
    condition     = var.dashboard_title == null || try(length(var.dashboard_title) > 0, false)
    error_message = "dashboard_title must be null or a text of at least one character."
  }
}

variable "gallery" {
  description = "Whether the public page listing the public sites is on. On also creates the pages hostname's record under the `domain` layout."
  type        = bool
  default     = false
}

variable "cache_html" {
  description = "How long HTML is cached, such as `60s`. `0s` switches the cache off."
  type        = string
  default     = "60s"

  validation {
    condition     = can(regex("^(0|[1-9][0-9]*)[smhd]$", var.cache_html))
    error_message = "cache_html must be a whole number followed by s, m, h, or d, such as 60s."
  }
}

variable "max_total_size" {
  description = "The size limit of all sites together, such as `9GB`."
  type        = string
  default     = "9GB"

  validation {
    condition     = can(regex("^[1-9][0-9]*(B|KB|MB|GB)$", var.max_total_size))
    error_message = "max_total_size must be a whole number of at least 1 followed by B, KB, MB, or GB, such as 9GB."
  }
}

variable "max_site_size" {
  description = "The size limit of one site, such as `200MB`."
  type        = string
  default     = "200MB"

  validation {
    condition     = can(regex("^[1-9][0-9]*(B|KB|MB|GB)$", var.max_site_size))
    error_message = "max_site_size must be a whole number of at least 1 followed by B, KB, MB, or GB, such as 200MB."
  }
}

variable "max_sites" {
  description = "The limit on how many sites exist. Null means none."
  type        = number
  default     = null

  validation {
    condition     = var.max_sites == null || try(var.max_sites >= 1 && floor(var.max_sites) == var.max_sites, false)
    error_message = "max_sites must be null or a whole number of at least 1."
  }
}

variable "requests_per_day" {
  description = "The limit on the day's requests, all sites together."
  type        = number
  default     = 100000

  validation {
    condition     = var.requests_per_day >= 1 && floor(var.requests_per_day) == var.requests_per_day
    error_message = "requests_per_day must be a whole number of at least 1."
  }
}

variable "site_share_of_day" {
  description = "The percentage of the day's requests one site may use."
  type        = number
  default     = 25

  validation {
    condition     = var.site_share_of_day >= 1 && var.site_share_of_day <= 100 && floor(var.site_share_of_day) == var.site_share_of_day
    error_message = "site_share_of_day must be a whole number from 1 to 100."
  }
}

variable "site_requests_per_minute" {
  description = "The limit on one site's requests per minute."
  type        = number
  default     = 60

  validation {
    condition     = var.site_requests_per_minute >= 1 && floor(var.site_requests_per_minute) == var.site_requests_per_minute
    error_message = "site_requests_per_minute must be a whole number of at least 1."
  }
}

variable "visitor_requests_per_minute" {
  description = "The limit on one visitor's requests per minute."
  type        = number
  default     = 30

  validation {
    condition     = var.visitor_requests_per_minute >= 1 && floor(var.visitor_requests_per_minute) == var.visitor_requests_per_minute
    error_message = "visitor_requests_per_minute must be a whole number of at least 1."
  }
}
