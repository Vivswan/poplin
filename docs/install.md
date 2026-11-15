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

`example.com` stands for your own domain, on this page and in every command: type yours in its place.

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
| an agent, to publish by asking  | one that can run commands on your computer, such as Claude Code or Codex. A chat in a browser cannot     |

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

   **If the build fails**, no such page opens: Cloudflare shows the build's log, and its last lines say why.

   | The log                                                                 | Do                              |
   | ----------------------------------------------------------------------- | ------------------------------- |
   | has a line that starts with `poplin:` and holds `Nothing was deployed.` | what the rest of that line says |
   | names R2                                                                | finish the R2 row of step 1     |

   Then build again, with the browser steps of [Update the install](#update-the-install).
3. **Make a Cloudflare API token.** One link opens Cloudflare's form with the eight permissions poplin needs already chosen. It worked if the form shows eight rows already filled. A zone is your domain.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Finish the form, from top to bottom:

   | On the form       | Do                                                                                                                 |
   | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
   | the eight rows    | leave them. The three of [the optional part](#optional-block-junk-traffic-and-crawlers) can be added now, or later |
   | Account Resources | choose Include, then your account                                                                                  |
   | Zone Resources    | choose Include, then Specific zone, then your domain                                                               |
   | every other field | leave it as it is                                                                                                  |
   | the bottom        | press Continue to summary, then Create Token                                                                       |
   | the next page     | The token is shown once: paste it into a note now; you need it in the next step.                                   |

   Keep the note for as long as you may add a login or a permission: both ask for the token again. Without the note, Roll in the token's menu gives the token a new text.

   **If the form opens empty**, press Create Token, then Create Custom Token. For each row below, press Add more and choose in its three boxes:

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

   Then finish the form as in the table above.

4. **Finish on the setup page.** Open the Worker's address from step 2, the one ending in `workers.dev`: it shows the setup page. Fill its three boxes and press Repair (the first time it also makes everything).

   | Box                  | Put in                                                            |
   | -------------------- | ----------------------------------------------------------------- |
   | Domain               | your domain alone, with no `https://` and no `www`: `example.com` |
   | Your email           | an email whose inbox you can read: the first login                |
   | Cloudflare API token | the token of step 3                                               |

   The page lists what it made:

   ```text
   11 repaired
   4 optional, not set up. The install works without them. Each such row names the right that switches it on.
   The login is ready. Open your dashboard and log in: https://poplin.example.com

   DNS record           created                poplin.example.com
   Worker route         created                poplin.example.com/*
   Access application   created                poplin: poplin.example.com/login, *-p-poplin.example.com
   WAF rule             not set up: optional   ... add this right to the token and press Repair: Zone WAF: Edit
   ```

   The sample shows a few of the rows. `repaired` counts the rows Repair made. The page calls a permission a right. The token is used for that one request and kept nowhere. Repair is safe to repeat.

   With the eight permissions, Repair adds a DNS record, routes, and a login of poplin's own. It removes only a record that carries poplin's mark and a route that names poplin's Worker. A website or a mailbox on the domain stays as it is.

   Three optional permissions switch the optional rows on. One permission can hold more than one row, so the page counts more optional rows than three.

   **When the page shows something else**, the table has it. Fix the cause and press Repair again: what is already made stays.

   | The page says                                                            | Means                                                               | Do                                                                         |
   | ------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
   | `Token refused.`                                                         | Cloudflare does not take the token, or it does not reach the domain | paste the whole text of step 3; check its Account and Zone Resources       |
   | `The token shows no domain of that name.`                                | the domain is mistyped, not Active, or not the token's zone         | correct the Domain box, or edit the token's Zone Resources                 |
   | `The domain is no domain. Type it alone, such as example.com.`           | the box holds more than a domain, or one over 50 characters long    | type the domain alone; a longer domain cannot hold an install              |
   | `The email is no email address.`                                         | the email is mistyped                                               | type it again                                                              |
   | `No answer from the provider. Try again.`                                | Cloudflare gave no answer, or asked to wait                         | press Repair again in a minute                                             |
   | `Too many tries. Wait a minute.`                                         | the page takes five tries a minute                                  | wait a minute                                                              |
   | `The database takes no more today`, and when to try again                | the day's free allowance of the database is used up                 | try again after midnight UTC                                               |
   | `Open Zero Trust and pick a plan (Free works): that switches Access on.` | Zero Trust is not switched on: the first row of step 1              | open the link beside that line, pick the Free plan, then press Repair      |
   | a row `not set up: optional`                                             | nothing is wrong: an optional permission is not on the token        | nothing, or [the optional part](#optional-block-junk-traffic-and-crawlers) |
   | a row `failed` that ends with `Add this right to the token` and a name   | the token lacks the permission of that name                         | add it to the token: the table below                                       |
   | a row `failed` with other words, and rows `not run`                      | that one step failed, and the row says why                          | do what the row asks, if it asks; then press Repair again                  |

   `poplin setup` prints the same rows, and answers the first five lines of the table with a code each. The table Setting up an install of [Using](using.md#when-poplin-refuses) lists the codes.

   **Only when a row says failed for a permission**, add it to the token. Your tokens are listed on the page step 3's link opened (in Cloudflare: My Profile, then API Tokens). Each token's row ends in a menu.

   | You                         | Do, in the token's menu                                                              |
   | --------------------------- | ------------------------------------------------------------------------------------ |
   | still have the token's text | choose Edit, add the permission, save. Paste the same text and press Repair          |
   | no longer have it           | choose Roll. Roll makes a new token text. Add the permission, and paste the new text |

5. **Open your dashboard and log in.** Cloudflare's login asks for your email and sends a code to its inbox. A new address can take a few minutes to answer: until then the browser says it cannot find the site; wait a few minutes and reload.

   No code arrives when the email differs from the one in step 4: go back to the setup page, type the right email with the token, and press Repair.

   ```text
   https://poplin.example.com
   ```

   After the code, the dashboard opens on its Sites tab, which says `No sites yet. An agent or the command below publishes the first.`

   This first login closes the setup page for good. Step 6 is for the computer that publishes.

6. **Log a computer in, and check.** Take the LTS installer of Node.js from nodejs.org and run it. Then open a terminal, the window where you type commands:

   ```text
   Mac:      press Command and Space, type Terminal, press Enter
   Windows:  press the Windows key, type PowerShell, press Enter
   ```

   Type each line and press Enter, with your own domain in place of `example.com`. The two lines are the same on a Mac and on Windows. The first time, it asks whether it may download poplin: answer `y`.

   ```sh
   npx poplin login --server https://poplin.example.com
   npx poplin doctor
   ```

   The first line prints a short code and opens your dashboard on the page Allow this computer?, which shows a code too. Only when the two are the same, tick the box and press Allow.

   Every check `poplin doctor` prints starts with `ok`, and its last line says `nothing was changed`:

   ```text
   ok  install   https://poplin.example.com answers
   ok  version   install 0.1.0, this poplin 0.1.0
   ok  login     admin token 3f9a1c07b2d84e65, saved on this machine, expires 2026-12-15
   ok  settings  19 settings read
   ok  sites     0 sites
   ok  trash     0 sites
   nothing was changed
   ```

Your install is ready, and it publishes two ways.

| Publish            | Do                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| by asking an agent | paste the line of [the README](../README.md#use-it-from-an-ai-agent) into Claude Code, Codex, or another agent that runs commands |
| by a command       | `npx poplin ./report`: see [Using](using.md)                                                                                      |

The agent asks for the address of your install. Give it your dashboard's, `https://poplin.example.com`, not the one ending in `workers.dev`.

The agent then asks before it logs in, and before it adds poplin's tools to its own configuration as an MCP server, which is how an agent gets tools. A chat in a browser cannot run commands, so it cannot publish.

## Optional: block junk traffic and crawlers

The install works without this part. Three more permissions on the token let Cloudflare stop unwanted requests before they reach the Worker. Add any of them, on any day.

| First box | Second box      | Third box | With it, Cloudflare                                                           | Without it                                                                                  |
| --------- | --------------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Zone      | Zone WAF        | Edit      | stops verified bots, scanner paths, pages of other domains, and floods        | they reach the Worker. It refuses pages of other domains while `outside_pages` is `blocked` |
| Zone      | Single Redirect | Edit      | sends http to https                                                           | the Worker sends the same redirect                                                          |
| Zone      | Bot Management  | Edit      | blocks AI crawlers on the whole domain, as the Domain tab's `block_bots` says | poplin switches no such block on                                                            |

| Step | Where                              | Do                                                                          |
| ---- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1    | Cloudflare, My Profile, API Tokens | in the token's menu choose Edit, or Roll when you no longer have its text   |
| 2    | the token's form                   | for each row above, press Add more and choose in its three boxes; then save |
| 3    | the dashboard, Domain              | paste the token and press Repair                                            |

A row that said `not set up: optional` now says what Repair did, such as `created`. The Domain tab's three settings, `outside_pages`, `search_engines_allowed`, and `block_bots`, save without these permissions. What Cloudflare does for each starts once you press Repair, in step 3 of this table.

## Add a login

A second person needs two steps, because Cloudflare's login page keeps its own list.

| Step | Where                   | Do                                           |
| ---- | ----------------------- | -------------------------------------------- |
| 1    | the dashboard, Settings | add the email to `logins`, and save          |
| 2    | the dashboard, Domain   | paste a token as in step 3, and press Repair |

A new login works after step 2, not before. Removing another person's login needs step 1 alone: that person is out of the dashboard at once, and out of private sites within a minute. Your own email cannot be the one you remove.

## The Domain tab

After the first login, the Domain tab does what the setup page did. Check lists every piece and changes nothing. Repair makes them match again.

## Change a setting

```sh
npx poplin config
npx poplin config trash_days 30
```

The dashboard's Settings tab changes the same settings.

## What the install is made of

| In your Cloudflare account | Does                                                           | Made by           |
| -------------------------- | -------------------------------------------------------------- | ----------------- |
| one Worker                 | serves every site, the dashboard, the login, and the API       | step 2            |
| one R2 bucket              | holds every site's files                                       | step 2            |
| one D1 database            | holds the list of sites, the logins, and the settings          | step 2            |
| an Access application      | the login screen in front of the dashboard and private sites   | step 4            |
| DNS records and routes     | send your sites' addresses, and the dashboard's, to the Worker | step 4            |
| rules on the domain        | slow down and stop unwanted traffic before the Worker          | the optional part |

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

In PowerShell on Windows the first line is this one, and the second is the same:

```powershell
$env:POPLIN_SETUP_TOKEN = "paste the token here"
```

## Update the install

An update is one more build. Run in Cloudflare's build, poplin's deploy fetches a release of poplin from GitHub and deploys that, under the name, the bucket, and the database your copy's `wrangler.jsonc` names. Your copy on GitHub stays as it is, and nothing updates on its own.

```text
in the build's log:   poplin: deploying 0.3.1 (was asked for latest)
```

**In the browser.** Cloudflare's documentation gives these steps for building again:

| Step | In Cloudflare's dashboard                                              |
| ---- | ---------------------------------------------------------------------- |
| 1    | open your Worker                                                       |
| 2    | select Deployments, then View build history at the bottom of the page  |
| 3    | select the ellipses next to the newest build, then select Retry build  |

When it deploys a release, poplin's deploy prints the line above, with the version. When it cannot find or fetch the release it deploys nothing, and prints one line that starts with `poplin:`, holds `Nothing was deployed`, and says what to do.

**With one command.** `poplin update` has the install start that build itself, at a Deploy Hook you make once. Cloudflare's documentation gives these steps for making one:

| Step | In Cloudflare's dashboard                                  |
| ---- | ---------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker               |
| 2    | go to Settings, then Builds, then Deploy Hooks             |
| 3    | enter a name and select the branch to build: `main`        |
| 4    | select Create and copy the generated URL                   |

```sh
export POPLIN_UPDATE_ADDRESS="paste the URL here"
npx poplin update --save-address
npx poplin update
```

In PowerShell on Windows the first line is this one, and the other two are the same:

```powershell
$env:POPLIN_UPDATE_ADDRESS = "paste the URL here"
```

| Line                           | Does                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `poplin update --save-address` | saves the URL in the install, once; the install never shows it again                         |
| `poplin update`                | starts the build when a newer version is out; `--anyway` starts it whatever the version      |
| `poplin update --check`        | says which version is out and whether a URL is saved; starts nothing                         |
| `poplin update --forget-address` | removes the saved URL                                                                      |

The install takes a URL of this form alone, and only an admin's login saves it or starts an update. One update a minute can be started. [Security](security.md#who-holds-which-credential) says what the URL can do.

```text
https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<DEPLOY_HOOK_ID>
```

**Choose the version.** The build reads one build variable, `POPLIN_VERSION`. Cloudflare's documentation puts build variables in your Worker's Settings, under Build, in Build variables and secrets.

| `POPLIN_VERSION`     | The build deploys                                                            |
| -------------------- | ---------------------------------------------------------------------------- |
| not set, or `latest` | the newest release. With no release published, the files of your copy        |
| a version: `0.2.0`   | that release. This keeps an install on one version, or takes it back to one  |
| `this`               | the files of your copy as they are, for changing poplin in your own copy     |

A release refuses a database whose schema a newer release changed. The install then answers `This install's database is newer than its code: update poplin.` until a release that knows that schema is deployed again.

**From a terminal.** An install made from a terminal updates with the two commands below. They deploy the files in that folder: nothing is fetched, and `POPLIN_VERSION` is not read. What step 4 gave the Worker stays.

```sh
git -C poplin pull
bun run --cwd poplin deploy
```

## What is capped or protected

Cloudflare has no hard spending cap on R2, the storage for your sites' files. Each month 10 GB stored, 1 million write operations, and 10 million read operations are free, and Cloudflare bills what goes past them. The limits and alerts below are the protection, and none of them is a cap on what Cloudflare bills.

| What is capped or protected | Where it is declared | What happens at the cap |
| --- | --- | --- |
| the bytes of every kept version, the trash, and every upload under way: 9 GB | the setting `max_total_size` | a publish that would pass it is refused with `too_large`. The files of an upload that was given up are not counted while they wait for the sweep |
| the files that the publishes begun in one UTC day declare: 25000 | the setting `max_files_per_day` | a publish that would pass it is refused with `too_large`. A file sent a second time is one more write operation, and is not counted |
| the day's requests for sites, counted from a sample: about 100000 | the setting `requests_per_day` | a site's visitors get status 429 until the next UTC day |
| one site's and one visitor's requests in a minute | the settings `site_requests_per_minute` and `visitor_requests_per_minute` | status 429, with the seconds to wait |
| the versions a publish leaves a site, and the days in the trash | the settings `versions_kept` and `trash_days` | a publish that goes live deletes the versions past the count, and the Worker's sweep deletes a site past its days in the trash, each with its files |
| one address at one Cloudflare location: 300 requests in 10 seconds | Repair: Rate rule, skipped on a Free plan domain with other hostnames and where the plan has no room for it. Module: `cloudflare_ruleset.rate`, unless `rate_rule` is `off` | Cloudflare blocks the address for 10 seconds, before the Worker runs |
| verified bots, methods other than GET and HEAD, and scanner paths, on site addresses. Search engines pass while `search_engines_allowed` is on | Repair: WAF rule, skipped where the plan has no room for it. Module: `cloudflare_ruleset.guards`, unless `guard_rules` is false | Cloudflare blocks the request before the Worker runs |
| AI crawlers: while `block_bots` is `auto`, on a domain with no other hostnames; while it is `on`, on any domain | Repair: Bot settings. Module: `cloudflare_bot_management.zone` | Cloudflare blocks them on the whole domain |
| plain http | Repair: Redirect rule. Module: `cloudflare_ruleset.https`. The Worker does the same | the request is sent to https |
| the dashboard and private sites | Repair: Access application and Access policy. Module: `cloudflare_zero_trust_access_application.login` and its policy | Cloudflare's login, for the `logins` alone |
| the bucket's public address | Module: `cloudflare_r2_managed_domain.sites`. A bucket step 2 made has none | it stays off: files are read through the Worker alone |
| uploads in parts that nobody finished | Module: `cloudflare_r2_bucket_lifecycle.sites`, after one day. A bucket step 2 made has Cloudflare's own rule, after seven days | Cloudflare removes them. No bucket rule deletes a stored file: a site's live files and its dropped ones sit under the same folder of random letters, so only the Worker removes dropped files |
| every file of an install that only tests | Module alone: `test_install_file_days`, not set by default | the bucket deletes every file at that age, a live site's included |
| R2's bytes stored, write operations, and read operations | Module alone, and off until `usage_alert_percents` is set: `cloudflare_notification_policy.usage`. It needs the Notifications permission, and applies on accounts where Cloudflare offers usage alerts | Cloudflare emails the logins at each share of the free allowance the list names. Nothing is stopped |
| the domain's plan | Module alone: `paid_plan_allowed` | an apply on a plan other than Free stops with an error, unless the input is true |

Repair is the button on the setup page and the Domain tab. Module is the OpenTofu module below. The rows marked Module alone, and the one-day rule, exist only on an install the module made: the setup page's token holds no permission for R2 or for notifications.

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
