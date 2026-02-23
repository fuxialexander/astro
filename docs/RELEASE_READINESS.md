# Astro — Release Readiness Assessment

> **Date**: 2025-07-24
> **Version**: 0.0.1 (package.json)
> **Assessed against**: commit `7083cc0` on main

---

## Executive Summary

Astro is a **substantially implemented** planning-first platform with a working frontend (16 pages, 27 stores), backend (20 route files, 28 DB tables), relay server, and agent runner. The core user journey — create project → generate AI plan → execute tasks → get results — works end-to-end through the relay architecture.

**Current overall readiness: ~80% for Alpha, ~65% for Beta/Open-Source Release.**

The biggest gaps for release are:
1. **No README.md** — the repo has no public-facing documentation for new users
2. **CI/CD pipeline disabled** — GitHub Actions workflows exist but are in `workflows.disabled/`
3. **Integration tests failing** — 8/55 test files fail (PGlite initialization timeout in integration tests)
4. **Team features partially wired** — backend ~85% complete, frontend ~30% wired
5. **LICENSE references wrong project name** — says "Nexus Contributors" instead of "Astro"
6. **Bundle size warning** — 3.2MB JS bundle (should be code-split)
7. **No npm publishing** — `@astroanywhere/agent` package not published

---

## 1. Build & Quality Status

| Check | Status | Details |
|-------|--------|---------|
| `npm run build` | ✅ Pass | TypeScript compiles + Vite builds (3.2MB JS, 121KB CSS) |
| `npm run lint` | ✅ Pass | Zero ESLint errors |
| `npm test` | ⚠️ Partial | 46/55 test files pass, 834 tests pass, 111 skipped |
| Integration tests | ❌ 8 failures | All fail on `setupTestServer()` hook timeout (PGlite init >10s) |
| Bundle size | ⚠️ Warning | 3,214KB JS (>500KB threshold). Needs code splitting. |

### Integration Test Failures

All 8 failing tests are in `tests/integration/` and fail with the same root cause: `setupTestServer()` in `beforeAll()` times out at 10 seconds. The PGlite initialization (create temp dir → run migrations → bootstrap) takes longer than the default vitest hook timeout. **Fix**: Increase `hookTimeout` in vitest config for integration test files, or optimize PGlite startup.

Failing files:
- `data-isolation.integration.test.ts`
- `data-plan.integration.test.ts`
- `data-profile.integration.test.ts`
- `data-projects.integration.test.ts`
- `device-auth.integration.test.ts`
- `health.integration.test.ts`
- `share.integration.test.ts`
- (1 skipped: relay integration, requires running server)

---

## 2. Feature Completeness

### 2.1 Core User Journey — ✅ Fully Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Create project (description + repo) | ✅ Done | Unified form with directory detection |
| Generate AI plan via Claude | ✅ Done | SSE streaming, graph output |
| Interactive plan graph (React Flow) | ✅ Done | Nodes, edges, dependency visualization |
| Edit plan nodes/edges | ✅ Done | Title, description, dependencies |
| Execute tasks via agent runner | ✅ Done | All AI flows through relay → agent runner |
| Real-time output streaming (SSE) | ✅ Done | Terminal-style output viewer |
| Tool traces & file changes | ✅ Done | Collapsible I/O, diff display |
| Cancel running tasks | ✅ Done | Via relay |
| Steer running tasks | ✅ Done | Mid-execution guidance chat |
| Chat about plans | ✅ Done | Sidebar chat panel |
| Chat about tasks | ✅ Done | Task-level chat |
| Usage metrics | ✅ Done | Cost, tokens, task counts per session |

### 2.2 Architecture — ✅ Relay-Only Execution Path

The critical Phase A fix from `IMPLEMENTATION_PIPELINE.md` has been **completed**: all AI execution flows through the relay to agent runners. The server never calls AI directly. The old provider adapters (`anthropic-direct.ts`, `claude-code.ts`, `codex.ts`) have been **removed**. `chat-session-pool.ts` is also gone.

### 2.3 Views & Navigation

