---
name: poplin-mcp
description: Adds poplin's MCP server to Claude Code, and nothing else. It holds no instructions and answers no request. Install it beside the poplin skill, which does both.
disable-model-invocation: true
---

# Poplin MCP

> This folder starts poplin's MCP server in Claude Code. It holds no instructions.

- **The instructions** are the poplin skill's, installed beside this one: follow that skill.
- **Without that skill**, each tool's own description says what it does and what it takes.
- **In another agent** this folder does nothing: the poplin skill's setup adds the server there.
