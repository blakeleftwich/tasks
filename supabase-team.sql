-- Daily Task Board — Team mode (one shared list via an email allowlist)
-- Run this in the Supabase SQL Editor AFTER supabase-schema.sql.
--
-- It switches the board from "private, per user" to "one shared list" that
-- everyone whose email is in team_members can read and edit. Realtime sync
-- (already built into the app) makes edits show up live for everyone.

-- 1) The allowlist: who is on the team.
create table if not exists public.team_members (
  email text primary key
);
alter table public.team_members enable row level security;
-- No client policies on purpose — the allowlist is managed here, not from the app.

-- 2) Add yourself + each teammate. Use the exact email each person signs in with.
--    ⚠ If your sign-in email is missing here, you will lose access to the board.
insert into public.team_members (email) values
  ('blakeleftwich@gmail.com')        -- you (change if you sign in with another address)
  -- , ('teammate@example.com')
  -- , ('another.teammate@example.com')
on conflict (email) do nothing;

-- 3) Membership check that bypasses team_members' RLS (security definer).
create or replace function public.is_team_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

-- 4) Swap the per-user policy for a shared team policy.
drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Team members share all tasks"
  on public.tasks
  for all
  using (public.is_team_member())
  with check (public.is_team_member());

-- ----------------------------------------------------------------------------
-- To add someone later:    insert into public.team_members (email) values ('x@y.com');
-- To remove someone:       delete from public.team_members where email = 'x@y.com';
-- To go back to private:   drop policy "Team members share all tasks" on public.tasks;
--   then recreate the per-user policy from supabase-schema.sql.
-- ----------------------------------------------------------------------------
