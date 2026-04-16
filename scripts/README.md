# Astro Scripts

This directory contains utility and verification scripts for the Astro platform.

## Environment verification

### `verify-setup.sh`
Verifies the local development environment is correctly configured.

```bash
npm run verify
```

### `verify-environment-setup.sh`
Checks environment variables and configuration.

```bash
npm run verify:env
```

## Approval system

Dynamic approvals (`AskUserQuestion`) are provided by the Claude SDK's built-in tool and intercepted in `packages/agent-runner/src/providers/claude-sdk-adapter.ts` via the `canUseTool` callback. There is no MCP server. See `docs/features/approval-system.md` for the end-to-end flow.

## Related Documentation

- `CLAUDE.md` - Project setup and architecture
- `vision.md` - Product vision and context
- `docs/features/approval-system.md` - Approval system documentation
