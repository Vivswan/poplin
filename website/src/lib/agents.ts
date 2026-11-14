/** How one agent takes a local MCP server: a command to run, or a snippet for a file it reads. */
interface AgentSetup {
  /** The key the picker switches on. */
  readonly id: string;

  /** The agent's plain name. */
  readonly name: string;

  /** The command to run, or the snippet to add at `where`. */
  readonly line: string;

  /** Where the snippet goes: a file the agent reads, or the place in its settings; absent when `line` is a command. */
  readonly where?: string;
}

/** The entry for poplin's local server, as most agents' settings write one. */
const SERVER = '"poplin": { "command": "npx", "args": ["poplin", "mcp"] }';

/** That entry under the key most agents read. */
const MCP_SERVERS = `{ "mcpServers": { ${SERVER} } }`;

/** Every agent whose own documentation states how it takes a local MCP server: the most used first, then by name. */
export const AGENTS: readonly AgentSetup[] = [
  { id: "claude-code", name: "Claude Code", line: "claude mcp add poplin -- npx poplin mcp" },
  { id: "codex", name: "Codex", line: "codex mcp add poplin -- npx poplin mcp" },
  { id: "cursor", name: "Cursor", line: MCP_SERVERS, where: ".cursor/mcp.json" },
  { id: "vs-code", name: "VS Code", line: `{ "servers": { "poplin": { "type": "stdio", "command": "npx", "args": ["poplin", "mcp"] } } }`, where: ".vscode/mcp.json" },
  { id: "gemini-cli", name: "Gemini CLI", line: "gemini mcp add poplin npx poplin mcp" },
  { id: "amp", name: "Amp", line: "amp mcp add poplin -- npx poplin mcp" },
  { id: "antigravity", name: "Antigravity", line: MCP_SERVERS, where: "~/.gemini/config/mcp_config.json" },
  { id: "cline", name: "Cline", line: MCP_SERVERS, where: "cline_mcp_settings.json" },
  { id: "copilot-cli", name: "Copilot CLI", line: "copilot mcp add poplin -- npx poplin mcp" },
  { id: "jetbrains", name: "JetBrains AI Assistant", line: MCP_SERVERS, where: "Settings, MCP, Add" },
  { id: "junie", name: "Junie", line: MCP_SERVERS, where: ".junie/mcp/mcp.json" },
  { id: "kiro", name: "Kiro", line: MCP_SERVERS, where: ".kiro/settings/mcp.json" },
  { id: "opencode", name: "opencode", line: "opencode mcp add poplin -- npx poplin mcp" },
  { id: "roo-code", name: "Roo Code", line: MCP_SERVERS, where: ".roo/mcp.json" },
  { id: "zed", name: "Zed", line: `{ "context_servers": { ${SERVER} } }`, where: "settings.json" },
  { id: "other", name: "Other", line: MCP_SERVERS, where: "its MCP settings" },
];
