-- PostgreSQL 17, disposable local container only. No live database access.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $f$
 SELECT nullif(pg_catalog.current_setting('request.jwt.claim.sub', true),'')::uuid
$f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, active boolean);
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
 SELECT role FROM public.profiles
 WHERE id = (SELECT auth.uid()) AND active=true LIMIT 1
$f$;
CREATE TABLE public.weekly_tips (
 id uuid PRIMARY KEY,
 runner_id uuid NOT NULL,
 week_start date NOT NULL,
 hours_worked numeric NOT NULL,
 hourly_rate numeric NOT NULL,
 tips_amount numeric NOT NULL,
 advances numeric NOT NULL,
 published boolean NOT NULL,
 created_at timestamptz DEFAULT now(),
 net_payout numeric GENERATED ALWAYS AS (round(tips_amount - advances,2)) STORED
);
CREATE TABLE public.receipt_confirmations (
 weekly_tip_id uuid NOT NULL,
 runner_id uuid NOT NULL
);
\i /work/supabase/migrations/20261031_allow_unreceived_published_edits.sql
CREATE TRIGGER protect_published_tips_before_delete
BEFORE DELETE ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION public.protect_published_tips();
CREATE TRIGGER protect_published_tips_trigger
BEFORE DELETE OR UPDATE ON public.weekly_tips FOR EACH ROW EXECUTE FUNCTION public.protect_published_tips();

INSERT INTO public.profiles (id,role,active) VALUES
 ('00000000-0000-0000-0000-000000000001','superuser',true),
 ('00000000-0000-0000-0000-000000000002','runner',true);
INSERT INTO public.weekly_tips
 (id,runner_id,week_start,hours_worked,hourly_rate,tips_amount,advances,published)
VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','2026-10-05',10,100,100,20,false),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','2026-10-12',10,100,100,20,true),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','2026-10-19',10,100,100,20,true);
INSERT INTO public.receipt_confirmations(weekly_tip_id,runner_id)
VALUES('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001', false);

DO $test$
DECLARE blocked boolean;
BEGIN
  -- Admin can correct a published, not-yet-received payment.
  UPDATE public.weekly_tips SET hours_worked=11, tips_amount=160, advances=30
  WHERE id='10000000-0000-0000-0000-000000000002';
  IF NOT EXISTS (
    SELECT 1 FROM public.weekly_tips
    WHERE id='10000000-0000-0000-0000-000000000002' AND net_payout=130
      AND hours_worked=11 AND published=true
  ) THEN RAISE EXCEPTION 'Admin edit or payout calculation failed'; END IF;

  -- Receipt confirmation permanently locks editing.
  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET tips_amount=180
    WHERE id='10000000-0000-0000-0000-000000000003';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Confirmed payment was editable'; END IF;

  -- Published identity, week, hourly-rate and published status remain locked.
  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET runner_id='00000000-0000-0000-0000-000000000001'
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published ownership was editable'; END IF;

  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET week_start='2026-10-13'
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published week was editable'; END IF;

  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET hourly_rate=900
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published rate snapshot was editable'; END IF;

  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET published=false
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published flag was editable'; END IF;

  -- Published delete is forbidden in normal app sessions.
  blocked:=false;
  BEGIN
    DELETE FROM public.weekly_tips
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published payment was deletable'; END IF;

  -- Non-admin can't edit published unconfirmed payments.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  blocked:=false;
  BEGIN
    UPDATE public.weekly_tips SET tips_amount=170
    WHERE id='10000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Runner edited published payment'; END IF;

  -- Original published numbers unchanged by every unauthorized attempt.
  IF NOT EXISTS (
   SELECT 1 FROM public.weekly_tips
    WHERE id='10000000-0000-0000-0000-000000000002'
     AND tips_amount=160 AND advances=30 AND hours_worked=11
  ) THEN RAISE EXCEPTION 'Blocked attempts altered published payment'; END IF;

  -- Existing permanent employee-delete exception still works for Admin.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  PERFORM set_config('app.allow_permanent_runner_delete','on',true);
  DELETE FROM public.weekly_tips
  WHERE id='10000000-0000-0000-0000-000000000002';
  IF EXISTS (SELECT 1 FROM public.weekly_tips WHERE id='10000000-0000-0000-0000-000000000002')
  THEN RAISE EXCEPTION 'Authorized permanent deletion failed'; END IF;
  RAISE NOTICE 'ALL PAYMENT LOCK REGRESSION CASES PASSED';
END;
$test$;
