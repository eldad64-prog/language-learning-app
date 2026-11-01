-- Lingua V2 / repeatable Supabase PostgreSQL schema.
-- Safe to re-run on a project created from this schema. Review existing installations
-- before applying; CREATE TABLE IF NOT EXISTS does not retrofit arbitrary old columns.
-- Never expose the service_role key in browser code.

begin;
create extension if not exists pgcrypto;

do $$ begin
  create type public.approval_state as enum ('pending','approved','rejected','suspended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.content_state as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  learning_language text not null check (learning_language in ('he','en','th')),
  translation_language text not null check (translation_language in ('he','en','th')),
  approval_status public.approval_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distinct_languages check (learning_language <> translation_language)
);
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  learning_language text not null check (learning_language in ('he','en','th')),
  translation_language text not null check (translation_language in ('he','en','th')),
  item_type text not null check (item_type in ('word','sentence')),
  category text not null default 'general',
  source_text text not null,
  translation_text text not null,
  transliteration text,
  audio_url text,
  status public.content_state not null default 'draft',
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  mastery smallint not null default 0 check (mastery between 0 and 5),
  times_seen integer not null default 0 check (times_seen >= 0),
  times_correct integer not null default 0 check (times_correct >= 0),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,content_item_id)
);
create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language_pair text not null,
  score numeric(5,2) not null check (score between 0 and 100),
  question_count integer not null check (question_count > 0),
  correct_count integer not null check (correct_count between 0 and question_count),
  completed_at timestamptz not null default now()
);
create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('login','study','test','achievement')),
  content_item_id uuid references public.content_items(id) on delete set null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, action)
);

create or replace function public.consume_api_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer
set search_path = '' as $
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
$;
revoke all on public.api_rate_limits from anon, authenticated;
revoke all on function public.consume_api_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(uuid,text,integer,integer) to service_role;

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null check (char_length(achievement_key) between 1 and 80),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  awarded_at timestamptz not null default now(),
  unique(user_id, achievement_key)
);

-- Admin identity is an immutable app_metadata claim set only by a trusted operator.
create or replace function public.is_owner_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner_admin', false);
$$;
create or replace function public.is_approved_user()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved');
$$;
create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  learning text := coalesce(new.raw_user_meta_data ->> 'learning_language','th');
  translation text := coalesce(new.raw_user_meta_data ->> 'translation_language','he');
  display_name text := coalesce(new.raw_user_meta_data ->> 'display_name','Learner');
begin
  if learning not in ('he','en','th') or translation not in ('he','en','th') or learning = translation then
    learning := 'th'; translation := 'he';
  end if;
  insert into public.profiles(id,display_name,learning_language,translation_language)
  values(new.id,left(display_name,60),learning,translation)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.guard_profile_changes()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    new.updated_at := now(); return new;
  end if;
  if new.id <> old.id or new.approval_status <> old.approval_status then
    raise exception 'Protected profile fields can only be changed by trusted administration';
  end if;
  new.updated_at := now(); return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
for each row execute procedure public.guard_profile_changes();

alter table public.profiles enable row level security;
alter table public.content_items enable row level security;
alter table public.user_progress enable row level security;
alter table public.test_results enable row level security;
alter table public.learning_events enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.user_achievements enable row level security;

revoke all on public.profiles, public.content_items, public.user_progress, public.test_results,
  public.learning_events, public.admin_audit_log, public.user_achievements from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name,learning_language,translation_language) on public.profiles to authenticated;
grant select on public.content_items to authenticated;
grant select,insert,update,delete on public.user_progress to authenticated;
grant select,insert on public.test_results to authenticated;
grant select,insert on public.learning_events to authenticated;
grant select on public.admin_audit_log, public.user_achievements to authenticated;

drop policy if exists "profile self or owner admin read" on public.profiles;
create policy "profile self or owner admin read" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_owner_admin()));
drop policy if exists "profile self update preferences" on public.profiles;
create policy "profile self update preferences" on public.profiles for update to authenticated
using (id = (select auth.uid()) and approval_status = 'approved')
with check (id = (select auth.uid()) and approval_status = 'approved');
drop policy if exists "approved users read published content" on public.content_items;
create policy "approved users read published content" on public.content_items for select to authenticated
using ((status = 'published' and (select public.is_approved_user())) or (select public.is_owner_admin()));
drop policy if exists "owner admin manage content" on public.content_items;
create policy "owner admin manage content" on public.content_items for all to authenticated
using ((select public.is_owner_admin())) with check ((select public.is_owner_admin()));
drop policy if exists "users manage own progress" on public.user_progress;
create policy "users manage own progress" on public.user_progress for all to authenticated
using (user_id = (select auth.uid()) and (select public.is_approved_user()))
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
drop policy if exists "users read own tests" on public.test_results;
create policy "users read own tests" on public.test_results for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));
drop policy if exists "users insert own tests" on public.test_results;
create policy "users insert own tests" on public.test_results for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
drop policy if exists "users read own events" on public.learning_events;
create policy "users read own events" on public.learning_events for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));
drop policy if exists "users insert own events" on public.learning_events;
create policy "users insert own events" on public.learning_events for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
drop policy if exists "owner admin read audit log" on public.admin_audit_log;
create policy "owner admin read audit log" on public.admin_audit_log for select to authenticated
using ((select public.is_owner_admin()));
drop policy if exists "owner admin read all progress" on public.user_progress;
create policy "owner admin read all progress" on public.user_progress for select to authenticated
using ((select public.is_owner_admin()));
drop policy if exists "users read own achievements" on public.user_achievements;
create policy "users read own achievements" on public.user_achievements for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));

create index if not exists content_items_published_pair_idx
  on public.content_items(learning_language,translation_language,item_type,category) where status='published';
create index if not exists profiles_approval_created_idx on public.profiles(approval_status,created_at desc);
create index if not exists learning_events_user_created_idx on public.learning_events(user_id,created_at desc);
create index if not exists test_results_user_completed_idx on public.test_results(user_id,completed_at desc);
create index if not exists user_achievements_user_awarded_idx on public.user_achievements(user_id,awarded_at desc);

-- Bootstrap the owner only after verifying the exact Auth user UUID in the Supabase SQL editor:
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"owner_admin"}'::jsonb where id='<VERIFIED_OWNER_UUID>';
-- update public.profiles set approval_status='approved' where id='<VERIFIED_OWNER_UUID>';
-- Never place service_role credentials in browser code or send them in chat.
commit;
