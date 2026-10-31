-- Team Member role expansion for Tips Ledger. Additive to existing records.
-- Legacy SQL columns (runner_id, runner_rates) and RPC names remain unchanged to
-- preserve existing payments, notifications and integrations.
-- Existing 'runner' accounts retain identical permissions.

ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
 CHECK (role IN ('superuser','admin','manager','runner','host_hostess','counter','expo','kitchen_crew'));

-- Preserve RLS restrictions: only team members see their own published tips,
-- own rates/confirmations. Managers can see active team member profiles.
DROP POLICY "Manager reads active runner profiles" ON public.profiles;
CREATE POLICY "Manager reads active team member profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role())='manager'
    AND role IN ('runner','host_hostess','counter','expo','kitchen_crew') AND active = true);

DROP POLICY "Runner reads own published tips" ON public.weekly_tips;
CREATE POLICY "Team member reads own published tips" ON public.weekly_tips
 FOR SELECT TO authenticated
 USING (runner_id=(SELECT auth.uid()) AND published=true
   AND (SELECT public.current_user_role()) IN ('runner','host_hostess','counter','expo','kitchen_crew'));

DROP POLICY "Runner reads own rates" ON public.runner_rates;
CREATE POLICY "Team member reads own rates" ON public.runner_rates
 FOR SELECT TO authenticated
 USING (runner_id=(SELECT auth.uid())
   AND (SELECT public.current_user_role()) IN ('runner','host_hostess','counter','expo','kitchen_crew'));

DROP POLICY "Runner reads own confirmations" ON public.receipt_confirmations;
CREATE POLICY "Team member reads own confirmations" ON public.receipt_confirmations
 FOR SELECT TO authenticated
 USING (runner_id=(SELECT auth.uid())
   AND (SELECT public.current_user_role()) IN ('runner','host_hostess','counter','expo','kitchen_crew'));

DROP POLICY "Runner confirms own published payout" ON public.receipt_confirmations;
CREATE POLICY "Team member confirms own published payout" ON public.receipt_confirmations
 FOR INSERT TO authenticated
 WITH CHECK (runner_id=(SELECT auth.uid())
   AND (SELECT public.current_user_role()) IN ('runner','host_hostess','counter','expo','kitchen_crew')
   AND EXISTS(SELECT 1 FROM public.weekly_tips w WHERE w.id=weekly_tip_id
     AND w.runner_id=(SELECT auth.uid()) AND w.published=true));

-- Preserves original function name and parameter signature: admin_permanently_delete_employee
CREATE OR REPLACE FUNCTION public.admin_permanently_delete_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_role text;
  v_target_role text;
BEGIN
  v_actor_role := public.current_user_role();
  IF v_actor_role NOT IN ('superuser','admin') THEN
    RAISE EXCEPTION 'Only a Superuser or Admin can permanently delete employees';
  END IF;

  IF p_employee_id IS NULL
     OR p_employee_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'You cannot permanently delete yourself';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF v_target_role = 'superuser'
     OR (v_actor_role = 'admin' AND v_target_role NOT IN ('runner','host_hostess','counter','expo','kitchen_crew','manager'))
     OR (v_actor_role = 'superuser' AND v_target_role NOT IN ('runner','host_hostess','counter','expo','kitchen_crew','manager','admin')) THEN
    RAISE EXCEPTION 'Your role cannot permanently delete this employee';
  END IF;

  -- Protects published payments except during authorized permanent deletion.
  PERFORM pg_catalog.set_config('app.allow_permanent_runner_delete','on',true);

  DELETE FROM public.receipt_confirmations
  WHERE runner_id = p_employee_id
     OR weekly_tip_id IN (
       SELECT id FROM public.weekly_tips WHERE runner_id = p_employee_id
     );

  DELETE FROM public.weekly_tips
  WHERE runner_id = p_employee_id;

  DELETE FROM public.runner_rates
  WHERE runner_id = p_employee_id;

  DELETE FROM public.notifications
  WHERE recipient_id = p_employee_id;

  DELETE FROM public.push_subscriptions
  WHERE user_id = p_employee_id;

  -- The Edge Function subsequently deletes the Auth login, which cascades
  -- the profile. Audit-log rows are intentionally preserved.
END;
$function$
;

