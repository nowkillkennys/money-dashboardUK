BEGIN;
-- Refund totals are derived at read time; clients never write a cached total.
ALTER TABLE public.money_transactions
 ADD COLUMN refund_of_transaction_id uuid,
 ADD CONSTRAINT money_transaction_refund_owner_fk FOREIGN KEY(user_id,refund_of_transaction_id) REFERENCES public.money_transactions(user_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT money_transaction_refund_income CHECK(refund_of_transaction_id IS NULL OR type='income');
ALTER TABLE public.money_credit_card_payments
 ADD COLUMN refund_of_transaction_id uuid,
 ADD CONSTRAINT money_payment_refund_owner_fk FOREIGN KEY(user_id,refund_of_transaction_id) REFERENCES public.money_transactions(user_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT money_payment_refund_credit CHECK(refund_of_transaction_id IS NULL OR account_id IS NULL);
CREATE INDEX money_transaction_refunds_idx ON public.money_transactions(user_id,refund_of_transaction_id) WHERE refund_of_transaction_id IS NOT NULL;
CREATE INDEX money_card_refunds_idx ON public.money_credit_card_payments(user_id,refund_of_transaction_id) WHERE refund_of_transaction_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.main_card_removal_state(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
 WITH actor AS (SELECT nullif(current_setting('app.user_id',true),'')::uuid AS id),
 charges AS (SELECT c.* FROM public.money_credit_card_charges c,actor a WHERE c.user_id=a.id AND c.card_id=target)
 SELECT jsonb_build_object(
 'card',(SELECT to_jsonb(c) FROM public.money_credit_cards c,actor a WHERE c.user_id=a.id AND c.id=target),
 'anchor',(SELECT to_jsonb(c) FROM public.workspace_accounts c,actor a WHERE c.owner_id=a.id AND c.id=target),
 'bridge',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.card_id) FROM public.money_workspace_cards c,actor a WHERE c.user_id=a.id AND c.card_id=target),
 'charges',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM charges c),'[]'::jsonb),
 'expenses',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.money_transactions t,actor a WHERE t.user_id=a.id AND (t.linked_charge_id IN(SELECT id FROM charges) OR t.id IN(SELECT linked_transaction_id FROM charges))),'[]'::jsonb),
 'bankRefunds',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.money_transactions r,actor a WHERE r.user_id=a.id AND r.refund_of_transaction_id IN (SELECT t.id FROM public.money_transactions t WHERE t.user_id=a.id AND (t.linked_charge_id IN(SELECT id FROM charges) OR t.id IN(SELECT linked_transaction_id FROM charges)))),'[]'::jsonb),
 'externalCardRefunds',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.money_credit_card_payments r,actor a WHERE r.user_id=a.id AND r.card_id<>target AND r.refund_of_transaction_id IN (SELECT t.id FROM public.money_transactions t WHERE t.user_id=a.id AND (t.linked_charge_id IN(SELECT id FROM charges) OR t.id IN(SELECT linked_transaction_id FROM charges)))),'[]'::jsonb),
 'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.money_credit_card_payments p,actor a WHERE p.user_id=a.id AND p.card_id=target),'[]'::jsonb),
 'workspacePayments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.workspace_payments p,actor a WHERE p.owner_id=a.id AND p.account_id=target),'[]'::jsonb),
 'snapshots',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.workspace_snapshots s,actor a WHERE s.owner_id=a.id AND s.account_id=target),'[]'::jsonb),
 'pdfImports',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.workspace_pdf_previews p,actor a WHERE p.owner_id=a.id AND p.confirmed_account_id=target),'[]'::jsonb),
 'subscriptions',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.money_subscriptions s,actor a WHERE s.user_id=a.id AND lower(s.payment_account_id)='cc:'||target::text),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.main_card_removal_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.main_card_removal_state(uuid) TO workspace_app;