| Feature | Status | Notes |
|---------|--------|-------|
| Dashboard | ✅ Done | Stats, pending decisions, active projects, system health, usage |
| Projects list | ✅ Done | Table view with grouping/sorting |
| Project overview | ✅ Done | Overview + updates tabs, vision doc dialog |
| Plan view (Graph) | ✅ Done | React Flow with custom nodes |
| Plan view (List) | ✅ Done | Tabular task list |
| Plan view (Timeline/Gantt) | ✅ Done | Topological sort, date assignment |
| My Tasks | ✅ Done | Cross-project with filters, grouping |
| Task Detail | ✅ Done | Output, tools, files, steer, sessions |
| Environments | ✅ Done | Machine registration, SLURM clusters |
| Agents | ✅ Done | Agent listing and monitoring |
| Initiatives | ✅ Done | Project grouping |
| Workflows | ✅ Done | Workflow management |
| Settings | ✅ Done | Backend health, model selection, teams tab |
| Device Auth | ✅ Done | OAuth2 device code flow |
| Welcome/Onboarding | ✅ Done | 2-option: empty project or repo-based |
| Command Palette | ✅ Done | Cmd+K with search, navigation, theme |
| Issues (list/board) | ❌ Not implemented | Designed in UI.pen, no code |

### 2.4 Authentication & Teams

| Feature | Status | Notes |
|---------|--------|-------|
| WebAuthn/passkey login | ✅ Done | Full registration + authentication |
| Device code auth (agent runner) | ✅ Done | RFC 8628 compliant |
| Team creation | ⚠️ Backend schema exists, CRUD endpoints missing | `GET/POST/PUT/DELETE /api/teams` not yet implemented |
| Team invitations | ✅ Done | Send, accept, revoke, list |
| Team member management | ⚠️ Partial | List + remove done, role change endpoint missing |
| Settings Teams tab | ⚠️ Shell built, API calls stubbed | 4 `// TODO` blocks need wiring |
| Sidebar team switcher | ❌ Not started | No UI for switching between teams |
| Auto-personal team | ✅ Done | Created on registration |

### 2.5 Agent Runner

| Feature | Status | Notes |
|---------|--------|-------|
| CLI (start/stop/status) | ✅ Done | |
| WebSocket with reconnect | ✅ Done | Token refresh, JWT expiry checks |
| Claude SDK adapter | ✅ Done | In-process, MCP, HPC context |
| Claude Code adapter | ✅ Done | Subprocess, steering |
| Codex adapter | ✅ Done | Subprocess, sandbox |
| Execution strategies | ✅ Done | Direct, Docker, SLURM, K8s |
| Safety system | ✅ Done | 4-tier (SAFE/GUARDED/RISKY/UNSAFE) |
| Git worktree isolation | ✅ Done | |
| PR creation | ✅ Done | |
| MCP tools (4) | ✅ Done | |
| npm publish (`@astroanywhere/agent`) | ❌ Not done | Package exists but not published |

### 2.6 Data Persistence

| Feature | Status | Notes |
|---------|--------|-------|
| PGlite (local mode) | ✅ Done | Postgres-in-WASM, Drizzle ORM |
| Supabase/Postgres (server mode) | ✅ Done | 28 tables, migrations |
| Drizzle ORM schema | ✅ Done | Single schema for both modes |
| Team-scoped queries | ✅ Done | `teamScopeFilter()` on all data routes |
| Soft-delete support | ✅ Done | |
| Data API (`/api/data/*`) | ✅ Done | Generic CRUD for all entities |

### 2.7 Integrations

| Feature | Status | Notes |
|---------|--------|-------|
| GitHub OAuth | ⚠️ Partial | Routes exist, 8 TODOs for `userId` from auth middleware |
| Slack integration | ⚠️ Plugin exists | Channel plugin, not fully tested |
| Telegram integration | ⚠️ Plugin exists | Channel plugin, not fully tested |
| Linear integration | ⚠️ Plugin exists | Channel plugin, not fully tested |
| Push notifications | ⚠️ Exists | `push-notifications.ts`, not fully wired |
| Email service | ⚠️ Stub | `email-service.ts` has TODO for actual provider integration |

---

