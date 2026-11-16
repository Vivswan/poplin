# Poplin

The `poplin` skill fires when a user asks an agent to put a page, a report, a chart, a dashboard, or a folder of static files online, or to set poplin up. The agent publishes to the user's own poplin install and hands back an address.

## Start

Paste this line into your agent:

```text
Look at https://github.com/Vivswan/poplin, read its skill, and help me set up poplin.
```

With no install yet, the agent makes one with you: it asks for a domain or none and for your email, tells you what to choose in your browser, checks with a dry run, and runs `npx poplin install cloudflare`. The account token never passes through the chat. It acts as you, with the login saved on this computer, and asks before it adds poplin's tools to its own configuration.

## What It Does

- **Publishes with one call**: a folder with an `index.html`, or one HTML file, becomes a site with its own address
- **Keeps a new site private**, and asks before a site becomes unlisted or public
- **Updates the same site** by keeping the label a publish returns, so a shared address shows the new version
- **Changes an address or deletes for good only on request**: a new link stops the old label address, and the trash can be restored

## The pages

| Page                                                   | Holds                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [`SKILL.md`](SKILL.md)                                 | the tools, the publish steps, and the rules with reasons    |
| [`references/setup.md`](references/setup.md)           | the setup, step by step; the repair and the removal         |
| [`references/mcp-server.md`](references/mcp-server.md) | how each kind of agent adds the MCP server                  |
| [`references/refusals.md`](references/refusals.md)     | the refusal codes an agent meets and what to do about each  |
