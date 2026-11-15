---
title: Poplin
order: 10
---

# Poplin

Your AI agent, or you at the command line, publish a static site (a folder, or one HTML file) to your own Cloudflare account and get a link.

```text
You:    Put this report online.

Agent:  Published. It is private: only you can open it, after you log in.

        https://report--k3f9x2ab71qz-p-poplin.example.com
```

**Start: get your own install**

| Page                                              | What it covers                                           |
| ------------------------------------------------- | -------------------------------------------------------- |
| [With an agent](start/with-an-agent.md)           | paste the prompt; the agent leads the steps              |
| [By hand](start/by-hand.md)                       | the six steps                                            |
| [From a terminal](start/from-a-terminal.md)       | the terminal form of two of the steps                    |
| [When a step fails](start/when-a-step-fails.md)   | each failure and its next step                           |

**Use: publish and share**

| Page                                                | What it covers                                                  |
| --------------------------------------------------- | --------------------------------------------------------------- |
| [Publish](use/publish.md)                           | publish, name, and update a site                                |
| [Who can open a site](use/who-can-open.md)          | private, unlisted, public, the address, a new link              |
| [Manage sites](use/manage-sites.md)                 | show, list, go back, copy, delete, restore, the other settings  |
| [Back up](use/back-up.md)                           | export and import                                               |
| [The agent tools](use/agent-tools.md)               | the tools an agent gets                                         |
| [When poplin refuses](use/when-poplin-refuses.md)   | every refusal and what to do                                    |

```text
You:    Put this report online.           ->  the agent calls publish_site
You:    Share it with anyone I send it.   ->  the agent calls update_site, access unlisted
You:    Take it down.                     ->  the agent calls delete_site
```

An agent uses the tools. A person uses the commands. Both do the same things.

The examples write `poplin`. Type `npx poplin` in its place, as [By hand](start/by-hand.md) does, unless poplin is installed on the computer. `example.com` stands for your own domain.

**Run: keep the install**

| Page                                          | What it covers                                                    |
| --------------------------------------------- | ----------------------------------------------------------------- |
| [Update](run/update.md)                       | how each kind of install updates; the notice of a newer version   |
| [Settings](run/settings.md)                   | the install's settings, who can log in, this computer's login     |
| [Domain](run/domain.md)                       | the Domain tab, Repair, the last check, the optional rules        |
| [Limits and cost](run/limits-and-cost.md)     | what is capped or protected; what can cost money                  |
| [With OpenTofu](run/with-opentofu.md)         | installing with the module                                        |

**About**

| Page                                            | What it covers                                      |
| ----------------------------------------------- | --------------------------------------------------- |
| [Security](about/security.md)                   | what poplin protects against and what it does not   |
| [Between sites](about/between-sites.md)         | what one site's pages can ask of another            |
| [How it is built](about/how-it-is-built.md)     | what an install is made of                          |
