-- Require AAL2 for Superuser database privileges only after a verified
-- TOTP factor has been enrolled. Does not alter permissions of other roles.
-- Before enrollment, legacy Superuser sessions remain usable.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT p.role FROM public.profiles p
  WHERE p.id = (SELECT auth.uid()) AND p.active = true
    AND (
      p.role <> 'superuser'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors f
        WHERE f.user_id = p.id AND f.status = 'verified'
      )
      OR COALESCE((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    )
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT COALESCE(public.current_user_role() IN ('admin','superuser'), false);
$$;