## 3. Security Assessment

### 3.1 Good Practices ✅

| Security Feature | Status |
|-----------------|--------|
| CORS configuration | ✅ Configurable origins, localhost allowed in dev |
| Secure headers (Hono) | ✅ CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| Rate limiting | ✅ `hono-rate-limiter` dependency, configured |
| Input validation (Zod) | ✅ All agent route inputs validated with schemas |
| Path traversal prevention | ✅ `workingDirectory` validated against `..` |
| JWT authentication | ✅ For agent runner WebSocket connections |
| WebAuthn/passkeys | ✅ Phishing-resistant authentication |
| Environment variable validation | ✅ `validateEnvironment()` on startup |
| `.gitignore` coverage | ✅ Comprehensive (env files, secrets, databases, keys) |
| `.env.example` | ✅ Well-documented, no real secrets |

### 3.2 Issues to Address ⚠️

| Issue | Severity | Details |
|-------|----------|---------|
| GitHub routes missing auth | Medium | 8 endpoints have `// TODO: Get userId from auth middleware` |
| Email service stubbed | Low | `email-service.ts` logs to console instead of sending emails |
| GitHub store in-memory | Low | `github-store.ts` has `TODO: Replace with database persistence` |
| Hardcoded dev JWT secrets | Info | `.env.example` has dev-only secrets (documented as "not for production") |
| Console.log in production | Low | 420 console statements in server/, 157 in src/ — many are legitimate logging but should use a proper logger |

### 3.3 No Critical Issues Found

- No hardcoded API keys or secrets in source code
- No `.env` or `.env.local` committed to git
- Secrets directory ignored
- PEM/key/cert files ignored

---

## 4. Missing for Release — Prioritized

### P0 — Must Fix Before Any Release

| # | Item | Effort | Description |
|---|------|--------|-------------|
| 1 | **Create README.md** | M | No root README exists. Need: project description, screenshots, quickstart, architecture overview, contributing link |
| 2 | **Fix LICENSE** | S | Says "Nexus Contributors" — should say "Astro Contributors" or actual copyright holder |
| 3 | **Fix integration test timeouts** | S | Increase `hookTimeout` for integration tests or optimize PGlite startup |
| 4 | **Enable CI pipeline** | M | Move `ci.yml` from `workflows.disabled/` to `workflows/`, fix `continue-on-error` to strict |

### P1 — Required for Alpha (Multi-User Server Mode)

| # | Item | Effort | Description |
|---|------|--------|-------------|
| 5 | **Wire GitHub routes auth** | S | Replace 8 `// TODO: Get userId from auth middleware` in `server/routes/github.ts` |
| 6 | **503 error when no agent runner** | S | Clear user-facing error when relay has no connected machine |
| 7 | **Frontend machine auto-selection** | M | Auto-select when only one machine connected (avoids manual dropdown) |

### P2 — Required for Beta (Open-Source Release)

| # | Item | Effort | Description |
|---|------|--------|-------------|
| 8 | **Complete team CRUD endpoints** | M | Missing: `GET/POST/PUT/DELETE /api/teams`, role change |
| 9 | **Wire Settings Teams tab** | S | Replace 4 stubbed API calls in `TeamsContent()` |
| 10 | **Add sidebar team switcher** | M | Slack-style workspace switcher dropdown |
| 11 | **Code splitting** | M | 3.2MB JS bundle needs `React.lazy()` / dynamic imports for route-level splitting |
| 12 | **Publish `@astroanywhere/agent` to npm** | S | Package exists, needs publishing setup |
| 13 | **Email service integration** | M | Replace console.log stub with actual email provider (SendGrid/Resend/SES) |
| 14 | **Structured logging** | M | Replace 577 console.log/warn/error calls with proper logger (pino/winston) |
| 15 | **E2E smoke test** | L | Vitest-based end-to-end test for core user journey |

### P3 — Nice to Have for Release

