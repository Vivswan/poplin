---
title: By hand
order: 20
---

# Install poplin by hand

The six steps to an install under a domain of your own, done by hand; [your agent can lead them](with-an-agent.md) instead, and [When a step fails](../fix/an-install-step-fails.md) has each failure. With no domain, start at [Without a domain](without-a-domain.md).

An install is your own copy of poplin, in your own Cloudflare account. You make it once. After that, your agent and your computers publish to it.

```text
before:  a Cloudflare account, and a domain on it (example.com)

after:   https://poplin.example.com                       your dashboard
         report--k3f9x2ab71qz-p-poplin.example.com        every site you publish
```

Steps 1 to 5 happen in your browser, and after them your dashboard works. Step 6 logs in the computer you publish from. With the domain already active on Cloudflare, allow about an hour for the dashboard; twenty minutes more for step 6.

`example.com` stands for your own domain, on this page and in every command: type yours in its place.

Two words the steps use: a **Worker** is the program Cloudflare runs for you, and an **account token** is a long password that lets a program change your Cloudflare account.

## What you need

| Thing                           | Why                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| a Cloudflare account            | the Free plan is enough                                                                                  |
| a domain on that account        | every site gets an address under it. It is on the account when Cloudflare's home page lists it as Active. With none, install [without a domain](without-a-domain.md) |
| an email inbox you can read     | Cloudflare's login sends its code there in step 5                                                        |
| a payment method on the account | step 1 asks for one. [What can cost money](../upkeep/cost/what-can-cost-money.md) says when it is charged      |
| a GitHub account                | free. Step 2 puts a copy of poplin's code there                                                          |
| Node.js, on your own computer   | version 24 or higher, for step 6 alone                                                                   |
| an agent, to publish by asking  | an AI tool that runs in a terminal on your computer, such as Claude Code or Codex. You install it yourself, it may cost money, and poplin brings none. A chat in a browser cannot run commands |

**A domain that is not on Cloudflare yet** is added on Cloudflare's home page. Cloudflare shows two nameservers; paste them in the Nameservers setting at the shop where you bought the domain. The domain turns Active up to a day later.

## The steps

1. **Switch on two things in Cloudflare.** Open the address below and log in. Each asks for a payment method, and each shows a price of 0: Zero Trust's Free plan, and R2, which bills by use past its free allowance. [What can cost money](../upkeep/cost/what-can-cost-money.md) says what poplin does to stay inside it, and what it cannot do.

   ```text
   https://dash.cloudflare.com
   ```

   | Open                                        | Do                                 | It is                                |
   | ------------------------------------------- | ---------------------------------- | ------------------------------------ |
   | Zero Trust, in the left menu                | pick a team name and the Free plan | the login in front of your dashboard |
   | Storage & databases, then R2, then Overview | finish the checkout it shows       | the storage for your sites' files    |

   The team name can be any word: it only names your login page. Each sign-up asks for the payment method and names its price: finish it as it stands. Each is done when Cloudflare shows its overview instead of the sign-up.

