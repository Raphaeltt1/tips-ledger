create function public.set_employee_staff_id(p_employee_id uuid, p_staff_id text, p_previous text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_role text := public.current_user_role();
  target public.profiles%rowtype;
  new_id text := nullif(btrim(p_staff_id), '');
begin
  if actor_role is null or actor_role not in ('admin','superuser') or p_employee_id = auth.uid() then
    raise exception 'You cannot edit this employee ID.';
  end if;
  select * into target from public.profiles where id = p_employee_id for update;
  if not found or target.role = 'superuser' or (target.role = 'admin' and actor_role <> 'superuser') then
    raise exception 'You cannot edit this employee ID.';
  end if;
  if target.staff_id is not distinct from new_id then return; end if;
  if target.staff_id is distinct from p_previous then raise exception 'Employee ID changed. Refresh and try again.'; end if;
  if length(new_id) > 80 then raise exception 'Employee ID must be at most 80 characters.'; end if;
  update public.profiles set staff_id = new_id where id = p_employee_id;
  insert into public.audit_log(actor_id,actor_name,actor_role,action,entity_type,entity_id,target_user_id,target_name,details)
    select id,full_name,role,'employee.staff_id_updated','profiles',target.id,target.id,target.full_name,
           jsonb_build_object('previous',target.staff_id,'current',new_id)
    from public.profiles where id=auth.uid();
exception when unique_violation then raise exception 'This employee ID is already in use.';
end;
$$;
revoke all on function public.set_employee_staff_id(uuid,text,text) from public,anon;
grant execute on function public.set_employee_staff_id(uuid,text,text) to authenticated;
