# Set up poplin for an agent

Open this when the user asks you to set poplin up, or when you have no poplin tools and no login. It says what to do, in order, and why.

**You act as the user, with their own login, and you ask before you change your own configuration.** The login is the one saved on this computer when they installed poplin. You do not log in yourself, and you leave a saved login as it is.

Adding the tools edits how you start: say what you are about to do, and wait for a yes.

Poplin publishes a static site (a folder, or one HTML file) to an install that runs in the user's own Cloudflare account. Once you are set up, the user can ask you to put a page online and you hand back its address.

| Step | What you do                                                                   | What it changes                    |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------- |
| 1    | Say what is about to happen, and ask                                          | nothing                            |
| 2    | Check for a login: `npx poplin whoami`                                        | nothing                            |
| 3    | With no login saved: ask the user to log this computer in, and wait           | nothing you do                     |
| 4    | Add the MCP server to your own configuration                                  | edits your own configuration       |
| 5    | Confirm that it works, and tell the user                                      | nothing                            |

`https://poplin.example.com` stands for the address of the user's own install, here and below. The poplin repository and the place you read this page from are not that address. `npx` may download the `poplin` package the first time it runs.

## 1. Say what is about to happen, and ask

Tell the user first, in a sentence or two, and wait for a yes before you run step 4.

Something like this, in your own words:

> Poplin lets me publish pages to your own Cloudflare account and give you a link. To set it up I would use the poplin login already saved on this computer, and add poplin's tools to my own configuration. Shall I go ahead?

If the user says no, stop.

A yes here covers the setup and nothing else. It is no permission to publish, share, or delete anything.

## 2. Check whether poplin is already set up

```sh
npx poplin whoami
```

| What it prints                                  | Means                         | Next                                        |
| ----------------------------------------------- | ----------------------------- | ------------------------------------------- |
| lines for `install`, `role`, `token`, `expires` | this computer is logged in    | tell the user which install; go to step 4   |
| `not logged in`                                 | there is no login             | step 3                                      |
| `no token was sent, or it expired`              | the login ran out             | step 3                                      |
| `the install could not be reached`              | the address or the network    | tell the user and stop until it is sorted   |

If it is logged in to an install the user did not expect, say so and ask before you go on. Do not log out or log in: the saved login is the user's to change.

You act with that login as it is. It is the user's own, so you reach what they reach.

## 3. With no login saved, the user logs in

You do not run the login. Tell the user to run this line once in a terminal of their own, with the address of their install, as step 6 of the install guide does:

```sh
npx poplin login --server https://poplin.example.com
```

It opens their dashboard, where they compare a short code and allow the computer. Wait until they say it is done, then run step 2 again.

If the user has no install, say so plainly: poplin needs an install in their own Cloudflare account before anything can be published, and you cannot make one for them from here. Point them to <https://github.com/Vivswan/poplin/blob/main/docs/install.md>, and stop.

Do not ask the user to paste a token into the chat, and do not print one. A chat is kept and read in places a token should never reach, and whoever holds the token can act on the install.

## 4. Add the MCP server to your own configuration

The server has one name, `poplin`, one command, `npx`, and two arguments, `poplin mcp`. [`mcp-server.md`](mcp-server.md) says how each kind of agent adds it.

Edit your own configuration only, and only after the yes of step 1. The tools may not appear until you are restarted: if so, tell the user, and do step 5 with the command.

## 5. Confirm, and tell the user

| You have              | Check                           | Good looks like                           |
| --------------------- | ------------------------------- | ----------------------------------------- |
| the poplin tools      | call `list_sites`               | a list of sites, which may be empty       |
| no tools yet          | `npx poplin whoami`             | the install's address and its `role`      |

Then tell the user, in a line or two: poplin is ready, which install it talks to, and that they can now ask you to put a page or a folder online. If a step was skipped or failed, say which one and what is still missing.

Nothing is published by the setup. When the user later asks you to publish, [`../SKILL.md`](../SKILL.md) holds the rules. The two that matter most: a new site is private until the user asks otherwise, and you keep the label a publish returns so the next publish updates the same site.
