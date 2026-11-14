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

Steps 1 to 5 happen in your browser, and after them your dashboard works. Step 6 logs in the computer you publish from. With the domain already active on Cloudflare, allow about an hour for the dashboard; twenty minutes more for step 6.

Two words the steps use: a **Worker** is the program Cloudflare runs for you, and a **token** is a long password that lets a program change your Cloudflare account.

## What you need

| Thing                           | Why                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| a Cloudflare account            | the Free plan is enough                                                                                  |
| a domain on that account        | every site gets an address under it. It is on the account when Cloudflare's home page lists it as Active |
| an email inbox you can read     | Cloudflare's login sends its code there in step 5                                                        |
| a payment method on the account | step 1 asks for one, and charges nothing                                                                 |
| a GitHub account                | free. Step 2 puts a copy of poplin's code there                                                          |
| Node.js, on your own computer   | for step 6 alone                                                                                         |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare shows two nameservers; paste them in the Nameservers setting at the shop where you bought the domain. The domain turns Active up to a day later.

## The steps

1. **Switch on two things in Cloudflare.** Open the address below and log in. Each asks for a payment method, and each shows a price of 0: Zero Trust's Free plan costs nothing, and R2 bills nothing under 10 GB, which poplin stays under.

   ```text
   https://dash.cloudflare.com
   ```

   | Open                                        | Do                                 | It is                                |
   | ------------------------------------------- | ---------------------------------- | ------------------------------------ |
   | Zero Trust, in the left menu                | pick a team name and the Free plan | the login in front of your dashboard |
   | Storage & databases, then R2, then Overview | finish the checkout it shows       | the storage for your sites' files    |

   The team name can be any word: it only names your login page. Each is done when Cloudflare shows its overview instead of the sign-up.

2. **Make the Worker.** Click the button and sign in to GitHub when asked.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vivswan/poplin)

   Where the form asks for an account, pick your own, for the code and for Cloudflare. Change nothing else: the names it suggests must stay, the project `poplin`, the bucket `poplin-sites`, the database `poplin`. Then press the last button of the form.

   Cloudflare copies poplin to your GitHub account and builds the Worker. After a few minutes a page opens with the Worker's own address at its top, the one ending in `workers.dev`. Note it. Where this page says `your-name`, yours has a word of your account:

   ```text
   https://poplin.your-name.workers.dev
   ```

3. **Make a Cloudflare API token.** One link opens Cloudflare's form with eight of the eleven permissions already chosen. It worked if the form shows eight rows already filled. A zone is your domain.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Add the other three by hand. For each, press Add more and choose in its three boxes:

   | First box | Second box      | Third box |
   | --------- | --------------- | --------- |
   | Zone      | Zone WAF        | Edit      |
   | Zone      | Single Redirect | Edit      |
   | Zone      | Bot Management  | Edit      |

   Then finish the form, from top to bottom:

   | On the form       | Do                                                                               |
   | ----------------- | -------------------------------------------------------------------------------- |
   | Account Resources | choose Include, then your account                                                |
   | Zone Resources    | choose Include, then Specific zone, then your domain                             |
   | the bottom        | press Continue to summary, then Create Token                                     |
   | the next page     | The token is shown once: paste it into a note now; you need it in the next step. |

   **If the form opens empty**, press Create Token, choose Create Custom Token, and add all eleven the same way:

   | First box | Second box                                            | Third box | For                                         |
   | --------- | ----------------------------------------------------- | --------- | ------------------------------------------- |
   | Account   | Workers Scripts                                       | Edit      | giving the Worker its values                |
   | Account   | D1                                                    | Edit      | the database                                |
   | Account   | Access: Apps and Policies                             | Edit      | the login                                   |
   | Account   | Access: Organizations, Identity Providers, and Groups | Read      | your team's name                            |
   | Zone      | Zone                                                  | Read      | finding your domain                         |
   | Zone      | DNS                                                   | Edit      | the addresses                               |
   | Zone      | Workers Routes                                        | Edit      | sending the addresses to the Worker         |
   | Zone      | Zone Settings                                         | Read      | seeing whether the domain redirects already |
   | Zone      | Zone WAF                                              | Edit      | the rules against unwanted traffic          |
   | Zone      | Single Redirect                                       | Edit      | sending http to https                       |
   | Zone      | Bot Management                                        | Edit      | blocking AI crawlers                        |

