# UK adaptation of Money Dashboard

The selected application base is the user's adaptation repository, https://github.com/nowkillkennys/money-dashboardUK. Original upstream: https://github.com/NightBaRron1412/money-dashboard. The repository is now standalone after the user detached it from the fork network; original upstream attribution and MIT notices remain. The integrated application is on `main`. See the current [main README](README.md) and [integration handover](docs/uk/main-app-integration.md).

The former Debt Tracker and secure-manual implementation remain separate, with their data untouched. This document retains the isolated synthetic demo setup; it is not the authenticated application's getting-started guide.

Read [product migration plan](docs/uk/product-migration-plan.md), [upstream security review](docs/uk/upstream-security-review.md), [requirements](claude.md) and [executed verification](docs/uk/verification.md).

## Main application continuation

The user approved the base/interface and continuation. The original main application now runs at http://127.0.0.1:13022/ with username/password authentication, per-user PostgreSQL persistence, native bank/card/transaction commands and integrated debt/PDF review. See [main-app integration](docs/uk/main-app-integration.md) for the connected slice and remaining adapters. See [setup and boundaries](docs/uk/authenticated-foundation.md) and [executed evidence](docs/uk/authenticated-verification.md). No personal credentials are shipped; provisioning reads a chosen password via stdin. The broader demo below remains separate. Bank/card spending is connected in the current slice; remaining adapters, backups/recovery, retention and real-data adoption gates are detailed in the integration handover.

## Local preview

```sh
docker compose -f compose.uk.yml build
docker compose -f compose.uk.yml up -d --wait
```

Open http://localhost:13021/demo. Sample edits are in-memory and reset on reload. Never enter real account, statement, identity or password data here. No Supabase credentials, AI keys or financial connections are configured. The UK_DEMO_ONLY proxy blocks persistence/auth/AI/push endpoints; stock quotes are empty offline responses and FX is explicitly synthetic. The application has only an internal Docker network; a non-root Nginx ingress exposes a fixed proxy at 127.0.0.1:13021. Browser CSP provides an additional boundary. This evaluation guard does not fix upstream production authentication.

Dependencies install from the pinned lock with `--ignore-scripts`. The Next build runs without network. The application runtime is non-root, read-only except temporary cache and has no mounted host files or credentials. The ingress mounts only its static proxy configuration. Google font downloading/service-worker registration/voice capture/notification setup/AI chat and canned AI advice are disabled in the evaluation build. No cloud provisioning, public deployment, migration of user records or provider agreement is implied.

The original MIT licence and copyright notice in [LICENSE](LICENSE) are retained unchanged. Third-party packages, logos, fonts and other assets need their own review before distribution; see the inventory in the security review. This repository is not affiliated with the discontinued Money Dashboard service.
