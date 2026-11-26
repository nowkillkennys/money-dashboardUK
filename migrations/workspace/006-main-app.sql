BEGIN;
create table if not exists money_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  name             text not null,
  type             text not null check (type in ('checking', 'investing')),
  currency         text not null default 'GBP' check (currency in ('GBP','CAD','USD','EGP','EUR')),
  starting_balance numeric(12,2) not null default 0,
  position         integer,
  color            text,
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------
create table if not exists money_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  type            text not null check (type in ('income', 'expense', 'transfer', 'correction')),
  date            date not null default current_date,
  amount          numeric(12,2) not null check (amount >= 0),
  currency        text not null default 'GBP' check (currency in ('GBP','CAD','USD','EGP','EUR')),
  category        text,
  account_id      uuid references money_accounts(id) on delete set null,
  from_account_id uuid references money_accounts(id) on delete set null,
  to_account_id   uuid references money_accounts(id) on delete set null,
  merchant        text,
  notes           text,
  is_recurring    boolean not null default false,
  exclude_from_monthly boolean not null default false,
  personal_share_percent numeric(5,2) not null default 100 check (personal_share_percent >= 0 and personal_share_percent <= 100),
  shared_with text check (shared_with is null or char_length(shared_with) <= 100),
  goal_id         uuid,  -- FK added after money_goals table
  recurrence      text check (recurrence in ('weekly','bi-weekly','monthly','yearly')),
  linked_charge_id uuid,  -- FK added after cc_charges table
  idempotency_key text,
  received_amount numeric(12,2),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------
create table if not exists money_goals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  name              text not null,
  target_amount     numeric(12,2),
  target_date       date,
  linked_account_id uuid references money_accounts(id) on delete set null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Goal <-> Account Links (many-to-many)
-- ---------------------------------------------------------------
create table if not exists money_goal_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  goal_id    uuid not null references money_goals(id) on delete cascade,
  account_id uuid not null references money_accounts(id) on delete cascade,
  allocated_amount numeric(12,2) check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  unique (goal_id, account_id)
);

-- ---------------------------------------------------------------
-- Allocation Plans
-- ---------------------------------------------------------------
create table if not exists money_allocation_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  name        text not null,
  is_active   boolean not null default false,
  allocations jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Settings (single row per user)
