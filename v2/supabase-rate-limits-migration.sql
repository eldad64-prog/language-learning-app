-- Persistent API rate limits for Lingua V2 Edge Function.
-- Apply once in Supabase SQL Editor; safe to re-run.
begin;
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, action)
);
revoke all on public.api_rate_limits from anon, authenticated;
create or replace function public.consume_api_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer
set search_path = '' as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_user_id is null or p_action not in ('admin','sync_achievements')
     or p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits(user_id, action, window_started_at, request_count)
  values (p_user_id, p_action, v_window, 1)
  on conflict (user_id, action) do update
    set window_started_at = excluded.window_started_at,
        request_count = case
          when public.api_rate_limits.window_started_at < excluded.window_started_at then 1
          else public.api_rate_limits.request_count + 1
        end
    where public.api_rate_limits.window_started_at < excluded.window_started_at
       or public.api_rate_limits.request_count < p_limit
  returning request_count into v_count;
  return found;
end;
$$;
revoke all on function public.consume_api_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(uuid,text,integer,integer) to service_role;
commit;
