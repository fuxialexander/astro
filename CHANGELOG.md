# Changelog

## [Security Fixes] - 2026-02-15

### 🔒 Security - Critical Fixes (13)
- **CRITICAL-001**: Fixed test token bypass - now requires explicit `NODE_ENV=test` AND `ALLOW_E2E_BYPASS=true`
- **CRITICAL-002**: Enforced JWT secrets in production - server exits if secrets not set
- **CRITICAL-003**: Rotated all production secrets - 3 unique 256-bit secrets generated
- **CRITICAL-004/005**: Fixed git clone command injection - using `execFileSync` with array args
- **CRITICAL-006**: Added global rate limiting - 100 req/15min global, 5 req/15min auth, 10 req/hour AI
- **CRITICAL-007**: Added security headers - CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **CRITICAL-008**: Fixed CORS configuration - explicit allowed origins, no wildcards
- **CRITICAL-009**: Documented IndexedDB as single-user only - added user-switch detection
- **CRITICAL-010**: Documented CSRF protection strategy - stateless JWT tokens (not vulnerable)
- **CRITICAL-011**: Removed tokens from URLs - WebSocket only accepts Authorization header
- **CRITICAL-012**: Added data cleanup scheduler - 90/180 day retention policies
- **CRITICAL-013**: Removed sensitive data from logs - no tokens, sessions, or credentials logged

### 🔒 Security - High Priority Fixes (12)
- **HIGH-001**: Fixed IDOR vulnerabilities - added ownership checks to all project/plan endpoints
- **HIGH-002**: Added authorization to machine endpoints - verify machine ownership
- **HIGH-003**: Added device code brute-force protection - IP and user code rate limiting
- **HIGH-004**: Fixed git fetch injection - projectId validation, execFileSync, disabled hooks
- **HIGH-005**: Added input validation with Zod - schemas for plan generation, chat, dispatch
- **HIGH-006**: Fixed WebSocket authentication - requires JWT in all modes
- **HIGH-007**: Fixed .env permissions - automated script to set 600 permissions
- **HIGH-008**: Verified debug logging - no sensitive data in console.log statements
- **HIGH-009**: Removed token logging - no partial tokens/secrets in logs
- **HIGH-010**: Created .env.example - comprehensive template with security warnings
- **HIGH-011**: Sanitized APNs payloads - generic messages, IDs in encrypted data only
- **HIGH-012**: Implemented APNs authentication - JWT signing with ES256 algorithm

### 🔒 Security - Medium Priority Fixes (7)
- **MEDIUM-001**: Fixed path traversal - validate working directories within ~/.nexus/
- **MEDIUM-002**: Mitigated prompt injection - XML delimiters around user content
- **MEDIUM-003**: Fixed vulnerable dependencies - drizzle-kit updated, esbuild overridden
- **MEDIUM-004**: Added key rotation policy - 90-day rotation schedule documented
- **MEDIUM-005**: Added user data export - GDPR-compliant JSON export endpoint
- **MEDIUM-006**: Added audit logging - comprehensive logging for sensitive operations
- **MEDIUM-007**: Fixed IndexedDB multi-tenancy - user switch detection and warnings

### ✨ New Features
- Environment detection utilities (`server/lib/environment.ts`)
- Automated cleanup scheduler (`server/lib/cleanup-scheduler.ts`)
- Audit logging middleware (`server/middleware/audit.ts`)
- Data export API endpoint (`GET /api/data/export`)
- Environment setup verification script (`scripts/verify-environment-setup.sh`)
- Permission fixing script (`scripts/fix-env-permissions.sh`)

### 📦 Dependencies
- Added: `hono-rate-limiter@0.4.0` - API rate limiting
- Added: `zod@4.3.6` - Input validation schemas
- Updated: `drizzle-kit@0.31.9` - Security patches
- Updated: `esbuild>=0.25.0` - Security patches (via overrides)

### 📝 Documentation
- Created `SECURITY_FIXES_COMPLETE.md` - Comprehensive security fix summary
- Created `ENV_SETUP.md` - Environment setup guide
- Created `SECURITY_AUDIT.md` - Detailed audit report
- Created `DEPLOYMENT_SECURITY_CHECKLIST.md` - Production deployment guide
- Updated `TESTING.md` - Test mode environment variables

