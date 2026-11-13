create function public.valid_schedule_days(days jsonb) returns boolean
language sql immutable strict set search_path = '' as $$
 select case when jsonb_typeof(days) <> 'object' then false else not exists (
   select 1 from jsonb_each(days) d where d.key not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
   or d.value not in ('"AM"'::jsonb,'"PM"'::jsonb,'"Double"'::jsonb,'"Off"'::jsonb)
 ) end
$$;

create function public.schedule_request_window() returns table(week_start date, closes_at timestamptz, is_open boolean)
language sql stable set search_path = '' as $$
 with local_week as (select date_trunc('week',statement_timestamp() at time zone 'Asia/Beirut') as monday),
 bounds as (select (monday + interval '7 days')::date as target,
 (monday + interval '4 days 15 hours') at time zone 'Asia/Beirut' as cutoff from local_week)
 select target, cutoff, statement_timestamp() < cutoff from bounds
$$;

create table public.schedule_requests (
 week_start date not null check (extract(isodow from week_start)=1),
 employee_id uuid not null references public.profiles(id) on delete cascade,
 employee_name text not null,
 days jsonb not null check(public.valid_schedule_days(days)),
 revision integer not null default 1,
 primary key(week_start,employee_id)
);
create function public.stamp_schedule_request() returns trigger language plpgsql set search_path = '' as $$
begin
 select p.full_name into strict new.employee_name from public.profiles p where p.id=new.employee_id;
 if tg_op='UPDATE' then new.revision := old.revision+1; end if;
 return new;
end
$$;
create trigger stamp_request before insert or update on public.schedule_requests
for each row execute function public.stamp_schedule_request();
alter table public.schedule_requests enable row level security;
revoke all on public.schedule_requests from public, anon, authenticated;
grant select, insert(week_start,employee_id,days), update(days) on public.schedule_requests to authenticated;
create policy read_schedule_requests on public.schedule_requests for select to authenticated using (
 (select public.current_user_role()) in ('manager','admin','superuser')
 or (employee_id=(select auth.uid()) and (select public.current_user_role()) is not null)
);
create policy submit_schedule_requests on public.schedule_requests for insert to authenticated with check (
 employee_id=(select auth.uid()) and (select public.current_user_role()) in ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress')
 and week_start=(select w.week_start from public.schedule_request_window() w where w.is_open)
);
create policy edit_schedule_requests on public.schedule_requests for update to authenticated using (
 employee_id=(select auth.uid()) and (select public.current_user_role()) in ('runner','host_hostess','counter','expo','kitchen_crew','waiter_waitress')
 and week_start=(select w.week_start from public.schedule_request_window() w where w.is_open)
) with check (employee_id=(select auth.uid()));
revoke all on function public.schedule_request_window(), public.valid_schedule_days(jsonb), public.stamp_schedule_request() from public,anon;
grant execute on function public.schedule_request_window(), public.valid_schedule_days(jsonb) to authenticated;
