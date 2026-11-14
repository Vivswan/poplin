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

Steps 1 to 5 happen in your browser, and after them your dashboard works. Step 6 logs in the computer you publish from. With the domain already active on Cloudflare, allow about an hour the first time.

Three words the steps use: a **Worker** is the program Cloudflare runs for you, a **token** is a long password that lets a program change your Cloudflare account, and a **terminal** is the window where you type commands (Terminal on a Mac, PowerShell on Windows).

## What you need

| Thing                              | Why                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| a Cloudflare account               | the Free plan is enough                                                          |
| a domain on that account           | poplin gives every site an address under it. It is on the account when Cloudflare's home page lists it as Active |
| an email inbox you can read        | Cloudflare's login sends its code there in step 5                                |
| a payment method on the account    | Cloudflare asks for one in step 1, also for what is free. Poplin's use fits the free allowances |
| a GitHub account                   | free. Step 2 puts a copy of poplin's code there, which Cloudflare builds from    |
| Node.js, on your own computer      | for step 6 alone. It comes from nodejs.org                                       |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare shows two names; paste them at the shop where you bought the domain. The domain turns Active up to a day later.

## The steps

1. **Switch on two things in Cloudflare.** Open the address below and log in. No program can do this for you. Each asks for a payment method, and each shows a price of 0: Zero Trust's Free plan costs nothing, and R2 bills nothing under 10 GB, which poplin stays under.

   ```text
   https://dash.cloudflare.com
   ```

   | Open                                          | Do                                    | It is                                  |
   | --------------------------------------------- | ------------------------------------- | -------------------------------------- |
   | Zero Trust, in the left menu                  | pick a team name and the Free plan    | the login in front of your dashboard   |
   | Storage & databases, then R2, then Overview   | finish the checkout it shows          | the storage for your sites' files      |

   The team name can be any word: it only names your login page. Each is done when Cloudflare shows its overview instead of the sign-up.

2. **Make the Worker.** Click the button and sign in to GitHub when asked. Where the form asks for an account, pick your own, for the code and for Cloudflare.

   Change nothing else, and press the button at its end. The names it suggests must stay: the project `poplin`, the bucket `poplin-sites`, the database `poplin`.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vivswan/poplin)

   Cloudflare copies poplin to your GitHub account, makes the storage and the database, and builds the Worker. After a few minutes it shows the Worker's own address. Note it. Where this page says `your-name`, yours has a word of your account:

   ```text
   https://poplin.your-name.workers.dev
   ```

3. **Make a Cloudflare API token.** One link opens Cloudflare's form with eight of the eleven permissions already chosen.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Add the other three by hand. For each, press Add more and choose in its three boxes:

   | First box | Second box      | Third box |
   | --------- | --------------- | --------- |
   | Zone      | Zone WAF        | Edit      |
   | Zone      | Single Redirect | Edit      |
   | Zone      | Bot Management  | Edit      |

   Then finish the form, from top to bottom:

   | On the form       | Do                                                     |
   | ----------------- | ------------------------------------------------------ |
   | Account Resources | choose Include, then your account                      |
   | Zone Resources    | choose Include, then Specific zone, then your domain   |
   | the bottom        | press Continue to summary, then Create Token           |
   | the next page     | copy the token, and keep it for the next step          |

   **If the form opens empty**, press Create Token, choose Create Custom Token, and add all eleven:

   | Under   | Permission                                                   | For                                         | In the link |
   | ------- | ------------------------------------------------------------ | ------------------------------------------- | ----------- |
   | Account | Workers Scripts: Edit                                        | giving the Worker its values                | yes         |
   | Account | D1: Edit                                                     | the database                                | yes         |
   | Account | Access: Apps and Policies: Edit                              | the login                                   | yes         |
   | Account | Access: Organizations, Identity Providers, and Groups: Read  | your team's name                            | yes         |
   | Zone    | Zone: Read                                                   | finding your domain                         | yes         |
   | Zone    | DNS: Edit                                                    | the addresses                               | yes         |
   | Zone    | Workers Routes: Edit                                         | sending the addresses to the Worker         | yes         |
   | Zone    | Zone Settings: Read                                          | seeing whether the domain redirects already | yes         |
   | Zone    | Zone WAF: Edit                                               | the rules against unwanted traffic          | by hand     |
   | Zone    | Single Redirect: Edit                                        | sending http to https                       | by hand     |
   | Zone    | Bot Management: Edit                                         | blocking AI crawlers                        | by hand     |

