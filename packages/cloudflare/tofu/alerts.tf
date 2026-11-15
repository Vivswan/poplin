# The emails Cloudflare sends as R2 uses up its free monthly allowance. R2 has no spending cap, and nothing here stops a write: an alert only tells the logins.
# The budget alert, at 1 US dollar of usage charges, is not here: the provider's resource takes neither its alert type nor its filter. The dashboard's Repair makes it.

locals {
  # What R2 gives free in a month: the bytes stored, the operations that write or list (class A), and the ones that read (class B).
  free_allowance = {
    r2_storage            = { name = "bytes stored", amount = 10000000000 }
    r2_class_a_operations = { name = "write operations", amount = 1000000 }
    r2_class_b_operations = { name = "read operations", amount = 10000000 }
  }

  # One alert per product and share.
  usage_alerts = merge([
    for product, free in local.free_allowance : {
      for percent in var.usage_alert_percents :
      "${product}_${percent}" => { product = product, name = free.name, percent = percent, limit = floor(free.amount * percent / 100) }
    }
  ]...)
}

resource "cloudflare_notification_policy" "usage" {
  for_each = local.usage_alerts

  account_id  = var.account_id
  name        = "poplin: R2 ${each.value.name} at ${each.value.percent}% of the free allowance"
  description = "The account's R2 ${each.value.name} this month passed ${each.value.limit}, which is ${each.value.percent}% of what Cloudflare gives free."
  alert_type  = "billing_usage_alert"
  enabled     = true

  filters = {
    product = [each.value.product]
    limit   = [tostring(each.value.limit)]
  }

  mechanisms = {
    email = [for email in sort(var.logins) : { id = email }]
  }
}
