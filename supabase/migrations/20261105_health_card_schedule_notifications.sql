-- Staged notification schema: do not run on production until the upload/health-card UI is verified.
-- All times/days for expiry are evaluated in Asia/Beirut by the scheduled dispatcher.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS health_card_expiry date;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

-- Event keys are unique for EACH recipient. Existing notifications keep NULL keys.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_event_key_unique
  ON public.notifications (recipient_id, event_key);

-- A publication is an immutable publication event; later uploads create a NEW id.
-- No client can insert/publish rows directly. Upload validation will be joined
-- when Excel schedule storage is implemented.
CREATE TABLE IF NOT EXISTS public.schedule_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL CHECK (department IN ('FOH', 'BOH')),
  week_start date NOT NULL,
  upload_path text NOT NULL CHECK (length(btrim(upload_path)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL,
  published_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.schedule_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_publications FROM PUBLIC, anon, authenticated;

-- Deliberately no authenticated INSERT/UPDATE/DELETE policies. A future
-- validated backend upload/publish flow alone can create publication events.

-- On changing a date, clean up old reminders, including when the new date is NULL.
-- This stops old reminders being shown after renewing the health card.
CREATE OR REPLACE FUNCTION public.clear_stale_health_card_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.health_card_expiry IS DISTINCT FROM NEW.health_card_expiry THEN
    DELETE FROM public.notifications n
    WHERE n.event_key LIKE ('health:' || NEW.id::text || ':%');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS clear_stale_health_card_notices ON public.profiles;
CREATE TRIGGER clear_stale_health_card_notices
AFTER UPDATE OF health_card_expiry ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.clear_stale_health_card_notices();

-- Minimal guarded setter; only Admin/Superuser may change health card dates.
CREATE OR REPLACE FUNCTION public.set_employee_health_card_expiry(
  p_employee_id uuid, p_expiry_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin or Superuser access required';
  END IF;
  IF p_employee_id IS NULL THEN RAISE EXCEPTION 'Employee ID required'; END IF;

  UPDATE public.profiles
  SET health_card_expiry = p_expiry_date
  WHERE id = p_employee_id
    AND active = true
    AND role IN ('runner','host_hostess','counter','expo','kitchen_crew');

  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_employee_health_card_expiry(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_health_card_expiry(uuid,date) TO authenticated;

-- Insert ONE in-app message per active employee on every successful publication.
-- New schedule publication id = new event; simply editing a draft never fires it.
CREATE OR REPLACE FUNCTION public.notify_on_schedule_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  INSERT INTO public.notifications (recipient_id, title, body, event_key)
  SELECT p.id,
    '📅 Weekly Schedule',
    'Your weekly schedule has been published',
    'schedule:' || NEW.id::text
  FROM public.profiles p
  WHERE p.active = true
  ON CONFLICT (recipient_id,event_key) DO NOTHING;

  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS notify_on_schedule_publication ON public.schedule_publications;
CREATE TRIGGER notify_on_schedule_publication
AFTER INSERT ON public.schedule_publications
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_schedule_publication();

REVOKE ALL ON FUNCTION public.clear_stale_health_card_notices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_schedule_publication() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Existing payments, receipts, push subscriptions and user roles are untouched.
