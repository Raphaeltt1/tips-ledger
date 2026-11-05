-- Employee Ledger: private health-card tracking and read-only published schedules.
-- Additive migration; existing payments, receipts, users and backups are preserved.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unique_recipient_event
  ON public.notifications (recipient_id, event_key);

CREATE TABLE IF NOT EXISTS public.employee_health_cards (
  employee_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_on date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.employee_health_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_health_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.employee_health_cards TO authenticated;
DROP POLICY IF EXISTS "management_views_health_card_expiry" ON public.employee_health_cards;
CREATE POLICY "management_views_health_card_expiry" ON public.employee_health_cards
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Edit dates only with an authorized RPC. A NULL date clears the stored record.
CREATE OR REPLACE FUNCTION public.set_employee_health_card_expiry(
  p_employee_id uuid, p_expiry_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_employee public.profiles%ROWTYPE;
BEGIN
  IF (SELECT public.current_user_role()) NOT IN ('admin','superuser') THEN
    RAISE EXCEPTION 'Admin or Superuser access required';
  END IF;
  SELECT * INTO v_employee FROM public.profiles WHERE id=p_employee_id
    AND active AND role IN ('runner','host_hostess','counter','expo','kitchen_crew');
  IF NOT FOUND THEN RAISE EXCEPTION 'Active team member not found'; END IF;
  IF p_expiry_date IS NULL THEN
    DELETE FROM public.employee_health_cards WHERE employee_id=p_employee_id;
  ELSE
    INSERT INTO public.employee_health_cards (employee_id,expires_on,updated_by)
    VALUES (p_employee_id,p_expiry_date,(SELECT auth.uid()))
    ON CONFLICT (employee_id) DO UPDATE SET
      expires_on=EXCLUDED.expires_on,updated_by=EXCLUDED.updated_by,updated_at=now()
    WHERE public.employee_health_cards.expires_on IS DISTINCT FROM EXCLUDED.expires_on;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_employee_health_card_expiry(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_health_card_expiry(uuid,date) TO authenticated;

-- All old warnings (read and unread) disappear as soon as a card is renewed.
CREATE OR REPLACE FUNCTION public.employee_health_date_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_id uuid;
BEGIN
  v_id := CASE WHEN TG_OP='DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;
  IF TG_OP='DELETE' OR TG_OP='INSERT'
    OR OLD.expires_on IS DISTINCT FROM NEW.expires_on THEN
    DELETE FROM public.notifications
    WHERE event_key LIKE ('health:' || v_id::text || ':%');
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$fn$;
DROP TRIGGER IF EXISTS employee_health_date_changed ON public.employee_health_cards;
CREATE TRIGGER employee_health_date_changed
  AFTER INSERT OR UPDATE OF expires_on OR DELETE ON public.employee_health_cards
  FOR EACH ROW EXECUTE FUNCTION public.employee_health_date_changed();
REVOKE ALL ON FUNCTION public.employee_health_date_changed() FROM PUBLIC,anon,authenticated;

-- Uploads store parsed Excel grid data; no raw Excel documents or macros are hosted.
CREATE TABLE IF NOT EXISTS public.schedule_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL CHECK (department IN ('FOH','BOH')),
  week_start date NOT NULL,
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 160),
  workbook_rows jsonb NOT NULL CHECK (
    jsonb_typeof(workbook_rows)='array'
    AND jsonb_array_length(workbook_rows) BETWEEN 2 AND 180
    AND octet_length(workbook_rows::text) <= 260000
  ),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES public.profiles(id),
  published_at timestamptz,
  CONSTRAINT schedule_publication_state CHECK (
    (status='draft' AND published_at IS NULL AND published_by IS NULL)
    OR (status='published' AND published_at IS NOT NULL AND published_by IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS schedule_pubs_department_week_created
  ON public.schedule_publications(department,week_start DESC,created_at DESC);
ALTER TABLE public.schedule_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schedule_publications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.schedule_publications TO authenticated;

DROP POLICY IF EXISTS "active_users_view_published_schedules" ON public.schedule_publications;
CREATE POLICY "active_users_view_published_schedules" ON public.schedule_publications
  FOR SELECT TO authenticated
  USING (status='published' AND (SELECT public.current_user_role()) IS NOT NULL);
DROP POLICY IF EXISTS "management_views_draft_schedules" ON public.schedule_publications;
CREATE POLICY "management_views_draft_schedules" ON public.schedule_publications
  FOR SELECT TO authenticated
  USING (status='draft' AND (SELECT public.is_admin()));
DROP POLICY IF EXISTS "management_imports_draft_schedules" ON public.schedule_publications;
CREATE POLICY "management_imports_draft_schedules" ON public.schedule_publications
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.is_admin()) AND created_by=(SELECT auth.uid())
    AND status='draft' AND published_by IS NULL AND published_at IS NULL
  );
-- No UPDATE or DELETE grants/policies. Clients cannot directly fake a publication.

CREATE OR REPLACE FUNCTION public.publish_employee_schedule(p_publication_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_id uuid;
BEGIN
  IF (SELECT public.current_user_role()) NOT IN ('admin','superuser') THEN
    RAISE EXCEPTION 'Admin or Superuser access required';
  END IF;
  UPDATE public.schedule_publications
  SET status='published',published_by=(SELECT auth.uid()),published_at=now()
  WHERE id=p_publication_id AND status='draft'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Draft schedule not found or already published'; END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.publish_employee_schedule(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_employee_schedule(uuid) TO authenticated;

-- Every successful Publish creates one fresh event for each active account.
-- Republish a revised Excel import = new publication ID = fresh identical alert.
CREATE OR REPLACE FUNCTION public.schedule_publication_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF NEW.status='published' AND OLD.status='draft' THEN
    INSERT INTO public.notifications(recipient_id,title,body,event_key)
    SELECT p.id,'📅 Weekly Schedule','Your weekly schedule has been published',
           'schedule:' || NEW.id::text
    FROM public.profiles p WHERE p.active=true
    ON CONFLICT (recipient_id,event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS notify_on_schedule_publication ON public.schedule_publications;
CREATE TRIGGER notify_on_schedule_publication
  AFTER UPDATE OF status ON public.schedule_publications
  FOR EACH ROW EXECUTE FUNCTION public.schedule_publication_notice();
REVOKE ALL ON FUNCTION public.schedule_publication_notice() FROM PUBLIC,anon,authenticated;
