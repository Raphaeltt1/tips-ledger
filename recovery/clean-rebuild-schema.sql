-- Tips Ledger stable release: EMPTY-DATABASE REBUILD SCHEMA (2026-10-31)
-- Extracted from live public schema; no user accounts, payments, audit rows or secrets.
-- Requires NEW Supabase project with built-in auth.users, roles, auth.uid().
-- NEVER RUN THIS SCRIPT ON THE LIVE PROJECT; it is for an empty replacement.
-- Verified as source snapshot only; a full blank-project restore test is pending.
-- Stable working release commit: f8991407d81dd174e2316631cc1dd754cef51d61
BEGIN;
SET LOCAL search_path TO public, extensions, pg_catalog;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;


-- 1. Create seven empty app tables.

CREATE TABLE public."profiles" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "role" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."audit_log" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor_id" uuid,
  "actor_name" text,
  "actor_role" text,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "target_user_id" uuid,
  "target_name" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public."runner_rates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "runner_id" uuid NOT NULL,
  "hourly_rate" numeric(12,2) NOT NULL,
  "effective_from" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."weekly_tips" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "runner_id" uuid NOT NULL,
  "week_start" date NOT NULL,
  "hours_worked" numeric(10,2) DEFAULT 0 NOT NULL,
  "hourly_rate" numeric(12,2) NOT NULL,
  "tips_amount" numeric(12,2) DEFAULT 0 NOT NULL,
  "advances" numeric(12,2) DEFAULT 0 NOT NULL,
  "published" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "net_payout" numeric(12,2) GENERATED ALWAYS AS (round((tips_amount - advances), 2)) STORED
);

CREATE TABLE public."receipt_confirmations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "weekly_tip_id" uuid NOT NULL,
  "runner_id" uuid NOT NULL,
  "confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);

CREATE TABLE public."push_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "subscription" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 2. Restore primary keys, unique checks and foreign keys.

ALTER TABLE public."audit_log" ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY (id);

ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['superuser'::text, 'admin'::text, 'manager'::text, 'runner'::text])));

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);

ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id);

ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE (endpoint);

ALTER TABLE public."receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_pkey" PRIMARY KEY (id);

ALTER TABLE public."receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_weekly_tip_id_key" UNIQUE (weekly_tip_id);

ALTER TABLE public."runner_rates" ADD CONSTRAINT "runner_rates_hourly_rate_check" CHECK ((hourly_rate >= (0)::numeric));

ALTER TABLE public."runner_rates" ADD CONSTRAINT "runner_rates_pkey" PRIMARY KEY (id);

ALTER TABLE public."runner_rates" ADD CONSTRAINT "runner_rates_runner_id_effective_from_key" UNIQUE (runner_id, effective_from);

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_advances_check" CHECK ((advances >= (0)::numeric));

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_hourly_rate_check" CHECK ((hourly_rate >= (0)::numeric));

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_hours_worked_check" CHECK ((hours_worked >= (0)::numeric));

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_tips_amount_check" CHECK ((tips_amount >= (0)::numeric));

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_pkey" PRIMARY KEY (id);

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "unique_runner_week" UNIQUE (runner_id, week_start);

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_runner_id_week_start_key" UNIQUE (runner_id, week_start);

ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_runner_id_fkey" FOREIGN KEY (runner_id) REFERENCES profiles(id);

ALTER TABLE public."receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_weekly_tip_id_fkey" FOREIGN KEY (weekly_tip_id) REFERENCES weekly_tips(id);

ALTER TABLE public."runner_rates" ADD CONSTRAINT "runner_rates_runner_id_fkey" FOREIGN KEY (runner_id) REFERENCES profiles(id);

ALTER TABLE public."weekly_tips" ADD CONSTRAINT "weekly_tips_runner_id_fkey" FOREIGN KEY (runner_id) REFERENCES profiles(id);

-- 3. Restore additional indexes.

CREATE INDEX audit_log_actor_id_idx ON public.audit_log USING btree (actor_id);

CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id);

CREATE INDEX audit_log_occurred_at_idx ON public.audit_log USING btree (occurred_at DESC);

CREATE INDEX notifications_recipient_date_idx ON public.notifications USING btree (recipient_id, created_at DESC);

CREATE UNIQUE INDEX profiles_single_superuser ON public.profiles USING btree (role) WHERE (role = 'superuser'::text);

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);

-- 4. Restore production business logic, checks, audit and notification functions.

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT role
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
    AND active = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'superuser')
      AND active = true
  );
$function$;

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
     OR (v_actor_role = 'admin' AND v_target_role NOT IN ('runner','manager'))
     OR (v_actor_role = 'superuser' AND v_target_role NOT IN ('runner','manager','admin')) THEN
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
$function$;

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
    AND role IN ('runner', 'manager');

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
     OR body = 'Runner ' ||
       coalesce(v_runner_name, 'Unknown') ||
       ' confirmed receiving their weekly payment.';
END;
$function$;

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
      AND role = 'runner'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Runner not found or inactive';
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
    RAISE EXCEPTION 'Runner hourly rate is not configured';
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
$function$;

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
      'Runner ' || coalesce(runner_name, 'Unknown') ||
      ' confirmed receiving their weekly payment.'
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_tips_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.published = true
     and old.published is distinct from true then
    insert into public.notifications
      (recipient_id, title, body)
    values (
      new.runner_id,
      '💰 Your Weekly Tips Are Ready!',
      'Your payment for this week has been published. Open Tips Ledger to review it.'
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_published_tips()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published = true
       AND NOT (
         current_setting(
           'app.allow_permanent_runner_delete', true
         ) = 'on'
         AND public.current_user_role()
             IN ('admin', 'superuser')
       ) THEN
      RAISE EXCEPTION
        'Published payouts cannot be deleted';
    END IF;

    RETURN OLD;
  END IF;

  IF OLD.published = true THEN
    RAISE EXCEPTION
      'Published payouts cannot be modified';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_weekly_tips(p_record_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.current_user_role()
     NOT IN ('superuser', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_record_id IS NULL THEN
    RAISE EXCEPTION 'Record ID is required';
  END IF;

  UPDATE public.weekly_tips
  SET published = true
  WHERE id = p_record_id
    AND published = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found or already published';
  END IF;
END;
$function$;

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
     OR (v_actor_role = 'admin' AND v_target_role NOT IN ('runner','manager'))
     OR (v_actor_role = 'superuser' AND v_target_role NOT IN ('runner','manager','admin')) THEN
    RAISE EXCEPTION 'Your role cannot manage this employee';
  END IF;

  UPDATE public.profiles SET active = p_active
  WHERE id = p_employee_id;
  -- The existing audit trigger records employee.activated / employee.deactivated.
END;
$function$;

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
    AND role = 'runner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Runner not found';
  END IF;
END;
$function$;

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
      AND role = 'runner'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Active runner not found';
  END IF;

  INSERT INTO public.runner_rates
    (runner_id, hourly_rate, effective_from)
  VALUES
    (p_runner_id, p_hourly_rate, p_effective_from);
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.update_weekly_tips_draft(p_record_id uuid, p_hours numeric, p_tips numeric, p_advances numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.current_user_role()
        NOT IN ('admin', 'superuser') THEN
    RAISE EXCEPTION 'Only Admin or Superuser can edit payments';
  END IF;

  IF p_record_id IS NULL
     OR p_hours IS NULL OR p_hours < 0
     OR p_tips IS NULL OR p_tips < 0
     OR p_advances IS NULL OR p_advances < 0
     OR p_advances > p_tips THEN
    RAISE EXCEPTION 'Invalid weekly tips values';
  END IF;

  PERFORM 1
  FROM public.weekly_tips
  WHERE id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.receipt_confirmations
    WHERE weekly_tip_id = p_record_id
  ) THEN
    RAISE EXCEPTION 'Payment already received. Editing is locked.';
  END IF;

  UPDATE public.weekly_tips
  SET
    hours_worked = p_hours,
    tips_amount = p_tips,
    advances = p_advances
  WHERE id = p_record_id;
END;
$function$;

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
  SELECT p.full_name, p.role
  INTO v_actor_name, v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF TG_OP <> 'INSERT' THEN
    v_before := to_jsonb(OLD);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_after := to_jsonb(NEW);
  END IF;

  v_action := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);

  IF TG_TABLE_NAME = 'weekly_tips' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.id ELSE NEW.id END;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.published IS DISTINCT FROM NEW.published
         AND NEW.published = true THEN
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
    v_target_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.weekly_tip_id ELSE NEW.weekly_tip_id END;

    IF TG_OP = 'INSERT' THEN
      v_action := 'payment.receipt_confirmed';
    END IF;

  ELSIF TG_TABLE_NAME = 'runner_rates' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.runner_id ELSE NEW.runner_id END;
    v_entity_id := v_target_id;
    v_action := 'hourly_rate.' || lower(TG_OP);

  ELSIF TG_TABLE_NAME = 'profiles' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.id ELSE NEW.id END;
    v_entity_id := v_target_id;
    v_target_name := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.full_name ELSE NEW.full_name END;
    v_action := 'employee.' || lower(TG_OP);

    IF TG_OP = 'UPDATE'
       AND OLD.active IS DISTINCT FROM NEW.active THEN
      IF NEW.active = true THEN
        v_action := 'employee.activated';
      ELSE
        v_action := 'employee.deactivated';
      END IF;
    END IF;
  END IF;

  IF v_target_id IS NOT NULL
     AND v_target_name IS NULL THEN
    SELECT p.full_name INTO v_target_name
    FROM public.profiles p
    WHERE p.id = v_target_id;
  END IF;

  INSERT INTO public.audit_log (
    actor_id, actor_name, actor_role,
    action, entity_type, entity_id,
    target_user_id, target_name, details
  )
  VALUES (
    v_actor, v_actor_name, v_actor_role,
    v_action, TG_TABLE_NAME, v_entity_id,
    v_target_id, v_target_name,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Grant only signed-in users relevant RPC access; no anonymous helper-RPC exposure.

REVOKE ALL ON FUNCTION public."admin_permanently_delete_employee"(p_employee_id uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."admin_permanently_delete_employee"(p_employee_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public."admin_permanently_delete_employee"(p_employee_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public."admin_permanently_delete_runner"(p_runner_id uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."admin_permanently_delete_runner"(p_runner_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public."admin_permanently_delete_runner"(p_runner_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public."create_weekly_tips_draft"(p_runner_id uuid, p_week_start date, p_hours numeric, p_tips numeric, p_advances numeric) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."create_weekly_tips_draft"(p_runner_id uuid, p_week_start date, p_hours numeric, p_tips numeric, p_advances numeric) TO authenticated;

GRANT EXECUTE ON FUNCTION public."create_weekly_tips_draft"(p_runner_id uuid, p_week_start date, p_hours numeric, p_tips numeric, p_advances numeric) TO service_role;

REVOKE ALL ON FUNCTION public."current_user_role"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."current_user_role"() TO authenticated;

GRANT EXECUTE ON FUNCTION public."current_user_role"() TO service_role;

REVOKE ALL ON FUNCTION public."is_admin"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."is_admin"() TO authenticated;

GRANT EXECUTE ON FUNCTION public."is_admin"() TO service_role;

REVOKE ALL ON FUNCTION public."notify_payment_received"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."notify_payment_received"() TO authenticated;

GRANT EXECUTE ON FUNCTION public."notify_payment_received"() TO service_role;

REVOKE ALL ON FUNCTION public."notify_tips_published"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."notify_tips_published"() TO authenticated;

GRANT EXECUTE ON FUNCTION public."notify_tips_published"() TO service_role;

REVOKE ALL ON FUNCTION public."protect_published_tips"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."protect_published_tips"() TO authenticated;

GRANT EXECUTE ON FUNCTION public."protect_published_tips"() TO service_role;

REVOKE ALL ON FUNCTION public."publish_weekly_tips"(p_record_id uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."publish_weekly_tips"(p_record_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public."publish_weekly_tips"(p_record_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public."set_employee_active"(p_employee_id uuid, p_active boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."set_employee_active"(p_employee_id uuid, p_active boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public."set_employee_active"(p_employee_id uuid, p_active boolean) TO service_role;

REVOKE ALL ON FUNCTION public."set_runner_active"(p_runner_id uuid, p_active boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_active"(p_runner_id uuid, p_active boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_active"(p_runner_id uuid, p_active boolean) TO service_role;

REVOKE ALL ON FUNCTION public."set_runner_hourly_rate"(p_runner_id uuid, p_hourly_rate numeric, p_effective_from date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_hourly_rate"(p_runner_id uuid, p_hourly_rate numeric, p_effective_from date) TO authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_hourly_rate"(p_runner_id uuid, p_hourly_rate numeric, p_effective_from date) TO service_role;

REVOKE ALL ON FUNCTION public."set_runner_hourly_rate_today"(p_runner_id uuid, p_hourly_rate numeric) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_hourly_rate_today"(p_runner_id uuid, p_hourly_rate numeric) TO authenticated;

GRANT EXECUTE ON FUNCTION public."set_runner_hourly_rate_today"(p_runner_id uuid, p_hourly_rate numeric) TO service_role;

REVOKE ALL ON FUNCTION public."update_weekly_tips_draft"(p_record_id uuid, p_hours numeric, p_tips numeric, p_advances numeric) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."update_weekly_tips_draft"(p_record_id uuid, p_hours numeric, p_tips numeric, p_advances numeric) TO authenticated;

GRANT EXECUTE ON FUNCTION public."update_weekly_tips_draft"(p_record_id uuid, p_hours numeric, p_tips numeric, p_advances numeric) TO service_role;

REVOKE ALL ON FUNCTION public."write_tips_ledger_audit"() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public."write_tips_ledger_audit"() TO service_role;

-- 6. Enable RLS and recreate app policies.

ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."audit_log" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."runner_rates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."weekly_tips" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."receipt_confirmations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."push_subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log" ON public."audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((current_user_role() = ANY (ARRAY['admin'::text, 'superuser'::text])));

CREATE POLICY "Users can delete own notifications" ON public."notifications" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((recipient_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Users mark own notifications read" ON public."notifications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((recipient_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL))) WITH CHECK (((recipient_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Users read own notifications" ON public."notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((recipient_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Admin reads all profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((current_user_role() = ANY (ARRAY['admin'::text, 'superuser'::text])));

CREATE POLICY "Manager reads active runner profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT current_user_role() AS current_user_role) = 'manager'::text) AND (role = 'runner'::text) AND (active = true)));

CREATE POLICY "Users read own profile" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Users add own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Users delete own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Users read own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Users update own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() IS NOT NULL)));

CREATE POLICY "Admin and manager read confirmations" ON public."receipt_confirmations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((current_user_role() = ANY (ARRAY['admin'::text, 'superuser'::text, 'manager'::text])));

CREATE POLICY "Runner confirms own published payout" ON public."receipt_confirmations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((runner_id = ( SELECT auth.uid() AS uid)) AND (( SELECT current_user_role() AS current_user_role) = 'runner'::text) AND (EXISTS ( SELECT 1
   FROM weekly_tips
  WHERE ((weekly_tips.id = receipt_confirmations.weekly_tip_id) AND (weekly_tips.runner_id = ( SELECT auth.uid() AS uid)) AND (weekly_tips.published = true))))));

CREATE POLICY "Runner reads own confirmations" ON public."receipt_confirmations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((runner_id = ( SELECT auth.uid() AS uid)) AND (( SELECT current_user_role() AS current_user_role) = 'runner'::text)));

CREATE POLICY "Admin reads all runner rates" ON public."runner_rates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((current_user_role() = ANY (ARRAY['admin'::text, 'superuser'::text])));

CREATE POLICY "Runner reads own rates" ON public."runner_rates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((runner_id = ( SELECT auth.uid() AS uid)) AND (( SELECT current_user_role() AS current_user_role) = 'runner'::text)));

CREATE POLICY "Admin and manager read weekly tips" ON public."weekly_tips" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((current_user_role() = ANY (ARRAY['admin'::text, 'superuser'::text, 'manager'::text])));

CREATE POLICY "Runner reads own published tips" ON public."weekly_tips" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((runner_id = ( SELECT auth.uid() AS uid)) AND (published = true) AND (( SELECT current_user_role() AS current_user_role) = 'runner'::text)));

-- 7. Match live authenticated table privileges; RLS still restricts which rows are accessible.

REVOKE ALL ON TABLE public."audit_log" FROM PUBLIC, anon, authenticated;

GRANT DELETE, INSERT, SELECT, UPDATE ON public."audit_log" TO authenticated;

GRANT ALL PRIVILEGES ON public."audit_log" TO service_role;

REVOKE ALL ON TABLE public."notifications" FROM PUBLIC, anon, authenticated;

GRANT DELETE, INSERT, SELECT, UPDATE ON public."notifications" TO authenticated;

GRANT ALL PRIVILEGES ON public."notifications" TO service_role;

REVOKE ALL ON TABLE public."profiles" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public."profiles" TO authenticated;

GRANT ALL PRIVILEGES ON public."profiles" TO service_role;

REVOKE ALL ON TABLE public."push_subscriptions" FROM PUBLIC, anon, authenticated;

GRANT DELETE, INSERT, SELECT, UPDATE ON public."push_subscriptions" TO authenticated;

GRANT ALL PRIVILEGES ON public."push_subscriptions" TO service_role;

REVOKE ALL ON TABLE public."receipt_confirmations" FROM PUBLIC, anon, authenticated;

GRANT INSERT, SELECT ON public."receipt_confirmations" TO authenticated;

GRANT ALL PRIVILEGES ON public."receipt_confirmations" TO service_role;

REVOKE ALL ON TABLE public."runner_rates" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public."runner_rates" TO authenticated;

GRANT ALL PRIVILEGES ON public."runner_rates" TO service_role;

REVOKE ALL ON TABLE public."weekly_tips" FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON public."weekly_tips" TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;

-- 8. Add audit/notification/immutability triggers last.

CREATE TRIGGER audit_profiles AFTER DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION write_tips_ledger_audit();

CREATE TRIGGER audit_receipt_confirmations AFTER INSERT OR DELETE OR UPDATE ON public.receipt_confirmations FOR EACH ROW EXECUTE FUNCTION write_tips_ledger_audit();

CREATE TRIGGER payment_received_notification AFTER INSERT ON public.receipt_confirmations FOR EACH ROW EXECUTE FUNCTION notify_payment_received();

CREATE TRIGGER audit_runner_rates AFTER INSERT OR DELETE OR UPDATE ON public.runner_rates FOR EACH ROW EXECUTE FUNCTION write_tips_ledger_audit();

CREATE TRIGGER audit_weekly_tips AFTER INSERT OR DELETE OR UPDATE ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION write_tips_ledger_audit();

CREATE TRIGGER protect_published_tips_before_delete BEFORE DELETE ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION protect_published_tips();

CREATE TRIGGER protect_published_tips_trigger BEFORE DELETE OR UPDATE ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION protect_published_tips();

CREATE TRIGGER tips_published_notification AFTER UPDATE OF published ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION notify_tips_published();

COMMIT;
-- Next: create Auth login and its superuser profile; configure URL and anon key;
-- deploy create-employee-, send-push and delete-employee Edge Functions;
-- configure their secrets and matching VAPID public/private keys.
