-- Fix the mismatch between the published-payment Edit UI and the
-- server-side edit RPC. This narrows the exception to Admin/Superuser edits
-- of the amount/hour fields before the employee confirms receipt.
--
-- The published flag, payment owner, week, rate snapshot, primary key and
-- creation time remain immutable. Received payments remain permanently locked.
-- This intentionally preserves the existing authorized permanent-delete
-- escape hatch used by the employee deletion Edge Function.
CREATE OR REPLACE FUNCTION public.protect_published_tips()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published = true
       AND NOT (
         COALESCE(pg_catalog.current_setting('app.allow_permanent_runner_delete', true), '') = 'on'
         AND public.current_user_role() IN ('admin', 'superuser')
       ) THEN
      RAISE EXCEPTION 'Published payouts cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.published = true THEN
    IF public.current_user_role() IN ('admin', 'superuser')
       AND NOT EXISTS (
         SELECT 1 FROM public.receipt_confirmations r
         WHERE r.weekly_tip_id = OLD.id
       )
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.runner_id IS NOT DISTINCT FROM OLD.runner_id
       AND NEW.week_start IS NOT DISTINCT FROM OLD.week_start
       AND NEW.hourly_rate IS NOT DISTINCT FROM OLD.hourly_rate
       AND NEW.published IS NOT DISTINCT FROM OLD.published
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
      -- Only hours, tips and advances can differ. The generated net_payout
      -- recalculates automatically. The active edit RPC validates amounts
      -- and writes an audit entry via the existing AFTER UPDATE trigger.
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Published payment can only be edited by Admin or Superuser before receipt confirmation';
  END IF;

  RETURN NEW;
END;
$function$;