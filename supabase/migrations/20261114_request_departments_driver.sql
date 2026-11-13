alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','superuser','manager','runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver'));
alter table public.profiles add column request_department text check(request_department in ('FOH','BOH'));
alter table public.schedule_requests add column department text check(department in ('FOH','BOH'));
update public.schedule_requests r set department=case when p.role='kitchen_crew' then 'BOH' else 'FOH' end from public.profiles p where p.id=r.employee_id;
alter table public.schedule_requests alter column department set not null;
create or replace function public.stamp_schedule_request() returns trigger language plpgsql set search_path='' as $$
begin
 select p.full_name,coalesce(p.request_department,case when p.role='kitchen_crew' then 'BOH' else 'FOH' end)
 into strict new.employee_name,new.department from public.profiles p where p.id=new.employee_id;
 if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
 return new;
end $$;
drop policy submit_schedule_requests on public.schedule_requests;
drop policy edit_schedule_requests on public.schedule_requests;
create policy submit_schedule_requests on public.schedule_requests for insert to authenticated with check (
 employee_id=(select auth.uid()) and (select public.current_user_role()) in ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver')
 and week_start=(select w.week_start from public.schedule_request_window() w where w.is_open)
);
create policy edit_schedule_requests on public.schedule_requests for update to authenticated using (
 employee_id=(select auth.uid()) and (select public.current_user_role()) in ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver')
 and week_start=(select w.week_start from public.schedule_request_window() w where w.is_open)
) with check (employee_id=(select auth.uid()));
CREATE OR REPLACE FUNCTION public.set_employee_active(p_employee_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver','manager'))
    OR (v_actor_role='superuser' AND v_target_role NOT IN
        ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver','manager','admin'))
  THEN RAISE EXCEPTION 'Your role cannot manage this employee'; END IF;
  UPDATE public.profiles SET active=p_active WHERE id=p_employee_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_permanently_delete_employee(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver','manager'))
    OR (v_actor_role='superuser' AND v_target_role NOT IN
      ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress','driver','manager','admin'))
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
$function$
;
