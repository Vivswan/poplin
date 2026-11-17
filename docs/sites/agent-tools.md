---
title: The agent tools
order: 40
---

# The agent tools

The tools an agent calls, each with one example input and the command that does the same; the agent's rules are not here but in the skill.

`npx poplin mcp` runs the MCP server on this machine. An agent starts it and calls these tools:

| Tool            | Example input                                              | Same as                                       |
| --------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `publish_site`  | `{ "path": "./report" }`                                   | `poplin ./report`                             |
| `publish_site`  | `{ "path": "./report", "site": "report--k3f9x2ab71qz" }`   | `poplin ./report --site report--k3f9x2ab71qz` |
| `update_site`   | `{ "site": "report--k3f9x2ab71qz", "access": "unlisted" }` | `poplin set report--k3f9x2ab71qz --unlisted`  |
| `get_site`      | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin show report--k3f9x2ab71qz`            |
| `list_sites`    | `{ "trash": true }`                                        | `poplin list --trash`                         |
| `rollback_site` | `{ "site": "report--k3f9x2ab71qz", "version": 3 }`         | `poplin rollback report--k3f9x2ab71qz --to 3` |
| `new_link`      | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin new-link report--k3f9x2ab71qz`        |
| `delete_site`   | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin delete report--k3f9x2ab71qz`          |
| `restore_site`  | `{ "site": "report--k3f9x2ab71qz" }`                       | `poplin restore report--k3f9x2ab71qz`         |
| `duplicate_site` | `{ "site": "report--k3f9x2ab71qz" }`                      | `poplin duplicate report--k3f9x2ab71qz`       |

- **`publish_site` and `update_site` take the site settings:** `name`, `access`, `public_name`, `title`, `search_engines`, `embeddable`, `expires`.
- **`delete_site` with `"no_trash": true`** removes the site at once, with no trash.
- **The copy's name** goes with `duplicate_site`: `{ "site": "report--k3f9x2ab71qz", "name": "report-draft" }`. Left out, the copy has the site's own name.
- **`duplicate_site` titles the copy** as the site, with `(copy)` after it: `Q3 sales (copy)`. [Manage sites](manage.md) has the whole rule.
- **No tool takes a dry run:** a tool call is a run. `--dry-run` goes with the commands, and [Manage sites](manage.md#try-a-change-first) lists them.
- **The agent's rules** are in the skill: [`skills/poplin/SKILL.md`](../../skills/poplin/SKILL.md).