-- ---------------------------------------------------------------
create table if not exists money_settings (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique default nullif(current_setting('app.user_id',true),'')::uuid,
  pin_hash                 text,
  base_currency            text not null default 'GBP' check (base_currency in ('GBP','CAD','USD','EGP','EUR')),
  display_name             text not null default 'User',
  greeting_tone            text not null default 'coach',
  expense_categories       jsonb not null default '["Food","Transport","Bills","Rent","Fun","Health","Personal Care","Other"]'::jsonb
                           check (jsonb_typeof(expense_categories) = 'array'),
  subscription_categories  jsonb not null default '["Streaming","Music","Software","Cloud","Gaming","News","Fitness","Food","Finance","Other"]'::jsonb
                           check (jsonb_typeof(subscription_categories) = 'array'),
  rent_amount              numeric(10,2) not null default 0,
  rent_day                 integer not null default 1,
  rent_reminder_days       integer not null default 7 check (rent_reminder_days between 0 and 30),
  bill_reminder_days       integer not null default 3 check (bill_reminder_days between 0 and 30),
  monthly_essentials_budget numeric(10,2) not null default 0,
  paycheck_amount          numeric(10,2) not null default 0,
  paycheck_frequency       text not null default 'monthly' check (paycheck_frequency in ('weekly','bi-weekly','monthly')),
  auto_apply_allocation    boolean not null default false,
  dismissed_merchants      jsonb not null default '[]'::jsonb,
  failed_attempts          integer not null default 0,
  locked_until             timestamptz,
  created_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Stock Holdings
-- ---------------------------------------------------------------
create table if not exists money_holdings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  account_id       uuid not null references money_accounts(id) on delete cascade,
  symbol           text not null,
  shares           numeric(14,6) not null default 0,
  cost_basis       numeric(12,2) not null default 0,
  cost_currency    text not null default 'GBP' check (cost_currency in ('GBP','CAD','USD','EGP','EUR')),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------
create table if not exists money_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  name             text not null,
  amount           numeric(12,2) not null,
  currency         text not null default 'GBP' check (currency in ('GBP','CAD','USD','EGP','EUR')),
  frequency        text not null default 'monthly' check (frequency in ('weekly','bi-weekly','monthly','yearly')),
  category         text,
  next_billing     date not null default current_date,
  is_active        boolean not null default true,
  notes            text,
  payment_account_id text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Dividends
-- ---------------------------------------------------------------
create table if not exists money_dividends (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  holding_id       uuid not null references money_holdings(id) on delete cascade,
  symbol           text not null,
  amount           numeric(12,2) not null,
  currency         text not null default 'GBP' check (currency in ('GBP','CAD','USD','EGP','EUR')),
  date             date not null default current_date,
  notes            text,
  reinvested       boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Web Push Subscriptions
-- ---------------------------------------------------------------
create table if not exists money_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  expires_at  timestamptz,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Notification Logs (dedupe)
-- ---------------------------------------------------------------
create table if not exists money_notification_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  channel     text not null default 'webpush' check (channel in ('webpush')),
  dedupe_key  text not null unique,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Credit Cards
-- ---------------------------------------------------------------
create table if not exists money_credit_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  name             text not null,
  currency         text not null default 'GBP' check (currency in ('GBP','CAD','USD','EGP','EUR')),
  credit_limit     numeric(12,2) not null default 0,
  linked_account_id uuid references money_accounts(id) on delete set null,
  position         integer,
  color            text,
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Credit Card Charges
-- ---------------------------------------------------------------
create table if not exists money_credit_card_charges (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  card_id               uuid not null references money_credit_cards(id) on delete cascade,
  date                  date not null default current_date,
  amount                numeric(12,2) not null check (amount >= 0),
  merchant              text,
  category              text,
  notes                 text,
  linked_transaction_id uuid references money_transactions(id) on delete set null,
  created_at            timestamptz not null default now()
);

-- Bidirectional link: transactions <-> charges
alter table money_transactions
  add constraint fk_transactions_linked_charge
  foreign key (linked_charge_id) references money_credit_card_charges(id) on delete set null;

-- Link transactions to goals (added after money_goals table exists)
alter table money_transactions
  add constraint fk_transactions_goal
  foreign key (goal_id) references money_goals(id) on delete set null;

-- ---------------------------------------------------------------
-- Net Worth Snapshots (one row per user per day; captured server-side)
-- ---------------------------------------------------------------
create table if not exists money_net_worth_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  date            date not null,
  cash_base       numeric(14,2) not null,
  holdings_base   numeric(14,2) not null,
  dividends_base  numeric(14,2) not null,
  total_base      numeric(14,2) not null,
  base_currency   text not null default 'GBP' check(base_currency in ('GBP','EUR','USD','CAD','EGP')),
  created_at      timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_net_worth_snapshots_user_date
  on money_net_worth_snapshots(user_id, date);

-- ---------------------------------------------------------------
-- Credit Card Payments (nullable account_id for cashback/credits)
-- ---------------------------------------------------------------
create table if not exists money_credit_card_payments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default nullif(current_setting('app.user_id',true),'')::uuid,
  card_id          uuid not null references money_credit_cards(id) on delete cascade,
  account_id       uuid references money_accounts(id) on delete set null,
  date             date not null default current_date,
  amount           numeric(12,2) not null check (amount >= 0),
  notes            text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Reconciliation Sessions
-- ---------------------------------------------------------------
create table if not exists money_reconciliation_sessions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null,
  account_id       uuid not null references money_accounts(id) on delete cascade,
  started_at       timestamptz not null default now(),
  date_from        date,
  date_to          date,
  expected_balance numeric(12,2),
  computed_balance numeric(12,2),
  delta            numeric(12,2),
  status           text not null default 'open' check (status in ('open','resolved','cancelled')),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Reconciliation Actions
-- ---------------------------------------------------------------
create table if not exists money_reconciliation_actions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references money_reconciliation_sessions(id) on delete cascade,
  owner_id         uuid not null,
  action_type      text not null check (action_type in ('merge','delete','keep_both','adjust')),
  payload_json     jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

ALTER TABLE money_accounts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_accounts ADD CONSTRAINT money_accounts_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_accounts ADD CONSTRAINT money_accounts_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_accounts USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_accounts TO workspace_app;
ALTER TABLE money_transactions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_transactions ADD CONSTRAINT money_transactions_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_transactions ADD CONSTRAINT money_transactions_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_transactions USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_transactions TO workspace_app;
ALTER TABLE money_goals ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_goals ADD CONSTRAINT money_goals_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_goals ADD CONSTRAINT money_goals_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_goals USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_goals TO workspace_app;
ALTER TABLE money_goal_accounts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_goal_accounts ADD CONSTRAINT money_goal_accounts_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_goal_accounts ADD CONSTRAINT money_goal_accounts_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_goal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_goal_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_goal_accounts USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_goal_accounts TO workspace_app;
ALTER TABLE money_allocation_plans ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_allocation_plans ADD CONSTRAINT money_allocation_plans_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_allocation_plans ADD CONSTRAINT money_allocation_plans_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_allocation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_allocation_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_allocation_plans USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_allocation_plans TO workspace_app;
ALTER TABLE money_settings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_settings ADD CONSTRAINT money_settings_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_settings ADD CONSTRAINT money_settings_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_settings USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_settings TO workspace_app;
ALTER TABLE money_holdings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_holdings ADD CONSTRAINT money_holdings_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_holdings ADD CONSTRAINT money_holdings_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_holdings FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_holdings USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_holdings TO workspace_app;
ALTER TABLE money_subscriptions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_subscriptions ADD CONSTRAINT money_subscriptions_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_subscriptions ADD CONSTRAINT money_subscriptions_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_subscriptions USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_subscriptions TO workspace_app;
ALTER TABLE money_dividends ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_dividends ADD CONSTRAINT money_dividends_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_dividends ADD CONSTRAINT money_dividends_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_dividends FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_dividends USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_dividends TO workspace_app;
ALTER TABLE money_push_subscriptions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_push_subscriptions ADD CONSTRAINT money_push_subscriptions_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_push_subscriptions ADD CONSTRAINT money_push_subscriptions_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_push_subscriptions USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_push_subscriptions TO workspace_app;
ALTER TABLE money_notification_logs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_notification_logs ADD CONSTRAINT money_notification_logs_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_notification_logs ADD CONSTRAINT money_notification_logs_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_notification_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_notification_logs USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_notification_logs TO workspace_app;
ALTER TABLE money_credit_cards ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_credit_cards ADD CONSTRAINT money_credit_cards_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_credit_cards ADD CONSTRAINT money_credit_cards_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_credit_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_credit_cards USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_credit_cards TO workspace_app;
ALTER TABLE money_credit_card_charges ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_credit_card_charges ADD CONSTRAINT money_credit_card_charges_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_credit_card_charges ADD CONSTRAINT money_credit_card_charges_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_credit_card_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_credit_card_charges FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_credit_card_charges USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_credit_card_charges TO workspace_app;
ALTER TABLE money_net_worth_snapshots ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_net_worth_snapshots ADD CONSTRAINT money_net_worth_snapshots_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_net_worth_snapshots ADD CONSTRAINT money_net_worth_snapshots_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_net_worth_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_net_worth_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_net_worth_snapshots USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_net_worth_snapshots TO workspace_app;
ALTER TABLE money_credit_card_payments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_credit_card_payments ADD CONSTRAINT money_credit_card_payments_owner_fk FOREIGN KEY(user_id) REFERENCES workspace_users(id);
ALTER TABLE money_credit_card_payments ADD CONSTRAINT money_credit_card_payments_owner_id_unique UNIQUE(user_id,id);
ALTER TABLE money_credit_card_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_credit_card_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_credit_card_payments USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_credit_card_payments TO workspace_app;
ALTER TABLE money_reconciliation_sessions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_reconciliation_sessions ADD CONSTRAINT money_reconciliation_sessions_owner_fk FOREIGN KEY(owner_id) REFERENCES workspace_users(id);
ALTER TABLE money_reconciliation_sessions ADD CONSTRAINT money_reconciliation_sessions_owner_id_unique UNIQUE(owner_id,id);
ALTER TABLE money_reconciliation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_reconciliation_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_reconciliation_sessions USING (owner_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_reconciliation_sessions TO workspace_app;
ALTER TABLE money_reconciliation_actions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE money_reconciliation_actions ADD CONSTRAINT money_reconciliation_actions_owner_fk FOREIGN KEY(owner_id) REFERENCES workspace_users(id);
ALTER TABLE money_reconciliation_actions ADD CONSTRAINT money_reconciliation_actions_owner_id_unique UNIQUE(owner_id,id);
ALTER TABLE money_reconciliation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_reconciliation_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_reconciliation_actions USING (owner_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (owner_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON money_reconciliation_actions TO workspace_app;
ALTER TABLE money_transactions ADD FOREIGN KEY(user_id,account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_transactions ADD FOREIGN KEY(user_id,from_account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_transactions ADD FOREIGN KEY(user_id,to_account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_goals ADD FOREIGN KEY(user_id,linked_account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_goal_accounts ADD FOREIGN KEY(user_id,goal_id) REFERENCES money_goals(user_id,id);
ALTER TABLE money_goal_accounts ADD FOREIGN KEY(user_id,account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_holdings ADD FOREIGN KEY(user_id,account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_dividends ADD FOREIGN KEY(user_id,holding_id) REFERENCES money_holdings(user_id,id);
ALTER TABLE money_credit_cards ADD FOREIGN KEY(user_id,linked_account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_credit_card_charges ADD FOREIGN KEY(user_id,card_id) REFERENCES money_credit_cards(user_id,id);
ALTER TABLE money_credit_card_charges ADD FOREIGN KEY(user_id,linked_transaction_id) REFERENCES money_transactions(user_id,id);
ALTER TABLE money_credit_card_payments ADD FOREIGN KEY(user_id,card_id) REFERENCES money_credit_cards(user_id,id);
ALTER TABLE money_credit_card_payments ADD FOREIGN KEY(user_id,account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_reconciliation_sessions ADD FOREIGN KEY(owner_id,account_id) REFERENCES money_accounts(user_id,id);
ALTER TABLE money_reconciliation_actions ADD FOREIGN KEY(owner_id,session_id) REFERENCES money_reconciliation_sessions(owner_id,id);
ALTER TABLE money_transactions ADD FOREIGN KEY(user_id,linked_charge_id) REFERENCES money_credit_card_charges(user_id,id);
ALTER TABLE money_transactions ADD FOREIGN KEY(user_id,goal_id) REFERENCES money_goals(user_id,id);
CREATE TABLE money_command_receipts(user_id uuid NOT NULL REFERENCES workspace_users(id), key uuid NOT NULL, fingerprint text NOT NULL,result jsonb NOT NULL, PRIMARY KEY(user_id,key));
ALTER TABLE money_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_command_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_command_receipts USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON money_command_receipts TO workspace_app;
-- Explicit opt-in bridge: no existing personal workspace rows are copied.
CREATE TABLE money_workspace_cards(user_id uuid NOT NULL,card_id uuid NOT NULL,workspace_account_id uuid NOT NULL,PRIMARY KEY(user_id,card_id),UNIQUE(user_id,workspace_account_id),FOREIGN KEY(user_id,card_id) REFERENCES money_credit_cards(user_id,id),FOREIGN KEY(user_id,workspace_account_id) REFERENCES workspace_accounts(owner_id,id));
ALTER TABLE money_workspace_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_workspace_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY main_owner ON money_workspace_cards USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON money_workspace_cards TO workspace_app;
ALTER TABLE money_credit_card_charges ADD COLUMN statement_disposition text NOT NULL DEFAULT 'excluded' CHECK(statement_disposition IN ('included','excluded','unresolved'));
ALTER TABLE money_credit_card_payments ADD COLUMN workspace_payment_id uuid UNIQUE;
COMMIT;