4. **Finish on the setup page.** Open the Worker's address from step 2: it shows the setup page. Fill its three boxes and press Repair.

   | Box                  | Put in                                                              |
   | -------------------- | ------------------------------------------------------------------- |
   | Domain               | your domain alone, with no `https://` and no `www`: `example.com`   |
   | Your email           | any email whose inbox you can read. It is the first login           |
   | Cloudflare API token | the token of step 3                                                 |

   The page lists what it made, and ends with the address of your dashboard:

   ```text
   16 repaired
   The login is ready. Open your dashboard and log in: https://poplin.example.com

   DNS record           created   poplin.example.com
   Worker route         created   poplin.example.com/*
   Access application   created   poplin: poplin.example.com/login, *-p-poplin.example.com
   ```

   The token is used for that one request and kept nowhere. **A row that says failed** says why. For a permission the token lacks it ends with `Add this right to the token` and the permission's name. Repair is safe to repeat.

   | You                         | Do, on Cloudflare's API Tokens page                                                                                  |
   | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
   | still have the token's text | open the token's menu, choose Edit, add the permission, save. The same text works: paste it and press Repair again   |
   | no longer have it           | open the token's menu and choose Roll: Cloudflare shows a new text once. Add the permission, then paste the new text |

5. **Open your dashboard and log in.** Cloudflare's login asks for your email and sends a code to its inbox. A new address can take a few minutes to answer. No code means the email differs from the one in step 4.

   ```text
   https://poplin.example.com
   ```

   This first login closes the setup page for good. Your dashboard works now: step 6 is for the computer that publishes.

6. **Log a computer in, and check.** Take the LTS installer of Node.js from nodejs.org, run it, and reopen the terminal. Type each line and press Enter, and answer `y` when asked. The first opens your dashboard, where you allow the computer.

   ```sh
   npx poplin login --server https://poplin.example.com
   npx poplin doctor
   ```

   Every check `poplin doctor` prints starts with `ok`. Its last line says `nothing was changed`.

Your install is ready. Paste the line from [the README](../README.md#use-it-from-an-ai-agent) into your agent, or see [Using](using.md).

## Add a login

A second person needs two steps, because Cloudflare's login page keeps its own list.

| Step | Where                         | Do                                              |
| ---- | ----------------------------- | ----------------------------------------------- |
| 1    | the dashboard, Settings       | add the email to `logins`, and save             |
| 2    | the dashboard, Domain         | paste a token as in step 3, and press Repair    |

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

| In your Cloudflare account | Does                                                           | Made by      |
| -------------------------- | -------------------------------------------------------------- | ------------ |
| one Worker                 | serves every site, the dashboard, the login, and the API       | step 2       |
| one R2 bucket              | holds every site's files                                       | step 2       |
| one D1 database            | holds the list of sites, the logins, and the settings          | step 2       |
| an Access application      | the login screen in front of the dashboard and private sites   | step 4       |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | step 4       |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | step 4       |

## From a terminal instead

Two steps have a terminal form. Both need the same Cloudflare account, and the rest of the page stays as it is.

**Step 2, without a GitHub account.** It needs git and bun. The last command opens Cloudflare in your browser to ask for access, then deploys.

```sh
git clone https://github.com/Vivswan/poplin
bun install --cwd poplin
bun run --cwd poplin deploy
```

**Step 4, without the page.** `poplin setup` sends the three values to the same setup, and prints the same rows. It makes no Worker, and it works only until the first login.

```sh
export POPLIN_SETUP_TOKEN="paste the token here"
npx poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com
```

## Update the install

Cloudflare builds and deploys again whenever the copy of poplin in your GitHub account changes. Taking a newer poplin means bringing that copy up to date, which takes a terminal with git:

```sh
git clone https://github.com/your-name/poplin
git -C poplin pull https://github.com/Vivswan/poplin main
git -C poplin push
```

An install made from a terminal updates with `git -C poplin pull` and `bun run --cwd poplin deploy`. The values and the login that step 4 gave the Worker stay.

## With OpenTofu

People who run OpenTofu can make the whole install with poplin's module instead of steps 2 to 4. [The module's page](../packages/cloudflare/tofu/README.md) lists every input and every object.

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
