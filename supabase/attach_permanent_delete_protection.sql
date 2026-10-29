-- Attach the protection function created by permanent_runner_deletion.sql.
-- Published weekly tips cannot be deleted directly; the admin-only permanent
-- deletion RPC sets a transaction-local flag before deleting the runner's rows.
DROP TRIGGER IF EXISTS protect_published_tips_before_delete ON public.weekly_tips;

CREATE TRIGGER protect_published_tips_before_delete
BEFORE DELETE ON public.weekly_tips
FOR EACH ROW
EXECUTE FUNCTION public.protect_published_tips();
