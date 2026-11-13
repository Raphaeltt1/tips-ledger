create table public.labor_control (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0,
 through_date date, sales numeric, target numeric, roster jsonb not null default '[]'
);
insert into public.labor_control(singleton) values(true);
alter table public.labor_control enable row level security;
revoke all on public.labor_control from public, anon, authenticated;

create function public.read_labor_control() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text := public.current_user_role(); sheet public.labor_control; safe_rows jsonb; cost numeric;
begin
 if role_name is null then raise exception 'Active account required' using errcode='42501'; end if;
 select * into strict sheet from public.labor_control where singleton;
 if role_name in ('admin','manager','superuser') then
   select coalesce(sum((r->>'rate')::numeric*(r->>'hours')::numeric),0) into cost from jsonb_array_elements(sheet.roster) r;
   return jsonb_build_object('through',sheet.through_date,'rows',sheet.roster,'revision',sheet.revision,
     'sales',sheet.sales,'target',sheet.target,'cost',cost,'actual',cost*100/nullif(sheet.sales,0));
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','hours',r->'hours') order by n),'[]')
 into safe_rows from jsonb_array_elements(sheet.roster) with ordinality as entries(r,n);
 return jsonb_build_object('through',sheet.through_date,'rows',safe_rows);
end
$$;

create function public.save_labor_control(p_revision bigint,p_through date,p_sales numeric,p_target numeric,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.current_user_role(),'') not in ('admin','superuser','manager') then
   raise exception 'Management access required' using errcode='42501';
 end if;
 if p_through is null or not isfinite(p_through) or p_sales is null or not(p_sales between 0 and 999999999999.99)
 or p_target is null or not(p_target between 0 and 100) or p_rows is null or jsonb_typeof(p_rows)<>'array' then
   raise exception 'Enter a through date, valid sales and a target from 0 to 100.';
 end if;
 if exists(select from jsonb_array_elements(p_rows) r where
   jsonb_typeof(r) <> 'object' or not (r ?& array['id','name','rate','hours']) or
   (r - array['id','name','rate','hours']) <> '{}'::jsonb or
   jsonb_typeof(r->'id') <> 'string' or length(trim(r->>'id')) not between 1 and 80 or
   jsonb_typeof(r->'name') <> 'string' or length(trim(r->>'name')) not between 1 and 160 or
   jsonb_typeof(r->'rate') <> 'number' or jsonb_typeof(r->'hours') <> 'number' or
   not((r->>'rate')::numeric between 0 and 9999999) or not((r->>'hours')::numeric between 0 and 999999)
 ) then raise exception 'Each employee needs an ID, name, valid rate and hours.'; end if;
 if exists(select from jsonb_array_elements(p_rows) r group by lower(trim(r->>'id')) having count(*)>1) then
   raise exception 'Staff IDs must be unique.';
 end if;
 update public.labor_control set through_date=p_through,sales=p_sales,target=p_target,roster=p_rows,revision=revision+1
 where singleton and revision=p_revision;
 if not found then raise exception 'Another manager saved changes. Reload the sheet before editing again.'; end if;
 return public.read_labor_control();
end
$$;
revoke all on function public.read_labor_control(),public.save_labor_control(bigint,date,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.read_labor_control(),public.save_labor_control(bigint,date,numeric,numeric,jsonb) to authenticated;
