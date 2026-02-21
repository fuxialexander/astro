# Page Structure

Complete reference for all pages in the Astro frontend.

## Route Table

| Path | Component | Description | Auth Required |
|------|-----------|-------------|---------------|
| `/` | `my-tasks.tsx` | Cross-project task list (index route) | Yes |
| `/dashboard` | `dashboard.tsx` | Stats, pending decisions, active projects, system health | Yes |
| `/welcome` | `welcome.tsx` | Onboarding flow (auto-redirect if no projects) | No (public) |
| `/login` | `login.tsx` | WebAuthn/passkey authentication | No (public) |
| `/invite/:token` | `team-invite.tsx` | Team invitation acceptance flow | No (public) |
| `/projects` | `projects.tsx` | Project list table | Yes |
| `/projects/new` | `project-new.tsx` | New project form + AI plan generation | Yes |
| `/project/:id` | `plan-view.tsx` | Plan view (default graph canvas + detail panel + chat) | Yes |
| `/project/:id/graph` | `plan-view.tsx` | Plan view — graph tab | Yes |
| `/project/:id/list` | `plan-view.tsx` | Plan view — list tab | Yes |
| `/project/:id/timeline` | `plan-view.tsx` | Plan view — timeline tab | Yes |
| `/project/:id/board` | `plan-view.tsx` | Plan view — board tab | Yes |
| `/project/:id/overview` | `plan-view.tsx` | Plan view — overview tab | Yes |
| `/project/:id/task/:nodeId` | `task-detail.tsx` | Task execution detail (output, tools, files, steer) | Yes |
| `/tasks` | `my-tasks.tsx` | Cross-project task list with filters | Yes |
| `/initiatives` | `initiatives.tsx` | Initiatives grouping | Yes |
| `/agents` | `agents.tsx` | Agent monitoring | Yes |
| `/environments` | `environments.tsx` | Machine registration + SLURM clusters | Yes |
| `/workflows` | `workflows.tsx` | Workflow guide (working modes, use cases) | Yes |
| `/settings` | `settings.tsx` | Backend health + model selection | Yes |
| `/plugins/*` | `PluginRoutes` | Dynamic plugin-contributed routes | Yes |
| `/device` | `device-auth.tsx` | Device code OAuth2 flow | No (public) |
| `/landing/` | Static HTML | Marketing landing page | No (public) |
| `/landing/about` | Static HTML | "Why Astro?" philosophy page | No (public) |

## Page Components

See [Component Architecture](./component-architecture.md) for detailed component documentation.

## Related Documentation

- [Routing](./routing.md) - React Router v7 setup
- [Component Architecture](./component-architecture.md) - UI components
- [User Workflows](./user-workflows.md) - Common user journeys
