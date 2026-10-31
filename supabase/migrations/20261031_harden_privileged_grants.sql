-- Restrict exposed database permissions without changing app roles, RLS policies,
-- data, saved payment amounts, or the frontend.
--
-- The notifications table has never had any anon RLS policies; anon access is
-- unnecessary. Authenticated clients only SELECT/UPDATE/DELETE their own notices.
REVOKE ALL PRIVILEGES ON TABLE public.notifications FROM anon;
REVOKE INSERT, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.notifications FROM authenticated;

-- Client accounts may read (per RLS) the audit log but may not write or
-- truncate it. Writes from owner-run audit triggers and service_role continue.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.audit_log FROM authenticated;

-- Clients register, view, update, and delete only their own push subscriptions.
-- Remove administrative SQL capabilities that bypass RLS.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.push_subscriptions FROM authenticated;

-- Logged-out visitors have no reason to call the privileged active-role helper.
-- The authenticated role keeps its direct EXECUTE grant for existing RLS checks.
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM anon;

-- These are trigger-only functions, not public RPC endpoints. PostgreSQL does
-- not require caller EXECUTE privileges when an already-created trigger fires.
-- Keep function ownership and all existing triggers unchanged.
REVOKE EXECUTE ON FUNCTION public.notify_payment_received()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_tips_published()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_published_tips()
  FROM PUBLIC, anon, authenticated;
