-- Run as migration administrator; role passwords are provisioned separately.
CREATE ROLE auth_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE workspace_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE TABLE workspace_users (
 id uuid PRIMARY KEY,
 username text UNIQUE NOT NULL CHECK(username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 password_hash text NOT NULL,
 disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_sessions_user_idx ON workspace_sessions(user_id);
CREATE TABLE workspace_login_limits (
 bucket text PRIMARY KEY,
 window_started_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts>0)
);
REVOKE ALL ON workspace_users,workspace_sessions,workspace_login_limits FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO auth_service,workspace_app;
GRANT SELECT ON workspace_users TO auth_service;
GRANT SELECT,INSERT,DELETE ON workspace_sessions TO auth_service;
GRANT SELECT,INSERT,UPDATE ON workspace_login_limits TO auth_service;