4. **Finish on the setup page.** Open the Worker's address from step 2: it shows the setup page. Fill its three boxes and press Repair (the first time it also makes everything).

   | Box                  | Put in                                                            |
   | -------------------- | ----------------------------------------------------------------- |
   | Domain               | your domain alone, with no `https://` and no `www`: `example.com` |
   | Your email           | an email whose inbox you can read: the first login                |
   | Cloudflare API token | the token of step 3                                               |

   The page lists what it made:

   ```text
   16 repaired
   The login is ready. Open your dashboard and log in: https://poplin.example.com

   DNS record           created   poplin.example.com
   Worker route         created   poplin.example.com/*
   Access application   created   poplin: poplin.example.com/login, *-p-poplin.example.com
   ```

   The token is used for that one request and kept nowhere. **A row that says failed** says why. For a permission the token lacks it ends with `Add this right to the token` and the permission's name. Repair is safe to repeat.

   Your tokens are listed on the page step 3's link opened (in Cloudflare: My Profile, then API Tokens).

   | You                         | Do, in the token's menu                                                              |
   | --------------------------- | ------------------------------------------------------------------------------------ |
   | still have the token's text | choose Edit, add the permission, save. Paste the same text and press Repair          |
   | no longer have it           | choose Roll. Roll makes a new token text. Add the permission, and paste the new text |

5. **Open your dashboard and log in.** Cloudflare's login asks for your email and sends a code to its inbox. A new address can take a few minutes to answer: until then the browser says it cannot find the site; wait a few minutes and reload. No code arrives when the email differs from the one in step 4: go back to the setup page, type the right email with the token, and press Repair.

   ```text
   https://poplin.example.com
   ```

   This first login closes the setup page for good. Step 6 is for the computer that publishes.

6. **Log a computer in, and check.** Take the LTS installer of Node.js from nodejs.org and run it. Then open a terminal, the window where you type commands:

   ```text
   Mac:      press Command and Space, type Terminal, press Enter
   Windows:  press the Windows key, type PowerShell, press Enter
   ```

   Type each line and press Enter. The first time, it asks whether it may download poplin: answer `y`. The first line opens your dashboard, where you allow the computer.

   ```sh
   npx poplin login --server https://poplin.example.com
   npx poplin doctor
   ```

   Every check `poplin doctor` prints starts with `ok`. Its last line says `nothing was changed`.

Your install is ready. Paste the line from [the README](../README.md#use-it-from-an-ai-agent) into your agent (an AI assistant that can run commands for you), or see [Using](using.md).

## Add a login

A second person needs two steps, because Cloudflare's login page keeps its own list.

| Step | Where                   | Do                                           |
| ---- | ----------------------- | -------------------------------------------- |
| 1    | the dashboard, Settings | add the email to `logins`, and save          |
| 2    | the dashboard, Domain   | paste a token as in step 3, and press Repair |

Removing a login needs step 1 alone: the person is out of the dashboard at once, and out of private sites within a minute.

## The Domain tab

After the first login, the Domain tab does what the setup page did. Check lists every object and changes nothing. Repair makes them match again.

## Change a setting

```sh
npx poplin config
npx poplin config trash_days 30
```

The dashboard's Settings tab changes the same settings.

## What the install is made of

| In your Cloudflare account | Does                                                           | Made by |
| -------------------------- | -------------------------------------------------------------- | ------- |
| one Worker                 | serves every site, the dashboard, the login, and the API       | step 2  |
| one R2 bucket              | holds every site's files                                       | step 2  |
| one D1 database            | holds the list of sites, the logins, and the settings          | step 2  |
| an Access application      | the login screen in front of the dashboard and private sites   | step 4  |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | step 4  |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | step 4  |

## From a terminal instead

Two steps have a terminal form.

**Step 2, without a GitHub account.** It needs git and bun. The last command opens Cloudflare in your browser to ask for access, then deploys.

```sh
git clone https://github.com/Vivswan/poplin
bun install --cwd poplin
bun run --cwd poplin deploy
```

**Step 4, without the page.** `poplin setup` sends the same three values and prints the same rows. It works only until the first login.

```sh
export POPLIN_SETUP_TOKEN="paste the token here"
npx poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com
```

## Update the install

Cloudflare builds again whenever your copy of poplin on GitHub changes. Bring that copy up to date, from a terminal with git:

```sh
git clone https://github.com/your-name/poplin
git -C poplin pull https://github.com/Vivswan/poplin main
git -C poplin push
```

An install made from a terminal updates with `git -C poplin pull` and `bun run --cwd poplin deploy`. What step 4 gave the Worker stays.

## With OpenTofu

poplin's OpenTofu module makes the whole install instead of steps 2 to 4. [The module's page](../packages/cloudflare/tofu/README.md) lists every input and every object.

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
