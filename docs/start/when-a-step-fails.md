---
title: When a step fails
order: 40
---

# When a step fails

Each failure of [the six steps](by-hand.md#the-steps) and what to do next; the steps themselves are not repeated here.

## Step 2: the build fails

**If the build fails**, no page with the Worker's address opens: Cloudflare shows the build's log, and its last lines say why.

| The log                                                                 | Do                              |
| ----------------------------------------------------------------------- | ------------------------------- |
| has a line that starts with `poplin:` and holds `Nothing was deployed.` | what the rest of that line says |
| names R2                                                                | finish the R2 row of step 1     |
| says anything else                                                      | build again in a few minutes    |

Then build again: [Build again](../run/update.md#build-again) has the three clicks. A log that fails the same way twice goes to your agent: paste its last lines.

## Step 3: the form opens empty

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

Then finish the form as in the table of [step 3](by-hand.md#the-steps).

## Step 4: the page shows something else

**When the page shows something else**, the table has it. Fix the cause and press Repair again: what is already made stays.

```text
after every run:   the token's box is empty    paste the token again
                   the other two boxes         keep what you typed
```

| The page says                                                            | Means                                                               | Do                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Account token refused`, and what to paste                               | Cloudflare does not take the token, or it does not reach the domain | paste the whole text of step 3; check its Account and Zone Resources       |
| `The account token shows no domain of that name.`                        | the domain is mistyped, not Active, or not the token's zone         | correct the Domain box, or edit the token's Zone Resources                 |
| `Type a domain alone, such as example.com.`                              | the box holds more than a domain, or one over 50 characters long    | type the domain alone; a longer domain cannot hold an install              |
| `Type an email address, such as name@example.com.`                       | the email is mistyped                                               | type it again                                                              |
| `No answer from the provider. Try again.`                                | Cloudflare gave no answer, or asked to wait                         | press Repair again in a minute                                             |
| `Too many tries. Wait a minute.`                                         | the page takes five tries a minute                                  | wait a minute                                                              |
| `The database takes no more today`, and when to try again                | the day's free allowance of the database is used up                 | try again after midnight UTC                                               |
| `Open Zero Trust and pick a plan (Free works): that switches Access on.` | Zero Trust is not switched on: the first row of step 1              | open the link beside that line, pick the Free plan, then press Repair      |
| a row `optional`                                                         | nothing is wrong: an optional permission is not on the token        | nothing, or [the optional part](../run/domain.md#optional-block-junk-traffic-and-crawlers) |
| a row `failed` ending `Add this right to the account token` and a name   | the token lacks the permission of that name                         | add it to the token: the table below                                       |
| a row `failed` with other words, and rows `not run`                      | that one step failed, and the row says why                          | do what the row asks, then press Repair again; a row that asks nothing: Repair again |

**Only when a row says failed for a permission**, add it to the token. Your tokens are listed on the page step 3's link opened (in Cloudflare: My Profile, then API Tokens). Each token's row ends in a menu.

| You                         | Do, in the token's menu                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| still have the token's text | choose Edit, add the permission, save. Paste the same text and press Repair          |
| no longer have it           | choose Roll. Roll makes a new token text. Add the permission, and paste the new text |

A right's name holds two of the form's three boxes. `Zone WAF: Edit` means Zone WAF in the second box and Edit in the third. The first box is in the table of [step 3](#step-3-the-form-opens-empty), or of [the optional part](../run/domain.md#optional-block-junk-traffic-and-crawlers).

## Step 5: no code arrives

No code arrives when the email differs from the one in step 4. Go back to the setup page: type the right email, paste the token again, and press Repair.

## Step 6: the computer is not logged in

| You see                                                    | Means                                                | Do                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| the terminal does not know `npx`                           | Node.js is not installed                             | run the installer of step 6, then open a new terminal     |
| `node --version` prints a number below `v24`               | poplin runs on Node.js 24 or higher                  | run the installer of step 6                               |
| the page refuses the letters you typed                     | that login is not the one your terminal began        | press Deny, and run the first line again                  |
| `poplin doctor` says `publisher token`                     | the page was left at Own sites only                  | run the first line again, and choose Everything           |
| `the login was denied on the dashboard`                    | Deny was pressed; nothing was saved                  | run the first line again                                  |
| `nobody allowed the login before it ran out`               | the code ran out before Allow; nothing was saved     | run the first line again                                  |
| `not logged in`                                            | the first line did not finish                        | run the first line again                                  |
| `no token was sent, or it expired`                         | the login ran out: it lasts 30 days                  | `npx poplin login`, and allow it again                    |
| `the install could not be reached`                         | the address is mistyped, or the network is down      | check the address after `--server`                        |
| a line of `poplin doctor` that starts with `failed`        | that one read failed; the rest of the line says why  | fix what it names, then run `npx poplin doctor` again     |

Any other sentence is a refusal: [When poplin refuses](../use/when-poplin-refuses.md) has each.