CREATE OR REPLACE FUNCTION public.permanently_delete_main_card(target uuid, expected_version integer, confirmation_name text, preview_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
 actor uuid := nullif(current_setting('app.user_id',true),'')::uuid;
 card public.money_credit_cards%ROWTYPE;
 anchor public.workspace_accounts%ROWTYPE;
 state jsonb;
 expense_ids uuid[];
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated owner required' USING ERRCODE='42501'; END IF;
 IF (SELECT manual FROM public.workspace_features WHERE owner_id=actor FOR UPDATE) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Manual input is disabled' USING ERRCODE='42501';
 END IF;
 SELECT * INTO anchor FROM public.workspace_accounts WHERE id=target AND owner_id=actor FOR UPDATE;
 SELECT * INTO card FROM public.money_credit_cards WHERE id=target AND user_id=actor FOR UPDATE;
 IF card.id IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;
 IF expected_version IS NULL OR card.version<>expected_version OR anchor.version<>expected_version THEN
  RAISE EXCEPTION 'Record changed. Reload before saving' USING ERRCODE='P0001';
 END IF;
 IF confirmation_name IS DISTINCT FROM card.name THEN RAISE EXCEPTION 'Enter the exact card name' USING ERRCODE='22023'; END IF;
 IF anchor.id IS NULL OR anchor.kind<>'credit_card' OR NOT EXISTS(SELECT 1 FROM public.money_workspace_cards WHERE user_id=actor AND card_id=target AND workspace_account_id=target) THEN
  RAISE EXCEPTION 'Card statement identity is missing' USING ERRCODE='P0001';
 END IF;
 state := public.main_card_removal_state(target);
 IF preview_token IS NULL OR preview_token<>encode(sha256(convert_to(state::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Card removal details changed. Reload the preview' USING ERRCODE='P0001';
 END IF;
 IF jsonb_array_length(state->'externalCardRefunds') > 0 THEN
  RAISE EXCEPTION 'Unlink refunds on another card before removing this card' USING ERRCODE='P0001';
 END IF;
 SELECT array_agg((e->>'id')::uuid) INTO expense_ids FROM jsonb_array_elements(state->'expenses') e;
 -- Preserve bank-funded repayments as outgoing transfers, never expenses.
 -- A rare ID collision gets a fresh identity; no existing transaction is overwritten.
 INSERT INTO public.money_transactions(id,user_id,type,date,amount,currency,from_account_id,merchant,notes,created_at,preserved_card_payment)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.money_transactions t WHERE t.id=p.id) THEN gen_random_uuid() ELSE p.id END,
 actor,'transfer',p.date,p.amount,card.currency,p.account_id,
 'Payment to removed card: '||card.name,
 'Preserved bank payment after permanent card removal.'||CASE WHEN p.notes IS NULL THEN '' ELSE ' Original note: '||p.notes END,p.created_at,true
 FROM public.money_credit_card_payments p WHERE p.user_id=actor AND p.card_id=target AND p.account_id IS NOT NULL;
 -- Cash already received in a bank remains in the ledger after its purchase is removed.
 UPDATE public.money_transactions SET refund_of_transaction_id=NULL,version=version+1
 WHERE user_id=actor AND refund_of_transaction_id=ANY(expense_ids);
 -- Remove card refunds before the original expenses to satisfy restrictive refund links.
 DELETE FROM public.money_credit_card_payments WHERE user_id=actor AND card_id=target;
 -- Break the bidirectional charge/expense links before deleting either side.
 UPDATE public.money_credit_card_charges SET linked_transaction_id=NULL WHERE user_id=actor AND card_id=target;
 UPDATE public.money_transactions SET linked_charge_id=NULL WHERE user_id=actor AND linked_charge_id IN(SELECT id FROM public.money_credit_card_charges WHERE user_id=actor AND card_id=target);
 DELETE FROM public.money_transactions WHERE user_id=actor AND id=ANY(expense_ids);
 DELETE FROM public.money_credit_card_charges WHERE user_id=actor AND card_id=target;
 DELETE FROM public.money_credit_card_payments WHERE user_id=actor AND card_id=target;
 UPDATE public.money_subscriptions SET payment_account_id=NULL,version=version+1 WHERE user_id=actor AND lower(payment_account_id)='cc:'||target::text;
 DELETE FROM public.workspace_pdf_previews WHERE owner_id=actor AND confirmed_account_id=target;
 DELETE FROM public.workspace_snapshots WHERE owner_id=actor AND account_id=target;
 DELETE FROM public.workspace_payments WHERE owner_id=actor AND account_id=target;
 DELETE FROM public.money_workspace_cards WHERE user_id=actor AND card_id=target;
 DELETE FROM public.money_credit_cards WHERE user_id=actor AND id=target;
 DELETE FROM public.workspace_accounts WHERE owner_id=actor AND id=target;
 -- Aggregate net-worth history and both command receipt tables intentionally survive.
 RETURN to_jsonb(card)||jsonb_build_object('version',card.version+1);
END;
$$;
REVOKE ALL ON FUNCTION public.permanently_delete_main_card(uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.permanently_delete_main_card(uuid,integer,text,text) TO workspace_app;
COMMIT;
