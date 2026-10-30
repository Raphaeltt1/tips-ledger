-- Tips Ledger: backend additions for the 13-change update.
-- REVIEW AND RUN IN SUPABASE SQL EDITOR BEFORE PUBLISHING THE NEW WEBSITE.
-- This migration does not alter existing weekly tips, payouts, accounts or roles.
BEGIN;

-- Existing RLS still applies; permit deleting notifications owned by the logged-in user only.
DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.notifications'::pg_catalog.regclass
      AND relrowsecurity = true
  ) THEN
    RAISE EXCEPTION
      'Notifications RLS is not enabled. Review its existing policies before applying this migration.';
  END IF;
END;
$rls$;
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'Users can delete own notifications'
  ) THEN
    EXECUTE $create$
      CREATE POLICY "Users can delete own notifications"
      ON public.notifications FOR DELETE TO authenticated
      USING (recipient_id = (SELECT auth.uid()))
    $create$;
  END IF;
END;
$policy$;
GRANT DELETE ON public.notifications TO authenticated;

-- Preserve the original set_runner_hourly_rate(...) RPC for compatibility.
-- This new RPC uses the Lebanon calendar date automatically: no date input is needed.
-- An existing rate recorded on the same date is updated instead of duplicating it.
-- The existing draft function will only use rates dated on/before its week_start;
-- NO existing weekly tips rows or saved hourly-rate snapshots are modified here.
CREATE OR REPLACE FUNCTION public.set_runner_hourly_rate_today(
  p_runner_id uuid,
  p_hourly_rate numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_effective date := (pg_catalog.now() AT TIME ZONE 'Asia/Beirut')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin or Superuser access required';
  END IF;

  IF p_runner_id IS NULL
     OR p_hourly_rate IS NULL
     OR p_hourly_rate < 0
     OR p_hourly_rate > 100000 THEN
    RAISE EXCEPTION 'Invalid runner or hourly rate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_runner_id
      AND role = 'runner'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Active Runner not found';
  END IF;

  -- Avoid concurrent duplicate entries for this runner on the same date.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_runner_id::text, 0)
  );

  -- An explicitly scheduled future rate must not be silently overwritten.
  IF EXISTS (
    SELECT 1 FROM public.runner_rates
    WHERE runner_id = p_runner_id
      AND effective_from > v_effective
  ) THEN
    RAISE EXCEPTION 'A future-dated hourly rate exists. Please review the rate history first.';
  END IF;

  UPDATE public.runner_rates
  SET hourly_rate = p_hourly_rate
  WHERE runner_id = p_runner_id
    AND effective_from = v_effective;

  IF NOT FOUND THEN
    INSERT INTO public.runner_rates (runner_id, hourly_rate, effective_from)
    VALUES (p_runner_id, p_hourly_rate, v_effective);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_runner_hourly_rate_today(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_runner_hourly_rate_today(uuid, numeric)
TO authenticated;

COMMIT;

-- Optional read-only check after migration:
-- SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
-- AND proname = 'set_runner_hourly_rate_today';
