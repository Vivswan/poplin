// The site actions every face implements: the CLI's word for each, and the MCP tool of the same action.

/** The eight site actions, one to one across the CLI and the MCP server. */
export const SITE_ACTIONS = [
  { action: "publish", tool: "publish_site" },
  { action: "set", tool: "update_site" },
  { action: "show", tool: "get_site" },
  { action: "list", tool: "list_sites" },
  { action: "rollback", tool: "rollback_site" },
  { action: "new-link", tool: "new_link" },
  { action: "delete", tool: "delete_site" },
  { action: "restore", tool: "restore_site" },
] as const;
