-- Language Learning app: isolated Supabase schema
-- Run this only in the NEW Language Learning Supabase project.
-- This script does not modify the existing Loan Management project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('word','sentence')),
  source_language text not null,
  target_language text not null,
  source_text text not null,
  target_text text not null,
  hebrew_transliteration text,
  latin_transliteration text,
  topic text not null default 'כללי',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_items_distinct_languages check (source_language <> target_language)
);

create index if not exists learning_items_lookup_idx
  on public.learning_items (item_type, source_language, target_language, topic);

create table if not exists public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.learning_items(id) on delete cascade,
  learned boolean not null default false,
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists learning_progress_user_idx
  on public.learning_progress (user_id, learned);

create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('word','sentence')),
  source_language text not null,
  target_language text not null,
  total_questions integer not null check (total_questions > 0),
  correct_answers integer not null check (correct_answers >= 0 and correct_answers <= total_questions),
  answers jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now()
);

create index if not exists test_attempts_user_date_idx
  on public.test_attempts (user_id, completed_at desc);

create table if not exists public.pronunciation_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.learning_items(id) on delete set null,
  language_code text not null,
  storage_path text not null unique,
  transcript text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists pronunciation_recordings_user_idx
  on public.pronunciation_recordings (user_id, created_at desc);

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists learning_items_set_updated_at on public.learning_items;
create trigger learning_items_set_updated_at before update on public.learning_items
for each row execute function public.set_updated_at();

drop trigger if exists learning_progress_set_updated_at on public.learning_progress;
create trigger learning_progress_set_updated_at before update on public.learning_progress
for each row execute function public.set_updated_at();

-- Create a private profile row automatically for each newly registered account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Row Level Security: each learner sees only their own profile, progress,
-- tests and recordings. Published shared learning content is readable by both.
alter table public.profiles enable row level security;
alter table public.learning_items enable row level security;
alter table public.learning_progress enable row level security;
alter table public.test_attempts enable row level security;
alter table public.pronunciation_recordings enable row level security;

drop policy if exists "profile_select_own" on public.profiles;
create policy "profile_select_own" on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "learning_items_read_published_or_own" on public.learning_items;
create policy "learning_items_read_published_or_own" on public.learning_items
for select to authenticated
using (is_published = true or created_by = (select auth.uid()));

drop policy if exists "learning_items_insert_own" on public.learning_items;
create policy "learning_items_insert_own" on public.learning_items
for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "learning_items_update_own" on public.learning_items;
create policy "learning_items_update_own" on public.learning_items
for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "learning_items_delete_own" on public.learning_items;
create policy "learning_items_delete_own" on public.learning_items
for delete to authenticated
using (created_by = (select auth.uid()));

drop policy if exists "progress_all_own" on public.learning_progress;
create policy "progress_all_own" on public.learning_progress
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "tests_all_own" on public.test_attempts;
create policy "tests_all_own" on public.test_attempts
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "recordings_all_own" on public.pronunciation_recordings;
create policy "recordings_all_own" on public.pronunciation_recordings
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Private audio bucket. Files must be stored under <auth-user-id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pronunciation-recordings', 'pronunciation-recordings', false, 10485760,
        array['audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a'])
on conflict (id) do update
set public = false, file_size_limit = 10485760,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "audio_read_own_folder" on storage.objects;
create policy "audio_read_own_folder" on storage.objects
for select to authenticated
using (bucket_id = 'pronunciation-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio_upload_own_folder" on storage.objects;
create policy "audio_upload_own_folder" on storage.objects
for insert to authenticated
with check (bucket_id = 'pronunciation-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio_update_own_folder" on storage.objects;
create policy "audio_update_own_folder" on storage.objects
for update to authenticated
using (bucket_id = 'pronunciation-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'pronunciation-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "audio_delete_own_folder" on storage.objects;
create policy "audio_delete_own_folder" on storage.objects
for delete to authenticated
using (bucket_id = 'pronunciation-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Explicit API privileges. RLS remains the row-level security boundary.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.learning_items to authenticated;
grant select, insert, update, delete on public.learning_progress to authenticated;
grant select, insert, update, delete on public.test_attempts to authenticated;
grant select, insert, update, delete on public.pronunciation_recordings to authenticated;

-- Notes:
-- 1) Do not expose service_role or database passwords in the app.
-- 2) Use the anon/publishable key only together with the RLS policies above.
-- 3) This schema is separate from Loan Management and must be run only
--    in the newly created Language Learning project.
