-- Tips Ledger security review diagnostics.
-- Read-only: run in Supabase SQL Editor and inspect each result set.
-- Do not share secrets or service-role keys.

-- 1) RLS status for sensitive public tables.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles','weekly_tips','receipt_confirmations','runner_rates',
    'push_subscriptions','notifications','audit_log'
  )
ORDER BY c.relname;

-- 2) Policies on those tables.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles','weekly_tips','receipt_confirmations','runner_rates',
    'push_subscriptions','notifications','audit_log'
  )
ORDER BY tablename, policyname, cmd;

-- 3) Definitions of sensitive role-checked functions. Review role checks and SECURITY DEFINER/search_path.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'current_user_role','create_weekly_tips_draft','update_weekly_tips_draft',
    'publish_weekly_tips','set_runner_hourly_rate','set_runner_active',
    'admin_permanently_delete_runner','write_tips_ledger_audit'
  )
ORDER BY p.proname;

-- 4) Explicit EXECUTE grants on sensitive functions.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN (
    'current_user_role','create_weekly_tips_draft','update_weekly_tips_draft',
    'publish_weekly_tips','set_runner_hourly_rate','set_runner_active',
    'admin_permanently_delete_runner','write_tips_ledger_audit'
  )
ORDER BY routine_name, grantee, privilege_type;

-- 5) Duplicate runner/week records (should return zero rows).
SELECT runner_id, week_start, COUNT(*) AS records
FROM public.weekly_tips
GROUP BY runner_id, week_start
HAVING COUNT(*) > 1
ORDER BY week_start DESC;

-- 6) Published payment records that are still editable should be prevented by server-side checks.
-- This query only reports the count; it does not change records.
SELECT
  COUNT(*) FILTER (WHERE published = true) AS published_payments,
  COUNT(*) FILTER (WHERE published = false) AS draft_payments
FROM public.weekly_tips;
