---
title: By hand
order: 20
---

# Install poplin by hand

The six steps to an install, done by hand; [your agent can lead them](with-an-agent.md) instead, and [When a step fails](when-a-step-fails.md) has each failure.

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
| a payment method on the account | step 1 asks for one. [What can cost money](../run/limits-and-cost.md#what-can-cost-money) says when it is charged      |
| a GitHub account                | free. Step 2 puts a copy of poplin's code there                                                          |
| Node.js, on your own computer   | for step 6 alone                                                                                         |
| an agent, to publish by asking  | one that can run commands on your computer, such as Claude Code or Codex. A chat in a browser cannot     |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare shows two nameservers; paste them in the Nameservers setting at the shop where you bought the domain. The domain turns Active up to a day later.

## The steps

1. **Switch on two things in Cloudflare.** Open the address below and log in. Each asks for a payment method, and each shows a price of 0: Zero Trust's Free plan, and R2, which bills by use past its free allowance. [What can cost money](../run/limits-and-cost.md#what-can-cost-money) says what poplin does to stay inside it, and what it cannot do.

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

   **If the build fails**, [When a step fails](when-a-step-fails.md#step-2-the-build-fails) has the next step.

3. **Make a Cloudflare API token.** One link opens Cloudflare's form with the eight permissions poplin needs already chosen. It worked if the form shows eight rows already filled. A zone is your domain.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Finish the form, from top to bottom:

   | On the form       | Do                                                                                                                 |
   | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
   | the eight rows    | leave them. The three of [the optional part](../run/domain.md#optional-block-junk-traffic-and-crawlers) can be added now, or later |
   | Account Resources | choose Include, then your account                                                                                  |
   | Zone Resources    | choose Include, then Specific zone, then your domain                                                               |
   | every other field | leave it as it is                                                                                                  |
   | the bottom        | press Continue to summary, then Create Token                                                                       |
   | the next page     | The token is shown once: paste it into a note now; you need it in the next step.                                   |

   Keep the note for as long as you may add a login or a permission: both ask for the token again. Without the note, Roll in the token's menu gives the token a new text.

   **If the form opens empty**, [When a step fails](when-a-step-fails.md#step-3-the-form-opens-empty) has the rows to add by hand.

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

   **When the page shows something else**, [When a step fails](when-a-step-fails.md#step-4-the-page-shows-something-else) has each line and what to do.

5. **Open your dashboard and log in.** Cloudflare's login asks for your email and sends a code to its inbox. A new address can take a few minutes to answer: until then the browser says it cannot find the site; wait a few minutes and reload.

   **If no code arrives**, [When a step fails](when-a-step-fails.md#step-5-no-code-arrives) has the fix.

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
| by asking an agent | paste the line of [the README](../../README.md#use-it-from-an-ai-agent) into Claude Code, Codex, or another agent that runs commands |
| by a command       | `npx poplin ./report`: see [Publish](../use/publish.md)                                                                                      |
