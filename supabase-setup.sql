-- Language Learning App: private cloud sync
-- Run this once in Supabase SQL Editor.
create table if not exists public.language_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.language_app_state enable row level security;

drop policy if exists "Users can read their own language app state" on public.language_app_state;
create policy "Users can read their own language app state"
  on public.language_app_state for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own language app state" on public.language_app_state;
create policy "Users can insert their own language app state"
  on public.language_app_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own language app state" on public.language_app_state;
create policy "Users can update their own language app state"
  on public.language_app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.language_app_state to authenticated;
