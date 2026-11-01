-- Lingua V2 incremental migration: private achievements.
-- Safe to apply after supabase-schema.sql. Does not modify existing learner data.
create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null check (char_length(achievement_key) between 1 and 80),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  awarded_at timestamptz not null default now(),
  unique(user_id, achievement_key)
);

alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from anon, authenticated;
grant select on public.user_achievements to authenticated;

drop policy if exists "users read own achievements" on public.user_achievements;
create policy "users read own achievements"
on public.user_achievements for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_owner_admin()));

create index if not exists user_achievements_user_awarded_idx
on public.user_achievements(user_id, awarded_at desc);
