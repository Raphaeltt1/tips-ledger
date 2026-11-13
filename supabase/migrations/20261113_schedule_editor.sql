create table public.schedule_workweeks (
 department text not null check(department in ('FOH','BOH')),
 week_start date not null check(extract(isodow from week_start)=1),
 revision integer not null, sales numeric not null, target numeric not null,
 roster jsonb not null, warned boolean not null, primary key(department,week_start)
);
alter table public.schedule_workweeks enable row level security;
revoke all on public.schedule_workweeks from public,anon,authenticated;
grant select on public.schedule_workweeks to authenticated;
create policy schedule_editor_management on public.schedule_workweeks for select to authenticated
using ((select public.current_user_role()) in ('manager','admin','superuser'));

create function public.save_schedule_week(p_department text,p_week date,p_revision integer,p_sales numeric,p_target numeric,p_roster jsonb,p_warned boolean,p_publish boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person jsonb; d jsonb; visible jsonb := '[["schedule-grid-v1"],["Staff ID","Name","Position","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]]';
 pub uuid; next_revision integer; shifts jsonb;
begin
 if coalesce(public.current_user_role(),'') not in ('admin','manager','superuser') then raise exception 'Management access required' using errcode='42501'; end if;
 if p_sales is null or not(p_sales>0 and p_sales<=999999999999) or p_target is null or not(p_target between 0 and 100)
 or jsonb_typeof(p_roster) is distinct from 'array' then raise exception 'Expected sales and a labor target are required.'; end if;
 if jsonb_array_length(p_roster)>178 then raise exception 'Maximum 178 employees per published department.'; end if;
 if exists(select from jsonb_array_elements(p_roster) r group by lower(trim(r->>'id')) having count(*)>1) then raise exception 'Staff IDs must be unique.'; end if;
 for person in select value from jsonb_array_elements(p_roster) loop
   if not(person ?& array['id','name','position','rate','counted','days'])
   or jsonb_typeof(person->'id')<>'string' or jsonb_typeof(person->'name')<>'string' or jsonb_typeof(person->'position')<>'string'
   or length(trim(person->>'id')) not between 1 and 80 or length(trim(person->>'name')) not between 1 and 160
   or length(person->>'position')>80 or jsonb_typeof(person->'rate')<>'number' or not((person->>'rate')::numeric between 0 and 9999999)
   or jsonb_typeof(person->'counted')<>'boolean' or jsonb_typeof(person->'days')<>'array' or jsonb_array_length(person->'days')<>7 then raise exception 'Check employee details.'; end if;
   shifts:='[]';
   for d in select value from jsonb_array_elements(person->'days') loop
     if jsonb_typeof(d)<>'array' or jsonb_array_length(d)<>3 or exists(select from jsonb_array_elements(d) v where jsonb_typeof(v)<>'string')
     or length(d->>0)>2 or length(d->>2)>2 or (d->>1) !~* '^(|OFF|((1[0-2]|[1-9])(:[0-5][0-9])?-(1[0-2]|[1-9])(:[0-5][0-9])?)( / ((1[0-2]|[1-9])(:[0-5][0-9])?-(1[0-2]|[1-9])(:[0-5][0-9])?))?)$'
     then raise exception 'Invalid shift or section.'; end if;
     shifts:=shifts||jsonb_build_array(jsonb_build_array(d->>0,d->>1,d->>2));
   end loop;
   visible:=visible||jsonb_build_array(jsonb_build_array(person->>'id',person->>'name',person->>'position')||shifts);
 end loop;
 insert into public.schedule_workweeks as w values(p_department,p_week,1,p_sales,p_target,p_roster,p_warned)
 on conflict(department,week_start) do update set revision=w.revision+1,sales=p_sales,target=p_target,roster=p_roster,warned=w.warned or p_warned
 where w.revision=p_revision returning revision into next_revision;
 if next_revision is null or (next_revision=1 and p_revision<>0) then raise exception 'Schedule changed. Reload before saving.'; end if;
 if p_publish then
   if jsonb_array_length(p_roster)=0 then raise exception 'Add an employee before publishing.'; end if;
   insert into public.schedule_publications(department,week_start,original_filename,workbook_rows,created_by)
    values(p_department,p_week,'Weekly schedule',visible,auth.uid()) returning id into pub;
   update public.schedule_publications set status='published',published_at=now(),published_by=auth.uid() where id=pub;
   if exists(select from public.schedule_publications where department=p_department and week_start=p_week and status='published' and id<>pub) then
    update public.notifications set body='Your weekly schedule has been updated' where event_key='schedule:'||pub::text;
   end if;
 end if;
 return jsonb_build_object('revision',next_revision,'publication',pub);
end $$;
revoke all on function public.save_schedule_week(text,date,integer,numeric,numeric,jsonb,boolean,boolean) from public,anon;
grant execute on function public.save_schedule_week(text,date,integer,numeric,numeric,jsonb,boolean,boolean) to authenticated;
