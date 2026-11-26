\getenv auth_password WORKSPACE_AUTH_PASSWORD
\getenv app_password WORKSPACE_APP_PASSWORD
SELECT format('ALTER ROLE auth_service PASSWORD %L', :'auth_password') \gexec
SELECT format('ALTER ROLE workspace_app PASSWORD %L', :'app_password') \gexec
