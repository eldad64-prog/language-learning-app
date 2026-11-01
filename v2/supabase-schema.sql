-- Lingua V2 / Supabase PostgreSQL schema
-- Apply only after reviewing in a non-production Supabase project.
-- Never expose the service_role key in browser code.

create extension if not exists pgcrypto;

create type public.approval_state as enum ('pending','approved','rejected','suspended');
create type public.content_state as enum ('draft','published','archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  learning_language text not null check (learning_language in ('he','en','th')),
  translation_language text not null check (translation_language in ('he','en','th')),
  approval_status public.approval_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distinct_languages check (learning_language <> translation_language)
);

create table public.content_items (
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

create table public.user_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  mastery smallint not null default 0 check (mastery between 0 and 5),
  times_seen integer not null default 0 check (times_seen >= 0),
  times_correct integer not null default 0 check (times_correct >= 0),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,content_item_id)
);

create table public.test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language_pair text not null,
  score numeric(5,2) not null check (score between 0 and 100),
  question_count integer not null check (question_count > 0),
  correct_count integer not null check (correct_count between 0 and question_count),
  completed_at timestamptz not null default now()
);

create table public.learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('login','study','test','achievement')),
  content_item_id uuid references public.content_items(id) on delete set null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Admin identity is an immutable app_metadata claim set only by a trusted operator.
-- Clients cannot update auth.users.raw_app_meta_data. Do NOT use user_metadata or profiles.role.
create or replace function public.is_owner_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'owner_admin', false);
$$;

create or replace function public.is_approved_user()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approval_status = 'approved'
  );
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
  values(new.id,left(display_name,60),learning,translation);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.guard_profile_changes()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.id <> old.id or new.approval_status <> old.approval_status then
    raise exception 'Protected profile fields can only be changed by trusted administration';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
for each row execute procedure public.guard_profile_changes();

alter table public.profiles enable row level security;
alter table public.content_items enable row level security;
alter table public.user_progress enable row level security;
alter table public.test_results enable row level security;
alter table public.learning_events enable row level security;
alter table public.admin_audit_log enable row level security;

-- Revoke broad defaults; grant only the operations required by the app.
revoke all on public.profiles, public.content_items, public.user_progress, public.test_results, public.learning_events, public.admin_audit_log from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name,learning_language,translation_language) on public.profiles to authenticated;
grant select on public.content_items to authenticated;
grant select,insert,update,delete on public.user_progress to authenticated;
grant select,insert on public.test_results to authenticated;
grant select,insert on public.learning_events to authenticated;
grant select on public.admin_audit_log to authenticated;

create policy "profile self or owner admin read" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_owner_admin()));
create policy "profile self update preferences" on public.profiles for update to authenticated
using (id = (select auth.uid()) and approval_status = 'approved')
with check (id = (select auth.uid()) and approval_status = 'approved');

create policy "approved users read published content" on public.content_items for select to authenticated
using ((status = 'published' and (select public.is_approved_user())) or (select public.is_owner_admin()));
create policy "owner admin manage content" on public.content_items for all to authenticated
using ((select public.is_owner_admin())) with check ((select public.is_owner_admin()));

create policy "users manage own progress" on public.user_progress for all to authenticated
using (user_id = (select auth.uid()) and (select public.is_approved_user()))
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
create policy "users read own tests" on public.test_results for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));
create policy "users insert own tests" on public.test_results for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
create policy "users read own events" on public.learning_events for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));
create policy "users insert own events" on public.learning_events for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.is_approved_user()));
create policy "owner admin read audit log" on public.admin_audit_log for select to authenticated
using ((select public.is_owner_admin()));

-- IMPORTANT operational steps (trusted SQL editor / server-side only):
-- 1) Create the first owner account through Supabase Auth signup.
-- 2) Obtain that account's UUID from auth.users after verifying ownership.
-- 3) In the Supabase SQL editor, set ONLY that verified UUID's app_metadata claim:
--    update auth.users
--    set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"owner_admin"}'::jsonb
--    where id = '<VERIFIED_OWNER_UUID>';
-- 4) Approve the owner profile using the trusted SQL editor:
--    update public.profiles set approval_status='approved' where id='<VERIFIED_OWNER_UUID>';
-- 5) Admin approval/suspension/content publishing should be exposed through Edge Functions
--    that validate is_owner_admin() server-side, validate input, rate-limit, and append audit rows.
-- 6) Do not expose this SQL editor, service key, or any admin credential to ordinary users.
-- 7) Review RLS with at least two ordinary test accounts before launch.
