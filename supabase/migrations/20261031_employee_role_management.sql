-- Tips Ledger: role-scoped employee activation and permanent deletion.
-- This migration does not itself activate, deactivate or delete any real employee.
-- Existing Runner-only functions remain available for compatibility.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_employee_active(
  p_employee_id uuid,
  p_active boolean
)
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

REVOKE ALL ON FUNCTION public.set_employee_active(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_employee_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_employee_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_permanently_delete_employee(
  p_employee_id uuid
)
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

REVOKE ALL ON FUNCTION public.admin_permanently_delete_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_permanently_delete_employee(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_permanently_delete_employee(uuid) TO authenticated;

COMMIT;
