# Approval System Testing - Quick Reference

## 🚀 One-Command Tests

```bash
# Fastest: Demo only (no server)
npm run demo:approval

# Quick: Unit tests (auto-starts server)
npm run test:approval:quick

# Gold Standard: Full E2E integration
./scripts/test-e2e-with-approval.sh  # Requires backend + agent running
```

## 📋 Test Matrix

| Test | Time | Auto-Start | Verifies | When to Use |
|------|------|------------|----------|-------------|
| Demo | 10s | ✅ | Flow understanding | Learning |
| Unit | 30s | ✅ | Components work | Quick check |
| E2E | 2-3m | ❌ | Full integration | Before commit |
| UI | 5m | ❌ | User experience | UAT |

## 🔧 Setup for E2E Test

```bash
# Terminal 1
npm run dev:backend

# Terminal 2
cd packages/agent-runner && node dist/cli.js connect

# Terminal 3
./scripts/test-e2e-with-approval.sh
```

## ✅ What Gets Tested

### Unit Tests
- [x] MCP server starts
- [x] Tool listing works
- [x] HTTP endpoint accepts requests
- [x] Approval flow initiates

### E2E Integration
- [x] Real agent execution
- [x] Agent calls ask_user_question
- [x] Approval emitted via SSE
- [x] Response processed
- [x] Agent continues
- [x] Correct output generated

## 🐛 Quick Troubleshooting

| Issue | Fix |
|-------|-----|
| "Server not running" | `npm run dev:backend` |
| "MCP server failed" | Check Node.js 18+ |
| "No approval detected" | Check agent logs |
| "Timeout" | Increase wait time or check agent errors |

## 📁 Test Artifacts

```bash
# E2E test logs saved to:
/tmp/nexus-e2e-logs-<timestamp>/

# Key files:
- test-report.txt        # Summary
- approval-events.log    # SSE events
- worktree-snapshot.txt  # Generated files
- agent-runner.log       # Agent output
```

## 📚 Documentation

- `APPROVAL_SYSTEM.md` - Architecture
- `docs/APPROVAL_QUICKSTART.md` - Usage guide
- `scripts/TESTING_APPROVAL.md` - Full testing guide
- `scripts/README.md` - All test scripts

## 🎯 Testing Strategy

```
Development → npm run test:approval:quick
Commit      → ./scripts/test-e2e-with-approval.sh
Demo        → npm run demo:approval
UAT         → npm run dev (manual UI)
```
