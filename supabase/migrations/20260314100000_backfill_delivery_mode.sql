-- Backfill deliveryMode for projects that have source info but null deliveryMode.
-- This covers playground-created projects and legacy projects that predate DB storage.
-- Mirrors the frontend's deriveDeliveryMode() logic using source.isGit + source.remoteType.

UPDATE projects
SET delivery_mode = CASE
  WHEN (source->>'isGit')::boolean = false THEN 'direct'
  WHEN source->>'remoteType' IN ('github', 'gitlab', 'bitbucket') THEN 'pr'
  WHEN source->>'remoteType' = 'generic' THEN 'push'
  ELSE 'branch'  -- isGit=true, remoteType='none' or null
END,
updated_at = now()
WHERE delivery_mode IS NULL
  AND source IS NOT NULL
  AND source->>'isGit' IS NOT NULL;
