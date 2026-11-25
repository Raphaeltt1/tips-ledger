-- Only short-lived, single-use credentials enter the HTTP queue.
create table ledger_jobs.reminder_dispatch_tokens (
  token_hash bytea primary key,
  expires_at timestamptz not null
);
revoke all on ledger_jobs.reminder_dispatch_tokens from public, anon, authenticated;

create or replace function ledger_jobs.run_health_card_reminders()
returns bigint language plpgsql security invoker set search_path='' as $$
declare
  token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  delete from ledger_jobs.reminder_dispatch_tokens where expires_at<=now();
  insert into ledger_jobs.reminder_dispatch_tokens values (extensions.digest(token,'sha256'), now()+interval '2 minutes');
  return net.http_post(
    url := 'https://qvwgmybocjyhldwnrqqt.supabase.co/functions/v1/health-card-reminders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;

create or replace function public.verify_health_card_scheduler(p_token text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  delete from ledger_jobs.reminder_dispatch_tokens
    where token_hash=extensions.digest(p_token,'sha256') and expires_at>now();
  return found;
end $$;
