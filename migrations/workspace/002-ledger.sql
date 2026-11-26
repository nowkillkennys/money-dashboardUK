BEGIN;
CREATE TABLE workspace_accounts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES workspace_users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 kind text NOT NULL CHECK(kind IN ('credit_card','loan','catalogue','bnpl','monthly_fee')),
 reported_minor bigint NOT NULL CHECK(reported_minor BETWEEN 0 AND 9999999999),
 as_of date NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(owner_id,id)
);
CREATE TABLE workspace_payments (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, account_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9999999999),
 status text NOT NULL CHECK(status IN ('posted','pending','voided')),
 disposition text NOT NULL CHECK(disposition IN ('included','excluded','unresolved')),
 paid_on date NOT NULL,
 FOREIGN KEY(owner_id,account_id) REFERENCES workspace_accounts(owner_id,id), UNIQUE(owner_id,id)
);
CREATE TABLE workspace_command_receipts (
 owner_id uuid NOT NULL REFERENCES workspace_users(id), key uuid NOT NULL,
 fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(owner_id,key)
);
CREATE TABLE workspace_pdf_previews (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES workspace_users(id),
 file_hash text NOT NULL, parsed jsonb NOT NULL, expires_at timestamptz NOT NULL,
 confirmed_account_id uuid, UNIQUE(owner_id,file_hash),
 FOREIGN KEY(owner_id,confirmed_account_id) REFERENCES workspace_accounts(owner_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_accounts','workspace_payments','workspace_command_receipts','workspace_pdf_previews'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY owner_only ON %I USING (owner_id = nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (owner_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO workspace_app',t);
 END LOOP;
END $$;
COMMIT;
CREATE TABLE workspace_features(owner_id uuid PRIMARY KEY REFERENCES workspace_users(id),manual boolean NOT NULL DEFAULT true,pdf boolean NOT NULL DEFAULT true);
ALTER TABLE workspace_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_features FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON workspace_features USING(owner_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(owner_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON workspace_features TO workspace_app;
