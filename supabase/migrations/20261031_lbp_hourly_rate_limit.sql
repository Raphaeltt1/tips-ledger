-- Extend existing validated hourly-rate entry to LBP amounts, without modifying stored data.
-- Preserve existing privileges, role checks and concurrency behavior.
CREATE OR REPLACE FUNCTION public.set_runner_hourly_rate_today(p_runner_id uuid, p_hourly_rate numeric)
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
     OR p_hourly_rate > 100000000 THEN
    RAISE EXCEPTION 'Invalid team member or hourly rate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_runner_id
      AND role IN ('runner','host_hostess','counter','expo','kitchen_crew')
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Active Team member not found';
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

REVOKE ALL ON FUNCTION public.set_runner_hourly_rate_today(uuid,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_runner_hourly_rate_today(uuid,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_runner_hourly_rate_today(uuid,numeric) TO authenticated;
