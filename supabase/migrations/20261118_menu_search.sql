create table public.menu_search_items (
  category text not null,
  name text not null,
  ingredients text[] not null,
  allergens text[] not null,
  check_manager boolean not null default true,
  primary key (category, name)
);
alter table public.menu_search_items enable row level security;
revoke all on public.menu_search_items from public, anon, authenticated;
grant select on public.menu_search_items to authenticated;
create policy "Selected active employees read menu items"
on public.menu_search_items for select to authenticated using (
  (select public.current_user_role()) in ('admin','superuser','waiter_waitress','counter','expo')
  or ((select public.current_user_role()) = 'manager' and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.management_position is null or p.management_position in
        ('floor_team_leader','floor_supervisor','floor_manager_on_duty'))
  ))
);
