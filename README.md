# Poplin

Your AI agent publishes a web page for you and hands back a link. The page sits in your own Cloudflare account, and only you can open it until you say otherwise.

```text
You:    Put this report online.

Agent:  Published. It is private: only you can open it, after you log in.

        https://report--k3f9x2ab71qz-p-poplin.example.com

You:    Give me a link I can send to my team.

Agent:  Done. Anyone who has this link can open it.

        https://report--k3f9x2ab71qz-u-poplin.example.com
```

What gets published is a site: one HTML file, or a folder of files with an `index.html` in it. Your agent can write the page too.

## Use it from an AI agent

**First time? Install first.** [Install](docs/install.md) shows how.

The agent publishes to an install: your own copy of poplin, set up once in your Cloudflare account. The agent cannot make the install for you: it logs your computer in to one and adds poplin's tools to itself.

Then paste this line into an agent that can run commands on your computer, such as Claude Code or Codex. A chat in a browser cannot.

```text
Look at https://github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

The agent asks for the address of your install. That is your dashboard's address: `https://poplin.example.com`.

If you are the agent: the skill is [`skills/poplin/SKILL.md`](skills/poplin/SKILL.md).

## Who can open a site

| Access                | Who can open it          | Address                                                           |
| --------------------- | ------------------------ | ----------------------------------------------------------------- |
| private (the default) | only you, after a login  | `report--k3f9x2ab71qz-p-poplin.example.com`                       |
| unlisted              | anyone who has the link  | `report--k3f9x2ab71qz-u-poplin.example.com`                       |
| public                | everyone                 | a name you choose, `docs-page.example.com`, and its unlisted link |

`example.com` stands for your own domain. "You" is every login of your install: yourself, and anyone you add. Your dashboard is a private page that lists every site you published: `poplin.example.com`.

## Use it from the command line

```sh
npx poplin login --server https://poplin.example.com              # once on each computer
npx poplin ./report                                               # a new site, private
npx poplin ./report --site report--k3f9x2ab71qz                   # the same site, new content
npx poplin set report--k3f9x2ab71qz --unlisted                    # anyone who has the link
npx poplin set report--k3f9x2ab71qz --public --public-name docs   # everyone, at docs-page.example.com
```

## Where it runs

In your own Cloudflare account, on the Free plan. You need the account and a domain on it.

| The install is  | It                                              |
| --------------- | ----------------------------------------------- |
| one Worker      | serves every site, the dashboard, and the login |
| one bucket      | holds the files                                 |
| one database    | holds the list of sites and the settings        |

## Read more

| Page                         | What it covers                                       |
| ---------------------------- | ---------------------------------------------------- |
| [Using](docs/using.md)       | every command, every agent tool, and every error     |
| [Install](docs/install.md)   | getting your own install                             |
| [Security](docs/security.md) | what poplin protects against and what it does not    |
