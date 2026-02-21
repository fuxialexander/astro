# Plan Graph

React Flow graph visualization.

## Overview

Plan graph is a directed acyclic graph (DAG) rendered with @xyflow/react.

## Components
- `plan-canvas.tsx` - React Flow wrapper
- `task-node.tsx` - Custom node component
- `deletable-edge.tsx` - Custom edge with hover-to-delete button (smooth step path, X icon at midpoint)
- `plan-graph-tab.tsx` - Graph view tab
- `plan-timeline-tab.tsx` - Gantt timeline view

## Related Documentation
- [Component Architecture](./component-architecture.md)
- [Database Schema](../backend/database-schema.md) - `plan_nodes`, `plan_edges` tables
