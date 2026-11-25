begin;
create schema if not exists ledger_pin_private;
revoke all on schema ledger_pin_private from public, anon, authenticated;
create table ledger_pin_private.key_material (
  singleton boolean primary key check (singleton),
  secret text not null
);
insert into ledger_pin_private.key_material values (true, gen_random_uuid()::text || gen_random_uuid()::text);
create table ledger_pin_private.attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started timestamptz not null, attempts integer not null
);

-- Only trusted Edge Functions can request a credential. No PIN is stored.
create function public.ledger_pin_credential(account_email text, account_pin text)
returns text language sql stable security definer set search_path = '' as $$
  select 'Lp1!' || encode(extensions.hmac(lower(trim(account_email)) || ':' || account_pin, secret, 'sha256'), 'hex')
  from ledger_pin_private.key_material where account_pin ~ '^[0-9]{4}$'
$$;

create function public.ledger_pin_attempt(account_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  insert into ledger_pin_private.attempts as a (user_id, started, attempts)
    select id, now(), 1 from auth.users where lower(email) = lower(trim(account_email))
    on conflict (user_id) do update set
      attempts = case when a.started <= now() - interval '1 day' then 1 else a.attempts + 1 end,
      started = case when a.started <= now() - interval '1 day' then now() else a.started end
    where a.attempts < 5 or a.started <= now() - interval '1 day'
    returning true into allowed;
  return coalesce(allowed,false);
end $$;

create function public.ledger_pin_clear(account_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from ledger_pin_private.attempts where user_id = account_id
$$;
revoke all on function public.ledger_pin_credential(text,text), public.ledger_pin_attempt(text), public.ledger_pin_clear(uuid) from public,anon,authenticated;
grant execute on function public.ledger_pin_credential(text,text), public.ledger_pin_attempt(text), public.ledger_pin_clear(uuid) to service_role;
commit;
