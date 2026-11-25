create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists ledger_jobs;
revoke all on schema ledger_jobs from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name='health_card_scheduler_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'health_card_scheduler_token');
  end if;
end $$;

create or replace function public.verify_health_card_scheduler(p_token text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from vault.decrypted_secrets
    where name='health_card_scheduler_token' and decrypted_secret=p_token);
$$;
revoke all on function public.verify_health_card_scheduler(text) from public, anon, authenticated;
grant execute on function public.verify_health_card_scheduler(text) to service_role;

create or replace function ledger_jobs.run_health_card_reminders()
returns bigint language sql security invoker set search_path='' as $$
  select net.http_post(
    url := 'https://qvwgmybocjyhldwnrqqt.supabase.co/functions/v1/health-card-reminders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || decrypted_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
  from vault.decrypted_secrets where name='health_card_scheduler_token';
$$;
revoke all on function ledger_jobs.run_health_card_reminders() from public, anon, authenticated;
-- Evaluate Beirut time in the database so the dispatch follows daylight saving time.
select cron.schedule('employee-ledger-health-card-reminders','0 * * * *',
  $job$select ledger_jobs.run_health_card_reminders() where extract(hour from now() at time zone 'Asia/Beirut')=9$job$);
