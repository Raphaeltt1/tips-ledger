create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, public;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "Users read own push subscriptions" on public.push_subscriptions;
create policy "Users read own push subscriptions"
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()) and public.current_user_role() is not null);

drop policy if exists "Users add own push subscriptions" on public.push_subscriptions;
create policy "Users add own push subscriptions"
on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()) and public.current_user_role() is not null);

drop policy if exists "Users update own push subscriptions" on public.push_subscriptions;
create policy "Users update own push subscriptions"
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()) and public.current_user_role() is not null)
with check (user_id = (select auth.uid()) and public.current_user_role() is not null);

drop policy if exists "Users delete own push subscriptions" on public.push_subscriptions;
create policy "Users delete own push subscriptions"
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()) and public.current_user_role() is not null);
