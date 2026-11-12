-- Follow-up correction: PostgreSQL regex uses [.] so file paths match a literal period.
-- This migration is additive and repairs the previously-applied file-path rule.
BEGIN;
ALTER TABLE public.mystery_shopper_reports
  DROP CONSTRAINT IF EXISTS report_path_belongs_to_employee;
ALTER TABLE public.mystery_shopper_reports
  ADD CONSTRAINT report_path_belongs_to_employee CHECK (
    split_part(file_path,'/',1) = employee_id::text
    AND file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
  );
DROP POLICY IF EXISTS "Admins upload mystery shopper files" ON storage.objects;
CREATE POLICY "Admins upload mystery shopper files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'mystery-shopper-reports'
    AND (SELECT public.is_admin())
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
  );
COMMIT;
