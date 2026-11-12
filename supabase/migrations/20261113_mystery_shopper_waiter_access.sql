-- Mystery Shopper reports: private, employee-scoped PDFs/images.
-- Waiter/Waitress accounts have schedule and own report access; no payment eligibility.
BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superuser','admin','manager','runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress'));

CREATE TABLE IF NOT EXISTS public.mystery_shopper_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1500),
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 200),
  file_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 12582912),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_path_belongs_to_employee CHECK (
    split_part(file_path,'/',1) = employee_id::text
    AND file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png|webp)$'
  )
);
CREATE INDEX IF NOT EXISTS mystery_reports_employee_date_idx
  ON public.mystery_shopper_reports(employee_id,report_date DESC,created_at DESC);
ALTER TABLE public.mystery_shopper_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mystery_shopper_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.mystery_shopper_reports TO authenticated;

DROP POLICY IF EXISTS "Owners see only own shopper reports; admins see all" ON public.mystery_shopper_reports;
CREATE POLICY "Owners see only own shopper reports; admins see all"
  ON public.mystery_shopper_reports FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR (
      employee_id = (SELECT auth.uid())
      AND (SELECT public.current_user_role()) IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Only admin and superuser can assign mystery reports" ON public.mystery_shopper_reports;
CREATE POLICY "Only admin and superuser can assign mystery reports"
  ON public.mystery_shopper_reports FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_admin())
    AND uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_id AND p.active = true AND p.role <> 'superuser'
    )
  );

DROP POLICY IF EXISTS "Only admin and superuser can delete mystery reports" ON public.mystery_shopper_reports;
CREATE POLICY "Only admin and superuser can delete mystery reports"
  ON public.mystery_shopper_reports FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- Private bucket; public URLs are disabled. A user must be signed in,
-- and the file must belong to a report they are authorized to read.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('mystery-shopper-reports','mystery-shopper-reports',false,12582912,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public=false,
  file_size_limit=12582912,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Read only owned mystery reports or all for admin" ON storage.objects;
CREATE POLICY "Read only owned mystery reports or all for admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id='mystery-shopper-reports'
    AND (
      (SELECT public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public.mystery_shopper_reports r
        WHERE r.file_path = name
          AND r.employee_id = (SELECT auth.uid())
          AND (SELECT public.current_user_role()) IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "Admins upload mystery shopper files" ON storage.objects;
CREATE POLICY "Admins upload mystery shopper files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='mystery-shopper-reports'
    AND (SELECT public.is_admin())
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png|webp)$'
  );

DROP POLICY IF EXISTS "Admins remove mystery shopper files" ON storage.objects;
CREATE POLICY "Admins remove mystery shopper files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='mystery-shopper-reports' AND (SELECT public.is_admin()));

-- Preserve all existing permissions for the current employee roles.
-- The only changes in the two management RPCs are to include Waiter/Waitress
-- as a manageable account (never as a financial-payment recipient).
CREATE OR REPLACE FUNCTION public.set_employee_active(p_employee_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
  v_actor_role text;
  v_target_role text;
BEGIN
  v_actor_role := public.current_user_role();
  IF v_actor_role NOT IN ('superuser','admin') THEN
    RAISE EXCEPTION 'Only a Superuser or Admin can manage employees';
  END IF;
  IF p_employee_id IS NULL OR p_active IS NULL OR p_employee_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Invalid employee, status, or self-management attempt';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE id=p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF v_target_role = 'superuser'
    OR (v_actor_role='admin' AND v_target_role NOT IN
        ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','manager'))
    OR (v_actor_role='superuser' AND v_target_role NOT IN
        ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','manager','admin'))
  THEN RAISE EXCEPTION 'Your role cannot manage this employee'; END IF;
  UPDATE public.profiles SET active=p_active WHERE id=p_employee_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_permanently_delete_employee(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
  v_actor_role text;
  v_target_role text;
BEGIN
  v_actor_role:=public.current_user_role();
  IF v_actor_role NOT IN ('superuser','admin') THEN
    RAISE EXCEPTION 'Only a Superuser or Admin can permanently delete employees';
  END IF;
  IF p_employee_id IS NULL OR p_employee_id=(SELECT auth.uid()) THEN
    RAISE EXCEPTION 'You cannot permanently delete yourself';
  END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE id=p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF v_target_role='superuser'
    OR (v_actor_role='admin' AND v_target_role NOT IN
      ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','manager'))
    OR (v_actor_role='superuser' AND v_target_role NOT IN
      ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','manager','admin'))
  THEN RAISE EXCEPTION 'Your role cannot permanently delete this employee'; END IF;

  PERFORM pg_catalog.set_config('app.allow_permanent_runner_delete','on',true);
  DELETE FROM public.receipt_confirmations
    WHERE runner_id=p_employee_id
      OR weekly_tip_id IN (SELECT id FROM public.weekly_tips WHERE runner_id=p_employee_id);
  DELETE FROM public.weekly_tips WHERE runner_id=p_employee_id;
  DELETE FROM public.runner_rates WHERE runner_id=p_employee_id;
  DELETE FROM public.notifications WHERE recipient_id=p_employee_id;
  DELETE FROM public.push_subscriptions WHERE user_id=p_employee_id;
  -- Mystery report metadata is removed by FK cascade when the account is deleted;
  -- the authorized Edge Function removes its private Storage objects first.
END;
$fn$;

-- Audit uploads/deletions without copying report contents into public activity logs.
CREATE OR REPLACE FUNCTION public.audit_mystery_shopper_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_row public.mystery_shopper_reports%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN v_row:=NEW; ELSE v_row:=OLD; END IF;
  INSERT INTO public.audit_log
    (actor_id,actor_name,actor_role,action,entity_type,entity_id,
     target_user_id,target_name,details)
  VALUES
    ((SELECT auth.uid()),
     (SELECT full_name FROM public.profiles WHERE id=(SELECT auth.uid())),
     public.current_user_role(),
     CASE WHEN TG_OP='INSERT' THEN 'mystery_report.uploaded' ELSE 'mystery_report.deleted' END,
     'mystery_shopper_reports',v_row.id,v_row.employee_id,
     (SELECT full_name FROM public.profiles WHERE id=v_row.employee_id),
     jsonb_build_object('title',v_row.title,'report_date',v_row.report_date));
  RETURN CASE WHEN TG_OP='INSERT' THEN NEW ELSE OLD END;
END;
$fn$;
DROP TRIGGER IF EXISTS audit_mystery_shopper_report ON public.mystery_shopper_reports;
CREATE TRIGGER audit_mystery_shopper_report
AFTER INSERT OR DELETE ON public.mystery_shopper_reports
FOR EACH ROW EXECUTE FUNCTION public.audit_mystery_shopper_report();
REVOKE ALL ON FUNCTION public.audit_mystery_shopper_report() FROM PUBLIC,anon,authenticated;

COMMIT;
