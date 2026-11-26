BEGIN;
CREATE TABLE money_command_journal(user_id uuid NOT NULL REFERENCES workspace_users(id),key uuid NOT NULL,body jsonb NOT NULL,fingerprint text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','rejected')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,key));
ALTER TABLE money_command_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_command_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON money_command_journal USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON money_command_journal TO workspace_app;
ALTER TABLE money_settings ALTER COLUMN rent_amount SET DEFAULT 0,ALTER COLUMN paycheck_amount SET DEFAULT 0,ALTER COLUMN monthly_essentials_budget SET DEFAULT 0,ALTER COLUMN auto_apply_allocation SET DEFAULT false,ALTER COLUMN paycheck_frequency SET DEFAULT 'monthly';
COMMIT;
