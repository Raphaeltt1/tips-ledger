alter table public.profiles add column management_position text;
alter table public.profiles add constraint profiles_management_position check (
 management_position is null or (role='manager' and management_position in ('floor_team_leader','kitchen_team_leader','floor_supervisor','kitchen_supervisor','floor_manager_on_duty','kitchen_manager_on_duty'))
);
create function public.position_request_department(p_position text) returns text language sql immutable set search_path='' as $$
 select case when p_position in ('kitchen_crew','driver') then 'BOH'
 when p_position in ('runner','host_hostess','counter','expo','waiter_waitress') then 'FOH' end
$$;
update public.profiles set request_department=public.position_request_department(role)
 where request_department is distinct from public.position_request_department(role);
create function public.assign_position_department() returns trigger language plpgsql set search_path='' as $$
begin
 new.request_department:=public.position_request_department(new.role);
 return new;
end $$;
create trigger assign_position_department before insert or update of role,request_department on public.profiles
for each row execute function public.assign_position_department();
update public.schedule_requests r set department=p.request_department from public.profiles p
 where p.id=r.employee_id and p.request_department is not null and r.department<>p.request_department;
create or replace function public.stamp_schedule_request() returns trigger language plpgsql set search_path='' as $$
begin
 select p.full_name,public.position_request_department(p.role) into strict new.employee_name,new.department
 from public.profiles p where p.id=new.employee_id;
 if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
 return new;
end $$;
