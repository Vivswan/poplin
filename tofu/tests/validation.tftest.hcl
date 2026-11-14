# Each invalid input is refused by its own rule. Without these a loosened pattern would let a bad name reach Cloudflare, or into a route pattern or a rule expression.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      name    = "example.com"
      account = { id = "0123456789abcdef0123456789abcdef", name = "example account" }
    }
  }

  mock_data "cloudflare_dns_records" {
    defaults = {
      result = []
    }
  }
}

variables {
  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "tests/fixtures/worker.bundle"
}

run "account_id_not_hexadecimal" {
  command = plan

  variables {
    account_id = "0123456789ABCDEF0123456789ABCDEF"
  }

  expect_failures = [var.account_id]
}

run "zone_id_too_short" {
  command = plan

  variables {
    zone_id = "fedcba98"
  }

  expect_failures = [var.zone_id]
}

run "admin_hostname_with_a_dot" {
  command = plan

  variables {
    admin_hostname = "admin.tools"
  }

  expect_failures = [var.admin_hostname]
}

run "suffix_with_a_quote" {
  command = plan

  variables {
    suffix = "-p\""
  }

  expect_failures = [var.suffix]
}

run "suffix_with_a_wildcard" {
  command = plan

  variables {
    suffix = "-*"
  }

  expect_failures = [var.suffix]
}

run "suffix_without_the_leading_dash" {
  command = plan

  variables {
    suffix = "page"
  }

  expect_failures = [var.suffix]
}

run "suffix_ending_in_a_dash" {
  command = plan

  variables {
    suffix = "-page-"
  }

  expect_failures = [var.suffix]
}

run "suffix_of_one_dash" {
  command = plan

  variables {
    suffix = "-"
  }

  expect_failures = [var.suffix]
}

run "suffix_with_two_dashes_together" {
  command = plan

  variables {
    suffix = "-a--b"
  }

  expect_failures = [var.suffix]
}

run "suffix_with_a_dot" {
  command = plan

  variables {
    suffix = "-page.x"
  }

  expect_failures = [var.suffix]
}

run "suffix_too_long" {
  command = plan

  variables {
    suffix = "-published"
  }

  expect_failures = [var.suffix]
}

run "suffix_empty" {
  command = plan

  variables {
    suffix = ""
  }

  expect_failures = [var.suffix]
}

run "admin_hostname_ending_in_the_suffix" {
  command = plan

  variables {
    admin_hostname = "admin-page"
  }

  expect_failures = [var.admin_hostname]
}

run "logins_empty" {
  command = plan

  variables {
    logins = []
  }

  expect_failures = [var.logins]
}

run "login_not_an_address" {
  command = plan

  variables {
    logins = ["owner"]
  }

  expect_failures = [var.logins]
}

run "login_with_a_capital" {
  command = plan

  variables {
    logins = ["Owner@example.com"]
  }

  expect_failures = [var.logins]
}

run "login_listed_twice" {
  command = plan

  variables {
    logins = ["owner@example.com", "owner@example.com"]
  }

  expect_failures = [var.logins]
}

run "worker_bundle_path_missing" {
  command = plan

  variables {
    worker_bundle_path = "tests/fixtures/absent.bundle"
  }

  expect_failures = [var.worker_bundle_path]
}

run "worker_name_with_an_underscore" {
  command = plan

  variables {
    worker_name = "poplin_worker"
  }

  expect_failures = [var.worker_name]
}

run "bucket_name_too_short" {
  command = plan

  variables {
    bucket_name = "ab"
  }

  expect_failures = [var.bucket_name]
}

run "zone_of_another_account" {
  command = plan

  variables {
    account_id = "00000000000000000000000000000000"
  }

  expect_failures = [data.cloudflare_zone.this]
}

run "default_expires_without_a_unit" {
  command = plan

  variables {
    default_expires = "7"
  }

  expect_failures = [var.default_expires]
}

run "versions_kept_zero" {
  command = plan

  variables {
    versions_kept = 0
  }

  expect_failures = [var.versions_kept]
}

run "cache_html_without_a_unit" {
  command = plan

  variables {
    cache_html = "60"
  }

  expect_failures = [var.cache_html]
}

run "max_total_size_unknown_unit" {
  command = plan

  variables {
    max_total_size = "9TB"
  }

  expect_failures = [var.max_total_size]
}

run "max_sites_zero" {
  command = plan

  variables {
    max_sites = 0
  }

  expect_failures = [var.max_sites]
}

run "site_share_of_day_over_one_hundred" {
  command = plan

  variables {
    site_share_of_day = 101
  }

  expect_failures = [var.site_share_of_day]
}

run "outside_pages_unknown_word" {
  command = plan

  variables {
    outside_pages = "off"
  }

  expect_failures = [var.outside_pages]
}

run "zone_bots_unknown_word" {
  command = plan

  variables {
    zone_bots = "always"
  }

  expect_failures = [var.zone_bots]
}
