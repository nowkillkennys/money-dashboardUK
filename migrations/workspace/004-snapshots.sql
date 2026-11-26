CREATE TABLE workspace_snapshots(
 id uuid PRIMARY KEY,owner_id uuid NOT NULL,account_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 9999999999),
 as_of date NOT NULL,source text NOT NULL CHECK(source IN ('manual','pdf')),
 observations jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,account_id) REFERENCES workspace_accounts(owner_id,id)
);
ALTER TABLE workspace_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON workspace_snapshots USING(owner_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(owner_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON workspace_snapshots TO workspace_app;
