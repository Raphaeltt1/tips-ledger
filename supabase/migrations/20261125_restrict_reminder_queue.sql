-- pg_net is used only by the database scheduler. Its queue holds request headers.
revoke usage on schema net from public, anon, authenticated;
revoke all on table net.http_request_queue, net._http_response from public, anon, authenticated;
do $$
begin
  perform vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
  from vault.secrets where name='health_card_scheduler_token';
end $$;
