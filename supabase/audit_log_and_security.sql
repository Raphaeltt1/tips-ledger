-- Tips Ledger audit trail. Run once in Supabase SQL Editor as project owner.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  target_user_id uuid,
  target_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON public.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_id_idx ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT INSERT ON TABLE public.audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;
DROP POLICY IF EXISTS "Admins read audit log" ON public.audit_log;
CREATE POLICY "Admins read audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.write_tips_ledger_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
  v_target_id uuid;
  v_target_name text;
  v_entity_id uuid;
  v_action text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
BEGIN
  SELECT p.full_name, p.role INTO v_actor_name, v_actor_role
  FROM public.profiles p WHERE p.id = v_actor;

  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after := to_jsonb(NEW); END IF;
  v_action := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);

  IF TG_TABLE_NAME = 'weekly_tips' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.published IS DISTINCT FROM NEW.published AND NEW.published = true THEN
        v_action := 'payment.published';
      ELSIF OLD.hours_worked IS DISTINCT FROM NEW.hours_worked
         OR OLD.tips_amount IS DISTINCT FROM NEW.tips_amount
         OR OLD.advances IS DISTINCT FROM NEW.advances THEN
        v_action := 'payment.edited';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      v_action := 'payment.draft_created';
    ELSIF TG_OP = 'DELETE' THEN
      v_action := 'payment.deleted';
    END IF;
  ELSIF TG_TABLE_NAME = 'receipt_confirmations' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.weekly_tip_id ELSE NEW.weekly_tip_id END;
    IF TG_OP = 'INSERT' THEN v_action := 'payment.receipt_confirmed'; END IF;
  ELSIF TG_TABLE_NAME = 'runner_rates' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.runner_id ELSE NEW.runner_id END;
    v_action := 'hourly_rate.' || lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_entity_id := v_target_id;
    v_target_name := CASE WHEN TG_OP = 'DELETE' THEN OLD.full_name ELSE NEW.full_name END;
    v_action := 'employee.' || lower(TG_OP);
  END IF;

  IF v_target_id IS NOT NULL AND v_target_name IS NULL THEN
    SELECT p.full_name INTO v_target_name FROM public.profiles p WHERE p.id = v_target_id;
  END IF;

  INSERT INTO public.audit_log
    (actor_id, actor_name, actor_role, action, entity_type, entity_id,
     target_user_id, target_name, details)
  VALUES
    (v_actor, v_actor_name, v_actor_role, v_action, TG_TABLE_NAME, v_entity_id,
     v_target_id, v_target_name, jsonb_build_object('before', v_before, 'after', v_after));

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_weekly_tips ON public.weekly_tips;
CREATE TRIGGER audit_weekly_tips
AFTER INSERT OR UPDATE OR DELETE ON public.weekly_tips
FOR EACH ROW EXECUTE FUNCTION public.write_tips_ledger_audit();

DROP TRIGGER IF EXISTS audit_receipt_confirmations ON public.receipt_confirmations;
CREATE TRIGGER audit_receipt_confirmations
AFTER INSERT OR UPDATE OR DELETE ON public.receipt_confirmations
FOR EACH ROW EXECUTE FUNCTION public.write_tips_ledger_audit();

DROP TRIGGER IF EXISTS audit_runner_rates ON public.runner_rates;
CREATE TRIGGER audit_runner_rates
AFTER INSERT OR UPDATE OR DELETE ON public.runner_rates
FOR EACH ROW EXECUTE FUNCTION public.write_tips_ledger_audit();

DROP TRIGGER IF EXISTS audit_profiles ON public.profiles;
CREATE TRIGGER audit_profiles
AFTER UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.write_tips_ledger_audit();

-- Explicitly preserve who created a new employee (the Auth Edge Function uses service role).
-- The Edge Function also writes a matching employee.created event after successful creation.
