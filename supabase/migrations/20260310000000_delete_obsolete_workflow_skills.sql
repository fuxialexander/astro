-- Remove obsolete workflow skills from the database.
-- kubernetes-workflow and skypilot-workflow are replaced by compute_backend_default skills.
-- Compute backend skills (k8s-exec, slurm, docker) are loaded selectively when a backend is selected.
DELETE FROM skills WHERE name IN ('kubernetes-workflow', 'skypilot-workflow') AND source = 'builtin';
