ALTER TABLE workspace_snapshots ADD COLUMN payment_dispositions jsonb NOT NULL DEFAULT '[]';
