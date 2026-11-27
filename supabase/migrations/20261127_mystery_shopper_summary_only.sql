BEGIN;
CREATE TABLE public.mystery_shopper_summaries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 report_date date NOT NULL,
 total_grade numeric(5,2) NOT NULL CHECK(total_grade BETWEEN 0 AND 100),
 no_points jsonb NOT NULL CHECK(jsonb_typeof(no_points)='array' AND jsonb_array_length(no_points)<=59 AND octet_length(no_points::text)<=100000),
 uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mystery_summary_employee_date_idx ON public.mystery_shopper_summaries(employee_id,report_date DESC,created_at DESC);
ALTER TABLE public.mystery_shopper_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mystery_shopper_summaries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.mystery_shopper_summaries TO authenticated;
CREATE POLICY "Read assigned summaries or manage as admin" ON public.mystery_shopper_summaries FOR SELECT TO authenticated USING ((SELECT public.is_admin()) OR (employee_id=(SELECT auth.uid()) AND (SELECT public.current_user_role()) IS NOT NULL));
CREATE POLICY "Admins publish assigned summaries" ON public.mystery_shopper_summaries FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()) AND uploaded_by=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=employee_id AND p.active AND p.role<>'superuser'));
CREATE POLICY "Admins delete summaries" ON public.mystery_shopper_summaries FOR DELETE TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Legacy mystery reports are admin archive only" ON public.mystery_shopper_reports AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "No new original mystery reports" ON public.mystery_shopper_reports AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Legacy mystery attachments are admin archive only" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (bucket_id<>'mystery-shopper-reports' OR (SELECT public.is_admin()));
CREATE POLICY "No new original mystery attachments" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (bucket_id<>'mystery-shopper-reports');
CREATE FUNCTION public.notify_mystery_summary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.notifications(recipient_id,title,body,event_key) VALUES(NEW.employee_id,'Mystery Shopper','Your new Mystery Shopper evaluation is available.','mystery:'||NEW.id::text);
  RETURN NEW;
 END IF;
 DELETE FROM public.notifications WHERE recipient_id=OLD.employee_id AND event_key='mystery:'||OLD.id::text;
 RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_mystery_summary() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_mystery_summary AFTER INSERT OR DELETE ON public.mystery_shopper_summaries FOR EACH ROW EXECUTE FUNCTION public.notify_mystery_summary();
COMMIT;