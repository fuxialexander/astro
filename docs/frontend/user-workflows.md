# User Workflows

Common user journeys through the application.

## Create Project → Generate Plan → Execute Task

1. User creates project (`/projects/new`)
2. AI generates plan (SSE streaming)
3. User navigates to plan view (`/project/:id/plan`)
4. User dispatches task (click play button)
5. Task executes, streams output
6. Results update plan node status

## Related Documentation
- [Data Flows](../backend/data-flows.md)
- [Page Structure](./page-structure.md)
