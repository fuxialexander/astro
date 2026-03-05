-- Add compute_backends column to projects table
-- Stores the selected compute backends (e.g., ['k8s-exec', 'slurm']) at the project level.
-- All tasks inherit the project's compute backends. Empty array means no backend-specific
-- skills or environment context are injected (lean default).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS compute_backends text[] DEFAULT '{}';
