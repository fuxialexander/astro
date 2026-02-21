-- Add actual execution date tracking to plan_nodes
-- actual_start_date: timestamp of first execution attempt
-- actual_end_date: timestamp of last/final execution

alter table plan_nodes
  add column if not exists actual_start_date timestamptz,
  add column if not exists actual_end_date timestamptz;

-- Index for querying by actual dates
create index if not exists idx_plan_nodes_actual_dates
  on plan_nodes(actual_start_date, actual_end_date);

-- Add comment for documentation
comment on column plan_nodes.actual_start_date is 'Timestamp when task execution first started (from first execution attempt)';
comment on column plan_nodes.actual_end_date is 'Timestamp when task execution completed (from final execution attempt)';
