---
title: Install
order: 30
---

# Install poplin

An install is your own copy of poplin, in your own Cloudflare account. You make it once. After that, your agent and your computers publish to it.

```text
before:  a Cloudflare account, and a domain on it (example.com)

after:   https://poplin.example.com                       your dashboard
         report--k3f9x2ab71qz-p-poplin.example.com        every site you publish
```

**This takes a terminal.** The steps below use git, bun, OpenTofu, and a Cloudflare API token. Someone who has set up a server before does them in about half an hour.

If that is not you, ask such a person to do steps 3 to 6 for you. Steps 1 and 2 are yours either way: they happen in your browser.

## What you need

| Thing                                | Where it comes from                                                |
| ------------------------------------ | ------------------------------------------------------------------ |
| a Cloudflare account                 | the Free plan is enough                                            |
| a domain on that account             | poplin gives every site an address under it                        |
| git, bun, and OpenTofu 1.13 or newer | on the computer that runs steps 3 to 6                             |

## The steps

1. **Switch on Access, in your browser.** Open Zero Trust in the Cloudflare dashboard and pick a plan. Free works. Access is the login in front of your dashboard, and no command can switch it on.

   ```text
   https://one.dash.cloudflare.com
   ```

   Cloudflare asks for a team name. Note the team domain it makes: `team.cloudflareaccess.com`, with your team name in front.

2. **Switch on R2, in your browser.** Open R2 in the Cloudflare dashboard and add it to the account. R2 is the storage that holds your sites' files. Cloudflare asks for a payment card here; the free allowance costs nothing.

3. **Make a Cloudflare API token.** In the Cloudflare dashboard, under your profile, make a custom token with the permissions in [the module's list](../packages/cloudflare/tofu/README.md#cloudflare-token-permissions). Then hand it to the terminal:

   ```sh
   export CLOUDFLARE_API_TOKEN="paste the token here"
   ```

4. **Get poplin and build the Worker.**

   ```sh
   git clone https://github.com/Vivswan/poplin
   bun install --cwd poplin
   bun run --cwd poplin/packages/cloudflare build
   ```

   The build writes one file, `poplin/packages/cloudflare/dist/worker.js`. Nothing is deployed yet.

5. **Describe your install.** Beside the `poplin` folder, write a file named `main.tf`:

   ```hcl
   terraform {
     required_providers {
       cloudflare = {
         source  = "cloudflare/cloudflare"
         version = "~> 5.28"
       }
     }
   }

   provider "cloudflare" {}

   module "poplin" {
     source = "./poplin/packages/cloudflare/tofu"

     account_id         = "0123456789abcdef0123456789abcdef"
     zone_id            = "fedcba9876543210fedcba9876543210"
     logins             = ["owner@example.com"]
     worker_bundle_path = "./poplin/packages/cloudflare/dist/worker.js"
     access_team_domain = "team.cloudflareaccess.com"
   }

   output "admin_url" {
     value = module.poplin.admin_url
   }
   ```

   | Value                | Put in                                                              |
   | -------------------- | ------------------------------------------------------------------- |
   | `account_id`         | the Account ID on your domain's Overview page in Cloudflare         |
   | `zone_id`            | the Zone ID on the same page                                        |
   | `logins`             | the emails that may log in: yours first, in lowercase               |
   | `access_team_domain` | the team domain from step 1                                         |

   **A domain that already has addresses of its own**, such as `www.example.com`, needs one more line in the `module` block: `rate_rule = "off"`.

6. **Make the install.**

   ```sh
   tofu init
   tofu apply
   ```

   OpenTofu lists what it will make and asks for a `yes`. It ends with the address of your dashboard:

   ```text
   admin_url = "https://poplin.example.com"
   ```

7. **Open your dashboard and log in.** Cloudflare's login asks for one of the emails in `logins` and sends it a code.

   ```text
   https://poplin.example.com
   ```

8. **Log a computer in, and check.**

   ```sh
   npx poplin login --server https://poplin.example.com
   npx poplin doctor
   ```

   Every check `poplin doctor` prints starts with `ok`. Its last line says `nothing was changed`.

Your install is ready. Paste the line from [the README](../README.md#use-it-from-an-ai-agent) into your agent, or see [Using](using.md).

## What the install is made of

| In your Cloudflare account | Does                                                       |
| -------------------------- | ---------------------------------------------------------- |
| one Worker                 | serves every site, the dashboard, the login, and the API   |
| one R2 bucket              | holds every site's files                                   |
| one D1 database            | holds the list of sites, the logins, and the settings      |
| an Access application      | the login screen in front of the dashboard                 |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker |
| rules on the domain        | slow down and stop unwanted traffic before the Worker      |

[The module's page](../packages/cloudflare/tofu/README.md) lists every object, every input, and what the module leaves alone.

## Change a setting

```sh
npx poplin config
npx poplin config trash_days 30
```

The dashboard's Settings tab changes the same settings. The values in `main.tf` are only the first ones: once the install runs, applying again changes no stored setting.

**A new login goes in two places:** the `logins` setting, and `logins` in `main.tf` followed by `tofu apply`, so that Cloudflare's login screen lets that email in.

## Update the install

```sh
git -C poplin pull
bun install --cwd poplin
bun run --cwd poplin/packages/cloudflare build
tofu apply
```