-- Preserves original function name and parameter signature: admin_permanently_delete_runner
CREATE OR REPLACE FUNCTION public.admin_permanently_delete_runner(p_runner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_runner_name text;
BEGIN
  IF public.current_user_role()
     NOT IN ('admin', 'superuser') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_runner_id IS NULL OR p_runner_id = auth.uid() THEN
    RAISE EXCEPTION 'Invalid runner';
  END IF;

  SELECT full_name INTO v_runner_name
  FROM public.profiles
  WHERE id = p_runner_id
    AND role IN ('runner', 'host_hostess', 'counter', 'expo', 'kitchen_crew', 'manager');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  PERFORM set_config(
    'app.allow_permanent_runner_delete', 'on', true
  );

  DELETE FROM public.receipt_confirmations
  WHERE runner_id = p_runner_id
     OR weekly_tip_id IN (
       SELECT id FROM public.weekly_tips
       WHERE runner_id = p_runner_id
     );

  DELETE FROM public.weekly_tips
  WHERE runner_id = p_runner_id;

  DELETE FROM public.runner_rates
  WHERE runner_id = p_runner_id;

  DELETE FROM public.push_subscriptions
  WHERE user_id = p_runner_id;

  DELETE FROM public.notifications
  WHERE recipient_id = p_runner_id
     OR body = 'Team member ' ||
       coalesce(v_runner_name, 'Unknown') ||
       ' confirmed receiving their weekly payment.';
END;
$function$
;

-- Preserves original function name and parameter signature: create_weekly_tips_draft
CREATE OR REPLACE FUNCTION public.create_weekly_tips_draft(p_runner_id uuid, p_week_start date, p_hours numeric, p_tips numeric, p_advances numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rate numeric(12,2);
  v_record_id uuid;
BEGIN
  IF public.current_user_role()
     NOT IN ('superuser', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_runner_id
      AND role IN ('runner','host_hostess','counter','expo','kitchen_crew')
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Team member not found or inactive';
  END IF;

  IF p_week_start IS NULL
     OR p_hours IS NULL OR p_hours < 0
     OR p_tips IS NULL OR p_tips < 0
     OR p_advances IS NULL OR p_advances < 0
     OR p_advances > p_tips THEN
    RAISE EXCEPTION 'Invalid weekly tips values';
  END IF;

  SELECT hourly_rate INTO v_rate
  FROM public.runner_rates
  WHERE runner_id = p_runner_id
    AND effective_from <= p_week_start
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Team member hourly rate is not configured';
  END IF;

  INSERT INTO public.weekly_tips (
    runner_id, week_start, hours_worked,
    hourly_rate, tips_amount, advances, published
  )
  VALUES (
    p_runner_id, p_week_start, p_hours,
    v_rate, p_tips, p_advances, false
  )
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$function$
;

-- Preserves original function name and parameter signature: notify_payment_received
CREATE OR REPLACE FUNCTION public.notify_payment_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  runner_name text;
  admin_record record;
BEGIN
  SELECT full_name INTO runner_name
  FROM public.profiles
  WHERE id = NEW.runner_id;

  FOR admin_record IN
    SELECT id
    FROM public.profiles
    WHERE role IN ('admin', 'superuser')
      AND active = true
  LOOP
    INSERT INTO public.notifications (
      recipient_id, title, body
    )
    VALUES (
      admin_record.id,
      '✅ Payment Received',
      'Team member ' || coalesce(runner_name, 'Unknown') ||
      ' confirmed receiving their weekly payment.'
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

-- Preserves original function name and parameter signature: set_employee_active
CREATE OR REPLACE FUNCTION public.set_employee_active(p_employee_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_role text;
  v_target_role text;
BEGIN
  v_actor_role := public.current_user_role();
  IF v_actor_role NOT IN ('superuser','admin') THEN
    RAISE EXCEPTION 'Only a Superuser or Admin can manage employees';
  END IF;

  IF p_employee_id IS NULL OR p_active IS NULL
     OR p_employee_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Invalid employee, status, or self-management attempt';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF v_target_role = 'superuser'
     OR (v_actor_role = 'admin' AND v_target_role NOT IN ('runner','host_hostess','counter','expo','kitchen_crew','manager'))
     OR (v_actor_role = 'superuser' AND v_target_role NOT IN ('runner','host_hostess','counter','expo','kitchen_crew','manager','admin')) THEN
    RAISE EXCEPTION 'Your role cannot manage this employee';
  END IF;

  UPDATE public.profiles SET active = p_active
  WHERE id = p_employee_id;
  -- The existing audit trigger records employee.activated / employee.deactivated.
END;
$function$
;

-- Preserves original function name and parameter signature: set_runner_active
CREATE OR REPLACE FUNCTION public.set_runner_active(p_runner_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_runner_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'Invalid employee or status';
  END IF;

  UPDATE public.profiles
  SET active = p_active
  WHERE id = p_runner_id
    AND role IN ('runner','host_hostess','counter','expo','kitchen_crew');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team member not found';
  END IF;
END;
$function$
;

-- Preserves original function name and parameter signature: set_runner_hourly_rate
CREATE OR REPLACE FUNCTION public.set_runner_hourly_rate(p_runner_id uuid, p_hourly_rate numeric, p_effective_from date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_hourly_rate IS NULL OR p_hourly_rate < 0
     OR p_effective_from IS NULL THEN
    RAISE EXCEPTION 'Invalid rate or effective date';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_runner_id
      AND role IN ('runner','host_hostess','counter','expo','kitchen_crew')
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Active team member not found';
  END IF;

  INSERT INTO public.runner_rates
    (runner_id, hourly_rate, effective_from)
  VALUES
    (p_runner_id, p_hourly_rate, p_effective_from);
END;
$function$
;

-- Preserves original function name and parameter signature: set_runner_hourly_rate_today
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
     OR p_hourly_rate > 100000 THEN
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
$function$
;
