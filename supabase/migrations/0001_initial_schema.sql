-- Language Learning: isolated Supabase schema
-- Apply only inside the new "Language Learning" Supabase project.
-- This migration does not touch the Loan Management project.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One profile per authenticated account (Eldad and Liora use separate auth accounts).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  preferred_ui_language text not null default 'he' check (preferred_ui_language in ('he','en','th')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, 'Learner'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_language_learning on auth.users;
create trigger on_auth_user_created_language_learning
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.learning_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('word','sentence')),
  target_language text not null check (target_language in ('th','en')),
  category text not null,
  target_text text not null,
  transliteration text,
  hebrew_translation text,
  english_translation text,
  difficulty smallint check (difficulty between 1 and 5),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_type, target_language, category, target_text)
);

create table if not exists public.user_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.learning_items(id) on delete cascade,
  times_practiced integer not null default 0 check (times_practiced >= 0),
  times_correct integer not null default 0 check (times_correct >= 0),
  times_incorrect integer not null default 0 check (times_incorrect >= 0),
  is_learned boolean not null default false,
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.custom_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('word','sentence')),
  target_language text not null check (target_language in ('th','en')),
  target_text text not null,
  transliteration text,
  hebrew_translation text,
  english_translation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.learning_items(id) on delete set null,
  custom_item_id uuid references public.custom_items(id) on delete set null,
  target_language text not null check (target_language in ('th','en')),
  storage_path text not null unique,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  check (item_id is not null or custom_item_id is not null)
);

create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_type text not null check (test_type in ('word','sentence','mixed','listening')),
  target_language text not null check (target_language in ('th','en')),
  question_count integer not null check (question_count between 1 and 100),
  correct_count integer not null default 0 check (correct_count between 0 and question_count),
  score_percent numeric(5,2) generated always as (
    case when question_count = 0 then 0
    else round((correct_count::numeric * 100) / question_count, 2) end
  ) stored,
  completed_at timestamptz not null default now()
);

create table if not exists public.test_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.learning_items(id) on delete set null,
  custom_item_id uuid references public.custom_items(id) on delete set null,
  was_correct boolean not null,
  answered_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_target_language text not null default 'th' check (default_target_language in ('th','en')),
  speech_rate numeric(3,2) not null default 0.85 check (speech_rate between 0.5 and 1.5),
  show_hebrew_transliteration boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists learning_items_lookup_idx
  on public.learning_items (target_language, item_type, category, sort_order)
  where is_active = true;
create index if not exists user_progress_user_recent_idx
  on public.user_progress (user_id, last_practiced_at desc);
create index if not exists custom_items_user_idx
  on public.custom_items (user_id, target_language, item_type, created_at desc);
create index if not exists recordings_user_idx
  on public.recordings (user_id, created_at desc);
create index if not exists test_attempts_user_idx
  on public.test_attempts (user_id, completed_at desc);
create index if not exists test_answers_user_idx
  on public.test_answers (user_id, created_at desc);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
drop trigger if exists learning_items_updated_at on public.learning_items;
create trigger learning_items_updated_at before update on public.learning_items
  for each row execute procedure public.set_updated_at();
drop trigger if exists user_progress_updated_at on public.user_progress;
create trigger user_progress_updated_at before update on public.user_progress
  for each row execute procedure public.set_updated_at();
drop trigger if exists custom_items_updated_at on public.custom_items;
create trigger custom_items_updated_at before update on public.custom_items
  for each row execute procedure public.set_updated_at();
drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute procedure public.set_updated_at();

-- Row Level Security: catalog is readable by signed-in learners; personal records are owner-only.
alter table public.profiles enable row level security;
alter table public.learning_items enable row level security;
alter table public.user_progress enable row level security;
alter table public.custom_items enable row level security;
alter table public.recordings enable row level security;
alter table public.test_attempts enable row level security;
alter table public.test_answers enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "learning_items_read_authenticated" on public.learning_items;
create policy "learning_items_read_authenticated" on public.learning_items
  for select to authenticated using (is_active = true);

drop policy if exists "user_progress_select_own" on public.user_progress;
create policy "user_progress_select_own" on public.user_progress
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "user_progress_insert_own" on public.user_progress;
create policy "user_progress_insert_own" on public.user_progress
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "user_progress_update_own" on public.user_progress;
create policy "user_progress_update_own" on public.user_progress
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "user_progress_delete_own" on public.user_progress;
create policy "user_progress_delete_own" on public.user_progress
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "custom_items_owner_all" on public.custom_items;
create policy "custom_items_owner_all" on public.custom_items
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "recordings_owner_all" on public.recordings;
create policy "recordings_owner_all" on public.recordings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "test_attempts_owner_all" on public.test_attempts;
create policy "test_attempts_owner_all" on public.test_attempts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "test_answers_owner_all" on public.test_answers;
create policy "test_answers_owner_all" on public.test_answers
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "user_settings_owner_all" on public.user_settings;
create policy "user_settings_owner_all" on public.user_settings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Private bucket for learner voice recordings. Paths must begin with the caller's auth UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pronunciation-recordings', 'pronunciation-recordings', false, 10485760,
        array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recordings_storage_read_own" on storage.objects;
create policy "recordings_storage_read_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'pronunciation-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "recordings_storage_insert_own" on storage.objects;
create policy "recordings_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pronunciation-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "recordings_storage_update_own" on storage.objects;
create policy "recordings_storage_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'pronunciation-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'pronunciation-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "recordings_storage_delete_own" on storage.objects;
create policy "recordings_storage_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pronunciation-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- No service-role key belongs in the browser or in this repository.