2. **Make the Worker.** Click the button and sign in to GitHub when asked.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vivswan/poplin)

   Where the form asks for an account, pick your own GitHub account and your own Cloudflare account. Change nothing else: the names it suggests must stay, the project `poplin`, the bucket `poplin-sites`, the database `poplin`. Then press the button at the bottom of the form, the one that starts the deploy.

   | The form or GitHub asks                         | Answer                                                           |
   | ----------------------------------------------- | ---------------------------------------------------------------- |
   | whether Cloudflare may reach your GitHub account | allow it: Cloudflare puts the copy there and builds from it      |
   | whether the copy is private or public           | either works. The copy holds poplin's code and no token         |

   Cloudflare copies poplin to your GitHub account and builds the Worker. Keep the tab open: after a few minutes it shows the Worker's page, with the Worker's own address on it, the one ending in `workers.dev`. Note it. Where this page says `your-name`, yours has a word of your account:

   ```text
   https://poplin.your-name.workers.dev
   ```

   **To find the address again**, open `https://dash.cloudflare.com`, go to Workers & Pages, and select the Worker `poplin`: its page names the address.

   **If the build fails**, [When a step fails](../fix/an-install-step-fails.md#step-2-the-build-fails) has the next step.

3. **Make a Cloudflare API token.** One link opens Cloudflare's form with the nine permissions poplin needs already chosen. It worked if the form shows nine rows already filled. A zone is your domain. The setup page of step 4 has the same link, on its button Open the account token form.

   [Open the token form with the permissions chosen](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_api_tokens%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=%2A&zoneId=all&name=poplin%20setup)

   Finish the form, from top to bottom:

   | On the form       | Do                                                                                                                 |
   | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
   | the nine rows     | leave them                                                                                                         |
   | Account Resources | choose Include, then your account                                                                                  |
   | Zone Resources    | choose Include, then Specific zone, then your domain                                                               |
   | every other field | leave it as it is                                                                                                  |
   | the bottom        | press Continue to summary, then Create Token                                                                       |
   | the next page     | The token is shown once: paste it into a note now; you need it in the next step.                                   |

   The install never stores the token, so after step 5 you choose:

   | You                  | Then                                                                                         |
   | -------------------- | -------------------------------------------------------------------------------------------- |
   | keep the token       | keep its note where you keep passwords, such as a password manager                           |
   | delete it            | at Cloudflare, My Profile, then API Tokens. The install and every site keep working          |

   A token is asked for again only by Check and Repair on the dashboard's [Domain](../dashboard/domain.md) screen, such as after you add a permission. With none left, make a new one with the same link. If you lose the note, Cloudflare makes the token's text anew: [Roll](../fix/an-install-step-fails.md#step-4-the-page-shows-something-else).

   **If the form opens empty**, [When a step fails](../fix/an-install-step-fails.md#step-3-the-form-opens-empty) has the rows to add by hand.

4. **Finish on the setup page.** Open the Worker's address from step 2, the one ending in `workers.dev`: it shows the setup page. Leave its choice at Your domain. Under Fill in three boxes, fill each box and press Repair (the first time it also makes everything).

   | Box           | Put in                                                            |
   | ------------- | ----------------------------------------------------------------- |
   | Domain        | your domain alone, with no `https://` and no `www`: `example.com` |
   | Your email    | an email whose inbox you can read: the first login                |
   | Account token | the token of step 3                                               |

   The page lists what it made:

   ```text
   11 repaired
   The login is ready. Open your dashboard and log in: https://poplin.example.com

   Piece                State      Detail
   DNS record           created    poplin.example.com
   Worker route         created    poplin.example.com/*
   Access application   created    poplin: poplin.example.com, *-p-poplin.example.com
   WAF rule             optional   ... add this right to the account token and press Repair: Zone WAF: Edit
   ```

   **It worked when** the page says `The login is ready.` The sample shows a few of the rows, and your counts may differ. `repaired` counts the rows Repair made: on a first run it makes them all, and nothing was broken. The page calls a permission a right. The token is used for that one request and kept nowhere. Repair is safe to repeat.

   | Piece              | It is                                               |
   | ------------------ | --------------------------------------------------- |
   | DNS record         | what makes an address under your domain exist       |
   | Worker route       | what sends that address to the Worker               |
   | Access application | Cloudflare's login in front of the dashboard        |
   | WAF rule           | an optional rule that stops junk before the Worker  |

   With the nine permissions, Repair adds a DNS record, routes, a login of poplin's own, and the key poplin keeps. It removes only a record that carries poplin's mark and a route that names poplin's Worker. A website or a mailbox on the domain stays as it is.

   Three permissions of [the optional part](../dashboard/domain.md#optional-block-junk-traffic-and-crawlers) switch the optional rows on, now or at any time. One permission can hold more than one row.

   **When the page shows something else**, [When a step fails](../fix/an-install-step-fails.md#step-4-the-page-shows-something-else) has each line and what to do.

5. **Open your dashboard and log in.** Cloudflare's login asks for your email, the one of step 4, and sends a code to its inbox. A new address can take a few minutes to answer: until then the browser says it cannot find the site; wait a few minutes and reload.

   ```text
   https://poplin.example.com
   ```

   **If no code arrives**, [When a step fails](../fix/an-install-step-fails.md#step-5-no-code-arrives) has the fix.

   After the code, the dashboard opens on Sites, which says `No sites yet`.

   This first login closes the setup page for good. Step 6 is for the computer that publishes.

6. **Log a computer in, and check.** Take the LTS installer of Node.js from nodejs.org and run it. A Node.js that is already there must be version 24 or higher: `node --version` shows it. Then open a terminal, the window where you type commands:

   ```text
   Mac:      press Command and Space, type Terminal, press Enter
   Windows:  press the Windows key, type PowerShell, press Enter
   ```

   Type each line and press Enter, with your own domain in place of `example.com`. The two lines are the same on a Mac and on Windows. The first time, it asks whether it may download poplin: answer `y`.

   ```sh
   npx poplin login --server https://poplin.example.com
   npx poplin doctor
   ```

   The first line prints a short code and opens your dashboard on the question `Allow this login?`

   | On the page | Do |
   | --- | --- |
   | Can change | choose Everything: this computer is yours, and the checks below read the settings |
   | Last 4 letters of the code in your terminal | type them |
   | Allow | press it |

   The page takes only the letters of the code your terminal printed. If it refuses them, or you did not start a login, press Deny.

   Every check `poplin doctor` prints starts with `ok`, and its last line says `nothing was changed`:

   ```text
   ok  install   https://poplin.example.com answers
   ok  version   install 0.1.0, this poplin 0.1.0
   ok  login     admin token 3f9a1c07b2d84e65, saved on this machine, expires 2026-12-15
   ok  settings  20 settings read
   ok  sites     0 sites
   ok  trash     0 sites
   ok  problems  none in 7 days
   nothing was changed
   ```

   The login lasts 30 days: after that, `npx poplin login` makes a new one. **If a line differs**, [When a step fails](../fix/an-install-step-fails.md#step-6-the-computer-is-not-logged-in) has it.

Your install is ready, and it publishes two ways.

| Publish            | Do                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| by asking an agent | set the agent up once, with the line of [With an agent](with-an-agent.md). Then say `Put this report online.`                     |
| by a command       | `npx poplin ./report`: see [Publish](../sites/publish.md)                                                                           |

`./report` is a folder named `report` inside the folder the terminal is in. A folder that is somewhere else is named by its whole path:

```text
Mac:      npx poplin ~/Desktop/report
Windows:  npx poplin "C:\Users\user\Desktop\report"
```

On a Mac, `~` is your own folder. On Windows, `user` stands for your own name on the computer, and the quotes keep a path that holds a space in one piece.

A new site takes its name from the folder, and a name holds small letters, digits, and dashes alone. A folder such as `my report` needs `--name`, and on a Mac its quotes come after the `~/`:

```text
Mac:      npx poplin ~/"Desktop/my report" --name my-report
Windows:  npx poplin "C:\Users\user\Desktop\my report" --name my-report
```

To take an install down, see [Remove](../upkeep/remove.md).
