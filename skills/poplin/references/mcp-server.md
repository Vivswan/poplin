# Add the MCP server to your own configuration

Open this at step 4 of [`setup.md`](setup.md), after the user has said yes to it. The MCP server is a program on this computer, started by you, that speaks over stdio.

| Field     | Value        |
| --------- | ------------ |
| name      | `poplin`     |
| command   | `npx`        |
| arguments | `poplin mcp` |

Add it the way your own kind of agent adds a local MCP server. Edit your own configuration only.

| Agent                        | How                                          |
| ---------------------------- | -------------------------------------------- |
| Claude Code                  | `claude mcp add poplin -- npx poplin mcp`    |
| Codex                        | `codex mcp add poplin -- npx poplin mcp`     |
| an agent configured by JSON  | the entry below, in its MCP servers file     |

```json
{ "mcpServers": { "poplin": { "command": "npx", "args": ["poplin", "mcp"] } } }
```

If the file already lists other servers, add the `poplin` entry beside them and leave the rest as it is. If a `poplin` entry is already there, leave it.

If your agent is not in the table, read your own documentation for how a local stdio server is added, and use the three values above. If you cannot find out, give the user the three values and let them add it.

The tools may not appear until the agent is restarted or its servers are reloaded. If they are not there after you add the server, tell the user to restart you.
