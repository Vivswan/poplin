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
  access_team_domain = "team.cloudflareaccess.com"
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

# The Worker reads a whole number only up to 9007199254740991, so one more would leave FIRST_SETTINGS unread.
run "requests_per_day_too_large_to_count" {
  command = plan

  variables {
    requests_per_day = 9007199254740992
  }

  expect_failures = [var.requests_per_day]
}

run "public_word_with_a_dash" {
  command = plan

  variables {
    public_word = "my-page"
  }

  expect_failures = [var.public_word]
}

run "public_word_of_one_letter" {
  command = plan

  variables {
    public_word = "p"
  }

  expect_failures = [var.public_word]
}

run "public_word_with_a_capital" {
  command = plan

  variables {
    public_word = "Page"
  }

  expect_failures = [var.public_word]
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

run "max_sites_too_large_to_count" {
  command = plan

  variables {
    max_sites = 9007199254740992
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

run "block_bots_unknown_word" {
  command = plan

  variables {
    block_bots = "always"
  }

  expect_failures = [var.block_bots]
}

run "access_team_domain_with_a_scheme" {
  command = plan

  variables {
    access_team_domain = "https://team.cloudflareaccess.com"
  }

  expect_failures = [var.access_team_domain]
}

run "access_team_domain_on_another_host" {
  command = plan

  variables {
    access_team_domain = "team.example.com"
  }

  expect_failures = [var.access_team_domain]
}
