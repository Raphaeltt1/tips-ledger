lock table public.tip_distributions in access exclusive mode;
-- Preserve existing sheets without recasting already published shares.
do $$ begin
 if exists(select 1 from public.tip_distributions group by week_start, (position='kitchen_crew') having count(*)>1)
 then raise exception 'Review overlapping legacy pools before migration'; end if;
end $$;
alter table public.tip_distributions drop constraint tip_distributions_position_check;
update public.tip_distributions d set members=coalesce((select jsonb_agg(e||jsonb_build_object('position',d.position,'account',e->>'id') order by ord) from jsonb_array_elements(d.members) with ordinality as x(e,ord)),'[]'), position=case when position='kitchen_crew' then 'BOH' else 'FOH' end,revision=revision+1;
alter table public.tip_distributions add check(position in ('FOH','BOH'));
revoke execute on function public.tip_distribution_action(date,text,bigint,bigint,jsonb,uuid) from authenticated;
create function public.department_distribution_action(w date,pos text,rev bigint,total bigint,roster jsonb,recipient uuid default null, account uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.tip_distributions; m record; payment uuid; share bigint; pushed uuid;
begin
 if coalesce(public.current_user_role(),'') not in ('admin','manager','superuser') then raise exception 'Management access required'; end if;
 if rev=0 then
 insert into public.tip_distributions(week_start,position,pool,members) values(w,pos,total,roster) on conflict do nothing;
 if not found then raise exception 'Week already exists. Reload it.'; end if;
 end if;
 select * into strict d from public.tip_distributions where week_start=w and position=pos for update;
 if rev is null or rev<>0 and d.revision<>rev then raise exception 'This week changed. Reload before editing.'; end if;
 if d.payments<>'{}' and (total is distinct from d.pool or roster is distinct from d.members) then raise exception 'Published distribution is locked'; end if;
 if total is null or total<0 or jsonb_typeof(roster) is distinct from 'array' then raise exception 'Invalid distribution'; end if;
 if exists(select 1 from jsonb_array_elements(roster) e group by e->>'id' having count(*)>1) then raise exception 'Duplicate employee'; end if;
 for m in select * from jsonb_to_recordset(roster) as t(id uuid,code text,name text,position text,hours numeric,rate numeric,advance bigint) loop
 if m.hours is null or m.hours<0 or m.rate is null or m.rate<0 or m.advance is null or m.advance<0 or m.hours<>round(m.hours,2) or m.rate<>round(m.rate,2) then raise exception 'Check hours, rate and advance'; end if;
 if m.id is null or nullif(trim(m.name),'') is null or m.position is null or not (
 (pos='FOH' and m.position in ('runner','counter','expo','host_hostess','waiter_waitress','driver'))
 or (pos='BOH' and m.position='kitchen_crew')) then raise exception 'Check employee name and position'; end if;
 end loop;
 if recipient is not null and not(d.payments ? recipient::text) then
 for m in with rows as (select * from jsonb_to_recordset(roster) as t(id uuid,hours numeric,rate numeric,advance bigint)),
 weights as (select *,hours*rate as weight,sum(hours*rate) over() as denom from rows),
 parts as (select *,div(total*weight,nullif(denom,0)) as base,mod(total*weight,nullif(denom,0)) as remainder from weights)
 select *,base+case when row_number() over(order by remainder desc,id)<=total-sum(base) over() then 1 else 0 end as gross from parts loop
 if total=0 or m.gross is null or m.rate<=0 or m.advance>m.gross then raise exception 'Check the pool, rates and advances before publishing'; end if;
 if m.id=recipient then share:=m.gross; end if;
 end loop;
 if share is null then raise exception 'Employee missing'; end if;
 select * into strict m from jsonb_to_recordset(roster) as t(id uuid,hours numeric,rate numeric,advance bigint) where id=recipient;
 if not exists(select 1 from public.profiles p where p.id=account and p.active and p.role=(select e->>'position' from jsonb_array_elements(roster) e where e->>'id'=recipient::text)) then raise exception 'Choose the matching active employee account to publish'; end if;
 insert into public.weekly_tips(runner_id,week_start,hours_worked,hourly_rate,tips_amount,advances,published)
 values(account,w,m.hours,m.rate,share,m.advance,false) returning id into payment;
 perform public.publish_weekly_tips(payment);
 d.payments:=d.payments||jsonb_build_object(recipient::text,payment);
 pushed:=payment;
 end if;
 update public.tip_distributions set pool=total,members=roster,payments=d.payments,revision=d.revision+1 where week_start=w and position=pos returning * into d;
 return jsonb_build_object('week',to_jsonb(d),'published',pushed);
end $$;
revoke all on function public.department_distribution_action(date,text,bigint,bigint,jsonb,uuid,uuid) from public,anon;
grant execute on function public.department_distribution_action(date,text,bigint,bigint,jsonb,uuid,uuid) to authenticated;
