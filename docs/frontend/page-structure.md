# Page Structure

Complete reference for all pages in the Astro frontend.

## Route Table

| Path | Component | Description | Auth Required |
|------|-----------|-------------|---------------|
| `/` | `dashboard.tsx` | Home dashboard with stats, pending decisions, active projects | Yes |
| `/welcome` | `welcome.tsx` | Onboarding flow (auto-redirect if no projects) | Yes |
| `/login` | `login.tsx` | WebAuthn/passkey authentication | No (public) |
| `/projects` | `projects.tsx` | Project list table | Yes |
| `/projects/new` | `project-new.tsx` | New project form + AI plan generation | Yes |
| `/project/:id` | `project-overview.tsx` | Project overview + updates tabs | Yes |
| `/project/:id/plan` | `plan-view.tsx` | Plan graph canvas + detail panel + chat | Yes |
| `/project/:id/task/:nodeId` | `task-detail.tsx` | Task execution detail (output, tools, files, steer) | Yes |
| `/tasks` | `my-tasks.tsx` | Cross-project task list with filters | Yes |
| `/environments` | `environments.tsx` | Machine registration + SLURM clusters | Yes |
| `/agents` | `agents.tsx` | Agent monitoring | Yes |
| `/initiatives` | `initiatives.tsx` | Initiatives grouping | Yes |
| `/settings` | `settings.tsx` | Backend health + model selection | Yes |
| `/device` | `device-auth.tsx` | Device code OAuth2 flow | No (public) |
| `/landing/` | Static HTML | Marketing landing page | No (public) |
| `/landing/about` | Static HTML | "Why Astro?" philosophy page | No (public) |

## Page Components

See [Component Architecture](./component-architecture.md) for detailed component documentation.

## Related Documentation

- [Routing](./routing.md) - React Router v7 setup
- [Component Architecture](./component-architecture.md) - UI components
- [User Workflows](./user-workflows.md) - Common user journeys
