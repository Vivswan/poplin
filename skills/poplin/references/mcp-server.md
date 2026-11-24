# Add the MCP server to your own configuration

Open this at step 5 of [`setup.md`](setup.md), after the user's yes of step 1, which covers this: do not ask again. The MCP server is a program on this machine, started by you, that speaks over stdio.

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

## Optional: a login of your own

By default the server uses the login stored on this machine, the user's own. Offer this step only when the user wants to tell your work apart from theirs.

The server then reads its login from a folder of its own, named by `POPLIN_CONFIG_DIR` in the entry's environment. The machine's stored login is not touched. `POPLIN_SERVER` and `POPLIN_TOKEN`, where they are set, stand in for any stored login, this one included.

```json
{ "mcpServers": { "poplin": { "command": "npx", "args": ["poplin", "mcp"], "env": { "POPLIN_CONFIG_DIR": "/home/user/.config/poplin-agent" } } } }
```

Write the full path of the folder: the one above is an example. An agent added by a command sets the same variable the way its own documentation says.

Then log in once with the same variable set, and a name for yourself. The user approves it in their browser, as in step 4 of [`setup.md`](setup.md):

```sh
export POPLIN_CONFIG_DIR="/home/user/.config/poplin-agent"
npx poplin login --machine my-agent --server https://poplin.example.com
```

In PowerShell the first line is `$env:POPLIN_CONFIG_DIR = "C:\Users\user\poplin-agent"`.

| With a login of your own                       | Where                                                     |
| ---------------------------------------------- | --------------------------------------------------------- |
| the login is listed under the name you gave it | the dashboard's Access screen, under Tokens               |
| each version you publish shows that name       | the site's list of versions on the dashboard, until the login is removed: then its id |
| each change you make shows that name           | the dashboard's Activity screen, until the login is removed: then its id |
| the user can end it alone                      | Remove, in the menu of its row under Tokens; their own login stays |

The login is stored as a file in that folder. It expires when the user set it to, at approval or later under Access: left alone, an admin login expires after 30 days and a publisher login never. A command you run outside the server uses the machine's stored login, unless the variable is set for it too.
