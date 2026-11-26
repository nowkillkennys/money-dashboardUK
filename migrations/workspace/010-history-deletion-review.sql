BEGIN;
-- Reported statement evidence stays intact after individual history corrections.
-- An explicit reconciliation clears this flag after reviewing the retained records.
ALTER TABLE workspace_accounts ADD COLUMN review_required boolean NOT NULL DEFAULT false;
COMMIT;
