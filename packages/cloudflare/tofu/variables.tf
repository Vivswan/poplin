# The Cloudflare account and zone.

variable "account_id" {
  description = "The Cloudflare account that holds the Worker, the bucket, the database, and the login."
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

variable "public_word" {
  description = "The word every public site's address ends in, as in `docs-page.example.com`. It is chosen once: another word later breaks every public address."
  type        = string
  default     = "page"

  validation {
    condition     = can(regex("^[a-z]{2,9}$", var.public_word))
    error_message = "public_word must be 2 to 9 lowercase letters, such as page."
  }
}

variable "https_redirect" {
  description = "Whether the module creates the rule that sends a request over http to https before the Worker runs. It is the zone's whole redirect ruleset: false on a zone with redirect rules of its own."
  type        = bool
  default     = true
}

variable "rate_rule" {
  description = "What the rate rule counts: `zone` (every request of the zone, the one form the Free plan takes), `hostnames` (the install's hostnames alone, on a paid plan), or `off` (no rule)."
  type        = string
  default     = "zone"

  validation {
    condition     = contains(["zone", "hostnames", "off"], var.rate_rule)
    error_message = "rate_rule must be one of: zone, hostnames, off."
  }
}

variable "guard_rules" {
  description = "Whether the module creates the custom rules that stop outside pages and verified bots before the Worker runs. They are the zone's whole custom ruleset: false on a zone with custom rules of its own."
  type        = bool
  default     = true
}

variable "outside_pages" {
  description = "Whether a page of another domain may frame a site or load its files: `blocked` or `allowed`. A page under the same domain reaches the Worker either way."
  type        = string
  default     = "blocked"

  validation {
    condition     = contains(["blocked", "allowed"], var.outside_pages)
    error_message = "outside_pages must be one of: blocked, allowed."
  }
}

variable "search_engines_allowed" {
  description = "Whether the crawlers of search engines pass the bots rule. Every other bot Cloudflare has verified is stopped either way."
  type        = bool
  default     = false
}

variable "block_bots" {
  description = "The zone's bot switches, which cover every hostname of the zone: `auto` (block AI bots, on a zone with no hostnames of its own), `on` (block AI bots and switch Bot Fight Mode on, on any zone of the Free plan), or `off` (leave them alone)."
  type        = string
  default     = "auto"

  validation {
    condition     = contains(["auto", "on", "off"], var.block_bots)
    error_message = "block_bots must be one of: auto, on, off."
  }
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

variable "access_team_domain" {
  description = "The account's Zero Trust team domain, such as `team.cloudflareaccess.com`: Access signs every login's token under it, and the Worker fetches the team's keys from it."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.cloudflareaccess\\.com$", var.access_team_domain))
    error_message = "access_team_domain must be the team domain alone, such as team.cloudflareaccess.com: lowercase, with no scheme and no path."
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
  description = "The name of the R2 bucket that holds every site's files."
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
    condition     = var.default_expires == "never" || can(regex("^[1-9][0-9]{0,8}[smhd]$", var.default_expires))
    error_message = "default_expires must be `never` or a whole number of at least 1 and at most 9 digits followed by s, m, h, or d, such as 7d."
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
    condition     = var.versions_kept >= 1 && var.versions_kept <= 9007199254740991 && floor(var.versions_kept) == var.versions_kept
    error_message = "versions_kept must be a whole number from 1 to 9007199254740991."
  }
}

variable "trash_days" {
  description = "Days a deleted site waits in the trash."
  type        = number
  default     = 7

  validation {
    condition     = var.trash_days >= 1 && var.trash_days <= 9007199254740991 && floor(var.trash_days) == var.trash_days
    error_message = "trash_days must be a whole number from 1 to 9007199254740991."
  }
}

variable "dashboard_title" {
  description = "The title of the dashboard. Null means the dashboard's hostname."
  type        = string
  default     = null

  validation {
    condition     = var.dashboard_title == null || try(length(var.dashboard_title) > 0, false)
    error_message = "dashboard_title must be null or a text of at least one character."
  }
}

variable "max_total_size" {
  description = "The size limit of all sites together, such as `9GB`."
  type        = string
  default     = "9GB"

  validation {
    condition     = can(regex("^[1-9][0-9]{0,5}(B|KB|MB|GB)$", var.max_total_size))
    error_message = "max_total_size must be a whole number of at least 1 and at most 6 digits followed by B, KB, MB, or GB, such as 9GB."
  }
}

variable "max_site_size" {
  description = "The size limit of one site, such as `200MB`."
  type        = string
  default     = "200MB"

  validation {
    condition     = can(regex("^[1-9][0-9]{0,5}(B|KB|MB|GB)$", var.max_site_size))
    error_message = "max_site_size must be a whole number of at least 1 and at most 6 digits followed by B, KB, MB, or GB, such as 200MB."
  }
}

variable "max_sites" {
  description = "The limit on how many sites exist. Null means none."
  type        = number
  default     = null

  validation {
    condition     = var.max_sites == null || try(var.max_sites >= 1 && var.max_sites <= 9007199254740991 && floor(var.max_sites) == var.max_sites, false)
    error_message = "max_sites must be null or a whole number from 1 to 9007199254740991."
  }
}

variable "max_files_per_publish" {
  description = "The limit on the files one publish, import, or copy holds."
  type        = number
  default     = 5000

  validation {
    condition     = var.max_files_per_publish >= 1 && var.max_files_per_publish <= 10000 && floor(var.max_files_per_publish) == var.max_files_per_publish
    error_message = "max_files_per_publish must be a whole number from 1 to 10000."
  }
}

variable "max_files_per_day" {
  description = "The limit on the files all publishes, imports, and copies begun in one UTC day hold together."
  type        = number
  default     = 25000

  validation {
    condition     = var.max_files_per_day >= 1 && var.max_files_per_day <= 9007199254740991 && floor(var.max_files_per_day) == var.max_files_per_day
    error_message = "max_files_per_day must be a whole number from 1 to 9007199254740991."
  }
}

variable "requests_per_day" {
  description = "The limit on the day's requests, all sites together."
  type        = number
  default     = 100000

  validation {
    condition     = var.requests_per_day >= 1 && var.requests_per_day <= 9007199254740991 && floor(var.requests_per_day) == var.requests_per_day
    error_message = "requests_per_day must be a whole number from 1 to 9007199254740991."
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
  default     = 6000

  validation {
    condition     = var.site_requests_per_minute >= 1 && var.site_requests_per_minute <= 9007199254740991 && floor(var.site_requests_per_minute) == var.site_requests_per_minute
    error_message = "site_requests_per_minute must be a whole number from 1 to 9007199254740991."
  }
}

variable "visitor_requests_per_minute" {
  description = "The limit on one visitor's requests per minute."
  type        = number
  default     = 600

  validation {
    condition     = var.visitor_requests_per_minute >= 1 && var.visitor_requests_per_minute <= 9007199254740991 && floor(var.visitor_requests_per_minute) == var.visitor_requests_per_minute
    error_message = "visitor_requests_per_minute must be a whole number from 1 to 9007199254740991."
  }
}
