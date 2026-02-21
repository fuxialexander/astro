# MCP Installation Guide

## Overview

The Astro MCP server provides tools for AI agents to interact with the Astro platform during task execution. The MCP SDK (`@modelcontextprotocol/sdk`) is automatically installed as a dependency—no manual installation needed.

## Installation Methods

### Method 1: NPM Package (Recommended for Production)

Once `@astro/agent` is published to npm:

```bash
# Install globally
npm install -g @astro/agent

# Or use npx (no installation needed)
npx @astro/agent setup
```

The MCP SDK will be installed automatically as a dependency.

### Method 2: Local Development

For local development before npm publication:

```bash
# From the astro repository root
cd packages/agent-runner

# Build the package
npm run build

# Link globally for local testing
npm link

# Now you can use it like the published package
astro-agent setup
```

### Method 3: Direct Execution (Alternative)

If you can't publish or link, modify the MCP config to use a local path:

```bash
# Edit ~/.claude/mcp_servers.json manually
{
  "mcpServers": {
    "astro": {
      "command": "node",
      "args": [
        "/absolute/path/to/astro/packages/agent-runner/dist/cli.js",
        "mcp"
      ]
    }
  }
}
```

## Verification

After setup, verify the MCP server is configured:

```bash
# Check Claude Code MCP config
cat ~/.claude/mcp_servers.json

# Should show:
{
  "mcpServers": {
    "astro": {
      "command": "npx",
      "args": ["@astro/agent", "mcp"]
    }
  }
}
```

## MCP Server Tools

The Astro MCP server provides 15 tools across 5 categories:

### User Interaction (1 tool)
- `ask_user_question` - Ask user for decisions

### Plan Management (5 tools)
- `query_plan` - Get plan graph
- `create_task` - Create new task
- `update_task` - Update task properties
- `create_dependency` - Create dependencies
- `delete_task` - Delete task

### Project Management (4 tools)
- `query_projects` - List projects
- `get_project` - Get project details
- `create_project` - Create new project
- `update_project` - Update project

### Initiative Management (3 tools)
- `query_initiatives` - List initiatives
- `create_initiative` - Create initiative
- `update_initiative` - Update initiative

### Data Access (2 tools)
- `get_user_profile` - Get user profile
- `query_executions` - Query execution history

See [tools-reference.md](./tools-reference.md) for complete documentation.

> **Note:** In addition to these 15 server-side tools, the agent-runner provides 4 session bridge tools (`astro_attach`, `astro_detach`, `astro_status`, `astro_send`) for managing execution sessions. Total: 19 tools across both MCP servers.

## Troubleshooting

### Error: "Cannot find module '@modelcontextprotocol/sdk'"

**Cause**: MCP SDK dependency not installed

**Solution**:
```bash
# If using npm link
cd packages/agent-runner
npm install

# If using npx
# This shouldn't happen as npx installs dependencies automatically
# Try clearing npx cache:
npx clear-npx-cache
```

### Error: "Command not found: astro-agent"

**Cause**: Package not published to npm yet, or not linked locally

**Solution**:
```bash
# Option 1: Link locally (for development)
cd packages/agent-runner
npm link

# Option 2: Use direct path in MCP config (see Method 3 above)
```

### MCP Server Not Loading in Claude Code

**Cause**: Configuration file not found or malformed

**Solution**:
```bash
# Verify config exists
cat ~/.claude/mcp_servers.json

# If missing or invalid, run setup again
astro-agent setup
# Or manually create with Method 3 format above
```

## For Package Maintainers

### Publishing to NPM

To make the package available via `npx @astro/agent`:

```bash
# From packages/agent-runner directory
npm run build
npm publish
```

The `publishConfig` in `package.json` is already set to `public` access.

### Local Development

When developing MCP tools:

1. Make changes to `server/lib/mcp/astro-tools-server.ts`
2. Rebuild the agent-runner: `cd packages/agent-runner && npm run build`
3. Test with: `node dist/cli.js mcp` (runs the MCP server directly)
4. Or test end-to-end via Claude Code if linked

### Dependencies

The MCP SDK version is pinned in `packages/agent-runner/package.json`:
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

Update this if you need newer MCP SDK features.

---

## Summary

✅ **No manual MCP installation needed** - The MCP SDK is a declared dependency and installs automatically

✅ **Setup command handles configuration** - `astro-agent setup` configures Claude Code automatically

⚠️ **Local development caveat** - Use `npm link` or direct path until package is published to npm

📖 **Full tool reference** - See [tools-reference.md](./tools-reference.md) for all 15 server-side tools (plus 4 session bridge tools in agent-runner)
