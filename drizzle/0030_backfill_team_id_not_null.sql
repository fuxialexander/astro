-- Backfill NULL team_id rows using owner's earliest team membership
UPDATE projects p
SET team_id = (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = p.owner_id
    ORDER BY tm.joined_at ASC LIMIT 1
  ),
  updated_at = now()
WHERE p.team_id IS NULL
  AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = p.owner_id);

UPDATE initiatives i
SET team_id = (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = i.owner_id
    ORDER BY tm.joined_at ASC LIMIT 1
  ),
  updated_at = now()
WHERE i.team_id IS NULL
  AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = i.owner_id);

UPDATE blobs b
SET team_id = (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = b.owner_id
    ORDER BY tm.joined_at ASC LIMIT 1
  )
WHERE b.team_id IS NULL
  AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = b.owner_id);

-- Clean up orphaned rows
DELETE FROM blobs WHERE team_id IS NULL;
DELETE FROM projects WHERE team_id IS NULL;
DELETE FROM initiatives WHERE team_id IS NULL;

-- Enforce NOT NULL
ALTER TABLE projects ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE initiatives ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE blobs ALTER COLUMN team_id SET NOT NULL;
