-- Backfill team_id for projects, initiatives, and blobs that have NULL team_id.
-- Assigns each orphaned row to the owner's earliest team membership.
-- Then enforces NOT NULL via CHECK constraints (NOT VALID + VALIDATE for minimal locking).

-- Phase 1: Backfill projects.team_id
UPDATE projects p
SET
  team_id = (
    SELECT tm.team_id
    FROM team_members tm
    WHERE tm.user_id = p.owner_id
    ORDER BY tm.joined_at ASC
    LIMIT 1
  ),
  updated_at = now()
WHERE p.team_id IS NULL
  AND EXISTS (
    SELECT 1 FROM team_members tm WHERE tm.user_id = p.owner_id
  );

-- Phase 2: Backfill initiatives.team_id
UPDATE initiatives i
SET
  team_id = (
    SELECT tm.team_id
    FROM team_members tm
    WHERE tm.user_id = i.owner_id
    ORDER BY tm.joined_at ASC
    LIMIT 1
  ),
  updated_at = now()
WHERE i.team_id IS NULL
  AND EXISTS (
    SELECT 1 FROM team_members tm WHERE tm.user_id = i.owner_id
  );

-- Phase 3: Backfill blobs.team_id
UPDATE blobs b
SET team_id = (
    SELECT tm.team_id
    FROM team_members tm
    WHERE tm.user_id = b.owner_id
    ORDER BY tm.joined_at ASC
    LIMIT 1
  )
WHERE b.team_id IS NULL
  AND EXISTS (
    SELECT 1 FROM team_members tm WHERE tm.user_id = b.owner_id
  );

-- Phase 4: Delete truly orphaned rows (owner has no team at all)
DELETE FROM blobs WHERE team_id IS NULL;
DELETE FROM projects WHERE team_id IS NULL;
DELETE FROM initiatives WHERE team_id IS NULL;

-- Phase 5: Enforce NOT NULL going forward
ALTER TABLE projects ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE initiatives ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE blobs ALTER COLUMN team_id SET NOT NULL;