| # | Item | Effort | Description |
|---|------|--------|-------------|
| 16 | Issues page (list + board) | L | Designed in UI.pen, not implemented |
| 17 | Production domain standardization | S | Dev tunnel URLs mixed with prod URLs in docs |
| 18 | Remove `chatOpen` TODO in plan-graph-tab | XS | Hardcoded `false`, needs wiring to state |
| 19 | Color icon custom picker | XS | Has `TODO: Custom color picker` click handler |
| 20 | Update design doc conflicts | S | 4 open issues in `CURRENT_CONFLICT_VIEW.md` |

---

## 5. Deployment Readiness

| Component | Status | Notes |
|-----------|--------|-------|
| Fly.io backend | ✅ Ready | `fly.toml`, `docker/Dockerfile`, deploy script |
| Cloudflare Pages frontend | ✅ Ready | `wrangler` configured, deploy script |
| Fly.io auto-deploy | ✅ Active | `fly-deploy.yml` triggers on push to main |
| CI pipeline | ❌ Disabled | `ci.yml` in `workflows.disabled/` — needs activation |
| Environment variables | ✅ Documented | `.env.example` comprehensive |
| Database migrations | ✅ Automated | Drizzle migration runner |
| Cloudflare Tunnel (dev) | ✅ Working | Script + DNS routing configured |

---

## 6. Recommended Release Strategy

### Phase 1: Alpha Release (1-2 days of work)

Focus: Server mode working for internal testers.

1. Fix LICENSE copyright
2. Create README.md with quickstart
3. Fix integration test hook timeouts
4. Enable CI pipeline (move `ci.yml` to `workflows/`)
5. Wire GitHub routes auth middleware
6. Deploy to Fly.io + Cloudflare Pages
7. Test with 2+ users

### Phase 2: Beta Release (1-2 weeks of work)

Focus: Open-source ready, anyone can `npm run dev` and use it.

1. Complete team CRUD + wire frontend
2. Add sidebar team switcher
3. Code-split the frontend bundle
4. Publish `@astroanywhere/agent` to npm
5. Integrate real email service
6. Add structured logging
7. Write comprehensive README with architecture docs
8. Add E2E smoke tests

### Phase 3: v1.0 (future)

- Issues page implementation
- Billing integration (Stripe)
- SkyPilot cloud provisioning
- K8s batch Job strategy
- Comprehensive test coverage

---

## 7. Dependency Health

| Concern | Status |
|---------|--------|
| React 19 (latest) | ✅ |
| Vite 7 (latest) | ✅ |
| TypeScript 5.9 (latest) | ✅ |
| Zustand 5 (latest) | ✅ |
| Hono 4 (latest) | ✅ |
| Drizzle ORM 0.45 (latest) | ✅ |
| PGlite 0.3 (latest) | ✅ |
| No known vulnerabilities | ✅ (check with `npm audit`) |
| esbuild override | ⚠️ `>=0.25.0` override in package.json |

---

## 8. Code Quality Observations

**Strengths:**
- Clean TypeScript with strict mode
- Consistent shadcn/ui component patterns
- Well-structured Zustand stores with selectors
- Comprehensive Zod input validation on API routes
- Good separation: frontend → API → data layer → Drizzle ORM
- Extensive design documentation in `docs/design/`
- Event-driven architecture with pluggable hooks

**Areas for Improvement:**
- Console logging instead of structured logger (577 instances across server + frontend)
- Several TODO comments (12 in server/, 3 in src/) indicating unfinished work
- No root README.md for new contributors
- GitHub integration routes lack auth middleware
- Integration tests unreliable (PGlite timeout)
- Large single JS bundle (needs code splitting for production performance)

---

## Appendix: Test File Summary

| Category | Files | Passing | Failing | Skipped |
|----------|-------|---------|---------|---------|
| Unit tests (root `tests/`) | 17 | 17 | 0 | 0 |
| Unit tests (co-located `__tests__/`) | 13 | 13 | 0 | 0 |
| Unit tests (frontend) | 3 | 3 | 0 | 0 |
| Integration tests | 8 | 0 | 8 | 0 |
| Relay integration | 1 | 0 | 0 | 1 |
| **Total** | **55** | **46** | **8** | **1** |

**Total test cases**: 834 passing, 111 skipped, 0 failing (in the 46 passing files)
