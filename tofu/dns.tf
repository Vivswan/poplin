# The proxied records of the install. Each points at the discard address: the Worker answers, no origin exists.

resource "cloudflare_dns_record" "poplin" {
  for_each = local.records

  zone_id = var.zone_id
  name    = each.key
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
  comment = each.value
}
