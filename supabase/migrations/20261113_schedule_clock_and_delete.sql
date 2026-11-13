alter table public.schedule_workweeks add column time_format integer not null default 12;
alter table public.schedule_workweeks alter column sales drop not null, alter column target drop not null;

create function public.schedule_clock_label(shift text) returns text
language plpgsql immutable strict set search_path='' as $$
declare parts text[]; part text; m text[]; a integer; b integer; labels text[]:='{}';
begin
 if shift in ('','OFF') then return shift; end if;
 parts:=string_to_array(shift,' / ');
 if cardinality(parts)>2 then return null; end if;
 foreach part in array parts loop
  m:=regexp_match(part,'^([0-9]{1,2})(:[0-5][0-9])?-([0-9]{1,2})(:[0-5][0-9])?$');
  if m is null then return null; end if;
  a:=m[1]::int*60+coalesce(substr(m[2],2)::int,0); b:=m[3]::int*60+coalesce(substr(m[4],2)::int,0);
  if a>=1440 or b>1440 or a=b then return null; end if;
  labels:=array_append(labels, ((m[1]::int+11)%12+1)::text||coalesce(nullif(m[2],':00'),'')||'-'||((m[3]::int+11)%12+1)::text||coalesce(nullif(m[4],':00'),''));
 end loop;
 return array_to_string(labels,' / ');
end $$;
create function public.save_schedule_week_24(p_department text,p_week date,p_revision integer,p_sales numeric,p_target numeric,p_roster jsonb,p_warned boolean,p_publish boolean)
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
     or length(d->>0)>2 or length(d->>2)>2 or public.schedule_clock_label(d->>1) is null
     then raise exception 'Invalid shift or section.'; end if;
     shifts:=shifts||jsonb_build_array(jsonb_build_array(d->>0,public.schedule_clock_label(d->>1),d->>2));
   end loop;
   visible:=visible||jsonb_build_array(jsonb_build_array(person->>'id',person->>'name',person->>'position')||shifts);
 end loop;
 insert into public.schedule_workweeks as w (department,week_start,revision,sales,target,roster,warned,time_format) values(p_department,p_week,1,p_sales,p_target,p_roster,p_warned,24)
 on conflict(department,week_start) do update set time_format=24,revision=w.revision+1,sales=p_sales,target=p_target,roster=p_roster,warned=w.warned or p_warned
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
revoke all on function public.save_schedule_week_24(text,date,integer,numeric,numeric,jsonb,boolean,boolean) from public,anon;
grant execute on function public.save_schedule_week_24(text,date,integer,numeric,numeric,jsonb,boolean,boolean) to authenticated;

create function public.delete_schedule_week(p_department text,p_week date,p_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare new_revision integer;
begin
 if coalesce(public.current_user_role(),'') not in ('manager','admin','superuser') then raise exception 'Management access required' using errcode='42501'; end if;
 if p_revision is null or p_department not in ('FOH','BOH') or extract(isodow from p_week)<>1 then raise exception 'Invalid schedule'; end if;
 insert into public.schedule_workweeks as w(department,week_start,revision,sales,target,roster,warned,time_format)
 select p_department,p_week,1,null,null,coalesce((select jsonb_agg(person||jsonb_build_object('days','[["","",""],["","",""],["","",""],["","",""],["","",""],["","",""],["","",""]]'::jsonb) order by n)
 from jsonb_array_elements((select roster from public.schedule_workweeks where department=p_department order by (week_start<=p_week) desc,week_start desc limit 1)) with ordinality staff(person,n)),'[]'),false,24
 on conflict(department,week_start) do update set revision=w.revision+1,sales=null,target=null,warned=false,time_format=24,
 roster=coalesce((select jsonb_agg(person||jsonb_build_object('days','[["","",""],["","",""],["","",""],["","",""],["","",""],["","",""],["","",""]]'::jsonb) order by n)
 from jsonb_array_elements(w.roster) with ordinality staff(person,n)),'[]')
 where w.revision=p_revision returning revision into new_revision;
 if new_revision is null or (new_revision=1 and p_revision<>0) then raise exception 'Schedule changed. Reload before deleting.'; end if;
 delete from public.schedule_publications where department=p_department and week_start=p_week;
 return new_revision;
end $$;
revoke all on function public.delete_schedule_week(text,date,integer) from public,anon;
grant execute on function public.delete_schedule_week(text,date,integer) to authenticated;

revoke execute on function public.save_schedule_week(text,date,integer,numeric,numeric,jsonb,boolean,boolean) from authenticated;
