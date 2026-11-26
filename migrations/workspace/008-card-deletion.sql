BEGIN;
-- Snapshot and bridge tables remain append-only to workspace_app. This one
-- operation can remove only the automatic opening snapshot of an unused card.
CREATE FUNCTION public.delete_unused_main_card(card_id uuid, expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  manual_enabled boolean;
  card public.money_credit_cards%ROWTYPE;
  anchor public.workspace_accounts%ROWTYPE;
  opening_id uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated owner required' USING ERRCODE = '42501';
  END IF;
  SELECT manual INTO manual_enabled FROM public.workspace_features
    WHERE owner_id = actor FOR UPDATE;
  IF manual_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Manual input is disabled' USING ERRCODE = '42501';
  END IF;
  -- Match the application lock order to serialize statement and main commands.
  SELECT * INTO anchor FROM public.workspace_accounts
    WHERE id = card_id AND owner_id = actor FOR UPDATE;
  SELECT * INTO card FROM public.money_credit_cards
    WHERE id = card_id AND user_id = actor FOR UPDATE;
  IF card.id IS NULL THEN
    RAISE EXCEPTION 'Record not found' USING ERRCODE = 'P0002';
  END IF;
  IF expected_version IS NULL OR card.version <> expected_version
     OR (anchor.id IS NOT NULL AND anchor.version <> expected_version) THEN
    RAISE EXCEPTION 'Record changed. Reload before saving' USING ERRCODE = 'P0001';
  END IF;
  IF anchor.id IS NULL OR anchor.kind <> 'credit_card' OR anchor.reported_minor <> 0
     OR NOT EXISTS (SELECT 1 FROM public.money_workspace_cards m
       WHERE m.user_id = actor AND m.card_id = card.id AND m.workspace_account_id = anchor.id)
     OR EXISTS (SELECT 1 FROM public.money_credit_card_charges c
       WHERE c.user_id = actor AND c.card_id = card.id)
     OR EXISTS (SELECT 1 FROM public.money_credit_card_payments p
       WHERE p.user_id = actor AND p.card_id = card.id)
     OR EXISTS (SELECT 1 FROM public.workspace_payments p
       WHERE p.owner_id = actor AND p.account_id = anchor.id)
     OR EXISTS (SELECT 1 FROM public.workspace_pdf_previews p
       WHERE p.owner_id = actor AND p.confirmed_account_id = anchor.id)
     OR EXISTS (SELECT 1 FROM public.money_subscriptions s
       WHERE s.user_id = actor AND lower(s.payment_account_id) = 'cc:' || card.id::text)
     OR (SELECT count(*) FROM public.workspace_snapshots s
       WHERE s.owner_id = actor AND s.account_id = anchor.id) <> 1 THEN
    RAISE EXCEPTION 'Archive cards with balances, financial history or linked subscriptions instead of deleting them'
      USING ERRCODE = 'P0001';
  END IF;
  -- card.create inserts both rows in one transaction using now(). A later
  -- manual review or an adopted statement must never be mistaken for this
  -- automatic opening record, even when its balance happens to be zero.
  SELECT s.id INTO opening_id FROM public.workspace_snapshots s
    WHERE s.owner_id = actor AND s.account_id = anchor.id
      AND s.amount_minor = 0 AND s.as_of = anchor.as_of
      AND s.source = 'manual' AND s.observations IS NULL
      AND s.payment_dispositions = '[]'::jsonb AND s.created_at = card.created_at;
  IF opening_id IS NULL THEN
    RAISE EXCEPTION 'Archive cards with reviewed statement history instead of deleting them'
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.workspace_snapshots WHERE owner_id = actor AND id = opening_id;
  DELETE FROM public.money_workspace_cards WHERE user_id = actor AND money_workspace_cards.card_id = card.id;
  DELETE FROM public.money_credit_cards WHERE user_id = actor AND id = card.id;
  DELETE FROM public.workspace_accounts WHERE owner_id = actor AND id = anchor.id;
  RETURN to_jsonb(card) || jsonb_build_object('version', card.version + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_unused_main_card(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_unused_main_card(uuid, integer) TO workspace_app;
COMMIT;
