create table if not exists public.rate_limit_windows (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);
alter table public.rate_limit_windows enable row level security;
revoke all on public.rate_limit_windows from public, anon, authenticated;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare started timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(1,p_window_seconds)) * greatest(1,p_window_seconds)); row_count integer; allowed boolean;
begin
  if p_key is null or p_key = '' or p_limit < 1 then raise exception 'invalid_rate_limit'; end if;
  insert into public.rate_limit_windows(key, window_start, count) values (p_key, started, 1)
  on conflict (key, window_start) do update set count = rate_limit_windows.count + 1
  returning count into row_count;
  allowed := row_count <= p_limit;
  if not allowed then update public.rate_limit_windows set count = count - 1 where key=p_key and window_start=started; end if;
  return jsonb_build_object('allowed', allowed, 'retry_after', greatest(1, extract(epoch from (started + make_interval(secs=>greatest(1,p_window_seconds)) - now()))::integer));
end; $$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
