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

Steps 1 to 6 happen in your browser, and after them your dashboard works. Step 7 logs in the computer you publish from. The first time, allow an hour to an hour and a half.

Three words the steps use: a **Worker** is the program Cloudflare runs for you, a **token** is a long password that lets a program change your Cloudflare account, and a **terminal** is the window where you type commands (Terminal on a Mac, PowerShell on Windows).

## What you need

| Thing                              | Why                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| a Cloudflare account               | the Free plan is enough                                                          |
| a domain on that account           | poplin gives every site an address under it. It is on the account when Cloudflare's home page lists it as Active |
| an email inbox you can read        | Cloudflare's login sends its code there in step 6                                |
| a payment method on the account    | Cloudflare asks for one in step 1, also for what is free. Poplin's use fits the free allowances |
| a GitHub account                   | free. Step 2 puts a copy of poplin's code there, which Cloudflare builds from    |
| Node.js, on your own computer      | for step 7 alone. It comes from nodejs.org                                       |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare then asks you to change the domain's nameservers where you bought it, and the domain turns Active up to a day later.

## The steps

1. **Switch on two things in Cloudflare.** Open the address below and log in. No program can do this for you. Each asks for a payment method, and each shows a price of 0: Zero Trust's Free plan costs nothing, and R2 bills nothing under 10 GB, which poplin stays under.

   ```text
   https://dash.cloudflare.com
   ```

   | Open                          | Do                                         | It is                                  |
   | ----------------------------- | ------------------------------------------ | -------------------------------------- |
   | Zero Trust, in the left menu  | pick a team name and the Free plan         | the login in front of your dashboard   |
   | R2, under Storage             | add R2 to the account                      | the storage for your sites' files      |

   The team name can be any word: it only names your login page. Each is done when Cloudflare shows its overview instead of the sign-up.

2. **Make the Worker.** Click the button and sign in to GitHub when asked. Where the form asks for an account, pick your own, for the code and for Cloudflare. Change nothing else, and press the button at its end. The names it suggests must stay: the project `poplin`, the bucket `poplin-sites`, the database `poplin`.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vivswan/poplin)

   Cloudflare copies poplin to your GitHub account, makes the storage and the database, and builds the Worker. After a few minutes it shows the Worker's own address. Note it. Where this page says `your-name`, yours has a word of your account:

   ```text
   https://poplin.your-name.workers.dev
   ```

   Opened now, that address shows a short page that names missing values. That is expected: step 3 gives them.

3. **Tell the Worker three things.** In Cloudflare, open Workers & Pages, then `poplin`, then Settings, then Variables and Secrets. Add three variables, then press Deploy. For each, choose the Type, type the Name, and type the Value exactly as shown, brackets and quotes included, with your own domain, email, and id in place of the examples.

   | Type | Name             | Value                              | Yours in place of                                                   |
   | ---- | ---------------- | ---------------------------------- | ------------------------------------------------------------------- |
   | JSON | `ZONE`           | `{"domain": "example.com"}`        | `example.com`: your domain alone, with no `https://` and no `www`   |
   | JSON | `FIRST_SETTINGS` | `{"logins": "you@example.com"}`    | `you@example.com`: any email whose inbox you can read, in lowercase. It is the first login |
   | Text | `ACCOUNT_ID`     | `0123456789abcdef0123456789abcdef` | the whole value: your Account ID, 32 letters and digits, shown on the right of the Workers & Pages overview. Copy it; do not retype it |

   Until all three are right, the Worker's address answers the short page, which names what is still missing or wrong.

4. **Make a Cloudflare API token.** One link opens Cloudflare's form with eight of the eleven rows already chosen. The setup page of step 5 shows the same link.

   [Open the token form with the rows chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Then finish the form, from top to bottom:

   | On the form       | Do                                                                        |
   | ----------------- | ------------------------------------------------------------------------- |
   | Permissions       | add the three rows the table below marks "by hand": each is three choices |
   | Account Resources | choose Include, then your account                                         |
   | Zone Resources    | choose Include, then Specific zone, then your domain                      |
   | the bottom        | press Continue to summary, then Create Token                              |
   | the next page     | copy the token now: Cloudflare shows it once                              |

   | Under   | Right                                                        | For                                         | In the link |
   | ------- | ------------------------------------------------------------ | ------------------------------------------- | ----------- |
   | Account | Workers Scripts: Edit                                        | giving the Worker its login                 | yes         |
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

   **If the form opens empty**, press Create Token, choose Create Custom Token, and add all eleven rows. Cloudflare calls a row a permission.

5. **Finish on the setup page.** Open the Worker's address from step 2 with `/setup` after it. Paste the token and press Repair. Repair makes whatever is missing, which the first time is everything.

   ```text
   https://poplin.your-name.workers.dev/setup
   ```

   The page lists what it made, and ends with the address of your dashboard:

   ```text
   13 repaired
   The login is ready. Open your dashboard and log in: https://poplin.example.com

   DNS record           created   poplin.example.com
   Worker route         created   poplin.example.com/*
   Access application   created   poplin: poplin.example.com/login, *-p-poplin.example.com
   ```

   The token is used for that one request and kept nowhere. **A row that says failed** names what Cloudflare refused: most often a row missing from the token. Repair is safe to repeat.

   | You                         | Do, on Cloudflare's API Tokens page                                                                           |
   | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
   | still have the token's text | open the token's menu, choose Edit, add the row, save. The same text works: paste it and press Repair again   |
   | no longer have it           | open the token's menu and choose Roll: Cloudflare shows a new text once. Add the row, then paste the new text |

6. **Open your dashboard and log in.** Cloudflare's login asks for your email and sends a code to its inbox. A new address can take a few minutes to answer. No code means the email differs from the one in step 3.

   ```text
   https://poplin.example.com
   ```

   This first login closes the setup page for good. Your dashboard works now: step 7 is for the computer that publishes.

7. **Log a computer in, and check.** Open a terminal on the computer you publish from. It needs Node.js, which comes from nodejs.org. Type each line and press Enter. The first opens your dashboard, where you allow the computer.

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
| 2    | the dashboard, Domain         | paste a token as in step 4, and press Repair    |

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
| an Access application      | the login screen in front of the dashboard and private sites   | step 5       |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | step 5       |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | step 5       |

## From a terminal instead

Two steps have a terminal form. Both need the same Cloudflare account, and the rest of the page stays as it is.

**Step 2, without a GitHub account.** It needs git and bun. The last command opens Cloudflare in your browser to ask for access, then deploys.

```sh
git clone https://github.com/Vivswan/poplin
bun install --cwd poplin
bun run --cwd poplin deploy
```

**Step 5, without the page.** `poplin setup` sends the token to the same setup, and prints the same rows. It makes no Worker, and it works only until the first login.

```sh
export POPLIN_SETUP_TOKEN="paste the token here"
npx poplin setup --server https://poplin.your-name.workers.dev
```

## Update the install

Cloudflare builds and deploys again whenever the copy of poplin in your GitHub account changes. Taking a newer poplin means bringing that copy up to date, which takes a terminal with git:

```sh
git clone https://github.com/your-name/poplin
git -C poplin pull https://github.com/Vivswan/poplin main
git -C poplin push
```

An install made from a terminal updates with `git -C poplin pull` and `bun run --cwd poplin deploy`. The variables of step 3 and the login of step 5 stay.

## With OpenTofu

People who run OpenTofu can make the whole install with poplin's module instead of steps 2 to 5. [The module's page](../packages/cloudflare/tofu/README.md) lists every input and every object.

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
