-- Remove celltype catalog skills from the database.
-- These skills should only be injected via template recommendedSkills, not stored globally.
DELETE FROM skills WHERE name LIKE 'celltype-%';
