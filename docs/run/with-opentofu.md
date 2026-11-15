---
title: With OpenTofu
order: 50
---

# With OpenTofu

poplin's OpenTofu module makes the whole install instead of [steps 2 to 4](../start/by-hand.md#the-steps). [The module's page](../../packages/cloudflare/tofu/README.md) lists every input and every object.

```hcl
module "poplin" {
  source = "github.com/Vivswan/poplin//packages/cloudflare/tofu?ref=<release tag>"

  account_id         = "0123456789abcdef0123456789abcdef"
  zone_id            = "fedcba9876543210fedcba9876543210"
  logins             = ["owner@example.com"]
  worker_bundle_path = "./worker.js"
  access_team_domain = "team.cloudflareaccess.com"
}
```

**To update it**, an install the module made takes a new bundle and an apply. [The module's page](../../packages/cloudflare/tofu/README.md#update-the-install) has the steps.