### 🔧 Configuration
- Created `.env.example` - Environment variable template
- Created `.env.test` - Test-specific configuration
- Rotated production JWT secrets in `.env`
- Added audit logs table migration (`drizzle/0004_audit_logs.sql`)

### ✅ Verification
- npm audit: **0 vulnerabilities**
- Build: **Success**
- Tests: **All passing with test mode flags**
- OWASP Top 10: **All applicable issues fixed**
- GDPR Compliance: **All requirements met**

---

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **E2E Testing Infrastructure**: Comprehensive end-to-end test suite with 300s timeout and improved completion detection
- Initial project setup with React 19 + Vite + Hono backend
- Multi-provider execution system (Claude Code, Codex, SLURM)
- Real-time task monitoring via SSE streams
- Device authentication flow (OAuth2 RFC 8628)
- Interactive task graph visualization with React Flow
- Project management with vision documents
- Context-aware execution with dependency injection
- User authentication with Supabase
- HPC cluster integration via SLURM
- Distributed task execution with queue management
- **Dual database mode support**: IndexedDB-only mode for local development alongside Supabase multi-user mode
  - Environment variable `USE_INDEXEDDB_ONLY` to force IndexedDB mode
  - Convenience scripts: `npm run dev:indexeddb` and `npm run dev:supabase`
  - Visual mode indicator in sidebar
  - Automatic migration prevention in IndexedDB-only mode
  - Updated documentation for both modes

### Changed
- N/A

### Fixed
- **Worktree File Isolation**: Files now correctly created in worktree directory instead of home directory
  - Added `additionalDirectories` configuration to Claude Agent SDK adapter
  - Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` environment variable
  - Explicitly set process working directory with `process.chdir()`
  - Cleared `settingSources` since worktree is initially empty
- **E2E Test Completion Detection**: Fixed to monitor SSE `event: done` instead of agent logs

### Deprecated
- N/A

### Removed
- N/A

### Fixed
- N/A

### Security
- **CRITICAL**: Fixed git clone command injection vulnerabilities (CRITICAL-004, CRITICAL-005)
  - Replaced `execSync` with `execFileSync` in `server/routes/dispatch.ts` and `server/lib/repo-setup.ts`
  - Git URLs no longer interpreted by shell, preventing command injection via malicious URLs
- **HIGH**: Fixed git fetch command injection and projectId path traversal (HIGH-004)
  - Replaced `execSync` with `execFileSync` for git fetch operations
  - Added regex validation for projectId (alphanumeric, hyphens, underscores only)
  - Disabled git hooks during fetch operations (`-c core.hooksPath=/dev/null`)
- **MEDIUM**: Fixed working directory path traversal vulnerability (MEDIUM-001)
  - Added path validation to ensure working directories are within `~/.nexus/` base
  - Reject paths containing ".." or resolving outside allowed base directory
  - Validated via `path.resolve()` and `path.relative()` checks
- **MEDIUM**: Mitigated prompt injection vulnerabilities (MEDIUM-002)
  - Added XML-style delimiters around all user-provided content in AI prompts
  - Applied to vision documents, task descriptions, repository files, and agent outputs
  - Added security documentation noting remaining risks and validation recommendations
  - Affected functions: `buildPlanSystemPrompt`, `buildChatSystemPrompt`, `buildTaskChatSystemPrompt`, `buildTaskExecutionPrompt`

## [0.0.1] - 2024-02-09

### Added
- Initial project structure
- CI/CD workflows (lint, typecheck, build, test, deploy)
- Development environment setup
- Git hooks with Husky
- EditorConfig and ESLint configuration
- VSCode workspace settings
- Comprehensive documentation (README, CONTRIBUTING)
- GitHub issue templates (bug report, feature request)
- Pull request template
- Setup verification script

[Unreleased]: https://github.com/fuxialexander/nexus/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/fuxialexander/nexus/releases/tag/v0.0.1
