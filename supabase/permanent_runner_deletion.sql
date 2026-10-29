-- Permanent runner deletion. Run in Supabase SQL Editor as project owner.
-- The edge function authenticates an active admin before invoking this function.
CREATE OR REPLACE FUNCTION public.protect_published_tips()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published = true
       AND NOT (
         current_setting('app.allow_permanent_runner_delete', true) = 'on'
         AND public.current_user_role() = 'admin'
       ) THEN
      RAISE EXCEPTION 'Published payouts cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.published = true THEN
    RAISE EXCEPTION 'Published payouts cannot be modified';
  END IF;

  RETURN NEW;
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
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_runner_id IS NULL OR p_runner_id = auth.uid() THEN
    RAISE EXCEPTION 'Invalid runner';
  END IF;

  SELECT full_name INTO v_runner_name
  FROM public.profiles
  WHERE id = p_runner_id AND role IN ('runner', 'manager');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Transaction-local switch: only this admin-only function sets it.
  PERFORM set_config('app.allow_permanent_runner_delete', 'on', true);

  DELETE FROM public.receipt_confirmations
  WHERE runner_id = p_runner_id OR weekly_tip_id IN (
    SELECT id FROM public.weekly_tips WHERE runner_id = p_runner_id
  );

  DELETE FROM public.weekly_tips WHERE runner_id = p_runner_id;
  DELETE FROM public.runner_rates WHERE runner_id = p_runner_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_runner_id;

  -- Remove this runner's own notifications and receipt-alert history mentioning them.
  DELETE FROM public.notifications
  WHERE recipient_id = p_runner_id
     OR body = 'Runner ' || coalesce(v_runner_name, 'Unknown')
       || ' confirmed receiving their weekly payment.';

  -- The Edge Function deletes the Supabase Auth user after this transaction.
  -- Auth deletion then removes the linked profile via its existing FK behavior.
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_permanently_delete_runner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_permanently_delete_runner(uuid) TO authenticated;
