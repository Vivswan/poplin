# Poplin

Your AI agent publishes a web page for you and hands back a link. The page sits in your own Cloudflare account, and only the users of your install can open it until you say otherwise.

```text
You:    Put this report online.

Agent:  Published. It is private: only the users of your install can open it, after they log in.

        https://report--k3f9x2ab71qz-p-poplin.example.com

You:    Give me a link I can send to my team.

Agent:  I can make it unlisted: anyone who has the link opens it, with no login. Shall I?

You:    Yes.

Agent:  Done. The link is a new one:

        https://report--k3f9x2ab71qz-u-poplin.example.com
```

What gets published is a site: one HTML file, or a folder of files with an `index.html` in it. Your agent can write the page too.

## Use it from an AI agent

Paste this line into an agent, such as Claude Code or Codex. A chat in a browser cannot run commands, so it cannot publish.

| An agent here is | What that means for you                                             |
| ---------------- | ------------------------------------------------------------------- |
| an AI tool       | it runs in a terminal on your own machine, and runs commands there  |
| a separate tool  | you install it yourself, and it may cost money                      |
| not in poplin    | poplin brings none. Without one, you publish with a command         |

```text
Look at github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

The agent sets poplin up with you: it asks for a domain or none and for your email, tells you what to choose in your browser, and gives you two lines to run in a terminal of your own: a dry run, then the install. You paste back what each prints, and the agent never sees your account token.

It acts as you, with the login the setup saves on your machine.

| You have       | The agent                                                                         |
| -------------- | --------------------------------------------------------------------------------- |
| no install yet | makes one with you: your own copy of poplin, in your Cloudflare account           |
| an install     | connects itself to it, and adds poplin's tools to itself                          |

Or install the skill yourself, then ask the agent to set poplin up. Have Node.js 24 or higher on the machine first, as poplin needs:

```sh
npx skills add Vivswan/poplin
```

It asks what it needs, such as which agents get the skill, and whether for this folder or for you. `npx skills add Vivswan/poplin -g -y` skips those questions: `-g` installs for you, in every folder, and `-y` takes the defaults for the rest.

The skill is enough for an agent that runs commands: without poplin's MCP server, it publishes with `npx poplin` itself.

[With an agent](docs/start/with-an-agent.md) shows who does what. If you are the agent: the skill is [`skills/poplin/SKILL.md`](skills/poplin/SKILL.md).

## Install

One command makes your install. A domain is your choice: take it if you have one at Cloudflare.

| You install       | The command                                          | A site answers at                                                    |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| under your domain | `npx poplin install cloudflare --domain example.com` | a hostname of its own: `report--k3f9x2ab71qz-p-poplin.example.com`   |
| without a domain  | `npx poplin install cloudflare --no-domain`          | a path: `poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/` |

```text
$ npx poplin install cloudflare
Custom domain (Enter for workers.dev): example.com
First user's email: you@example.com
...
Account token (hidden):
This account has no install
unchanged  Account subdomain     your-name.workers.dev
created    R2 bucket             poplin-sites
created    D1 database           poplin
created    Worker                poplin, runs 0.1.0
...
poplin 0.1.0 is installed
Dashboard: https://poplin.example.com
...
```

The sample is cut short where the dots are.

Have ready a Cloudflare account with a payment method on it, and Node.js 24. An option answers a question before it is asked.

The command shows the way to the form that makes the account token, and `--dry-run` lists what a run would make and changes nothing. [Install](docs/start/install.md) has every step for both kinds.

## Who can open a site

| Access                | Who can open it          | Address                                                           |
| --------------------- | ------------------------ | ----------------------------------------------------------------- |
| private (the default) | only the users of your install, after a login | `report--k3f9x2ab71qz-p-poplin.example.com`                       |
| unlisted              | anyone who has the link  | `report--k3f9x2ab71qz-u-poplin.example.com`                       |
| public                | everyone                 | a name you choose, `docs-page.example.com`, and its unlisted link |

`example.com` stands for your own domain; [Without a domain](docs/start/without-a-domain.md) shows the addresses of an install that has none. The users of your install are yourself, and anyone you add. Your dashboard is a private page that lists every site you published: `poplin.example.com`.

## Use it from the command line

```sh
npx poplin login --server https://poplin.example.com              # once on each machine
npx poplin ./report                                               # a new site, private
npx poplin ./report --site report--k3f9x2ab71qz                   # the same site, new content
npx poplin set report--k3f9x2ab71qz --unlisted                    # anyone who has the link
npx poplin set report--k3f9x2ab71qz --public --public-name docs   # everyone, at docs-page.example.com
```

## Where it runs

In your own Cloudflare account, on the Free plan. Cloudflare asks for a payment method to switch two parts on, the bucket and the login: [What can cost money](docs/upkeep/cost/what-can-cost-money.md) says when it is charged. You need the account. A domain on it is your choice.

| The install is  | It                                              |
| --------------- | ----------------------------------------------- |
| one Worker      | serves every site, the dashboard, and the login |
| one bucket      | holds the files                                 |
| one database    | holds the list of sites and the settings        |

## Read more

| Page                                      | What it covers                                       |
| ----------------------------------------- | ---------------------------------------------------- |
| [The guide](docs/README.md)               | every command, every agent tool, and every error     |
| [Start](docs/start/README.md)             | getting your own install, under a domain or without  |
| [Security](docs/about/security.md)        | what poplin protects against and what it does not    |
| [Remove](docs/upkeep/remove.md)              | taking an install down, with one command or by hand  |

## License

[Individual and Small Organization License 1.1.0](LICENSE.md). Its summary table says who may use poplin, and how.
