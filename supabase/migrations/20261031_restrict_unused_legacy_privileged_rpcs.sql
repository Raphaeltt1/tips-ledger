-- Applied to production 2026-10-31 as migration
-- restrict_unused_legacy_privileged_rpcs_20261031.
--
-- These endpoints were superseded by the current employee-management Edge
-- Function, set_employee_active, and set_runner_hourly_rate_today.
-- They are not called by the live frontend and are not used by RLS policies.
-- Keep trusted service_role access for compatibility and maintenance.
-- Do not revoke the *active* RPCs: current_user_role, is_admin,
-- create_weekly_tips_draft, update_weekly_tips_draft, publish_weekly_tips,
-- set_employee_active, set_runner_hourly_rate_today, set_my_avatar_path,
-- and admin_permanently_delete_employee.
REVOKE EXECUTE ON FUNCTION public.admin_permanently_delete_runner(uuid)
  FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.set_runner_active(uuid, boolean)
  FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.set_runner_hourly_rate(uuid, numeric, date)
  FROM authenticated;
