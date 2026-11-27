-- Shared cloud backups ("board snapshots")
-- Run once in the Supabase SQL Editor (project jyccdxemtaeegyuotyfz).
--
-- Every member's app saves periodic snapshots of the whole project (tasks +
-- tabs) into this table — roughly one per half hour of activity, plus always
-- right before a tab or task set is deleted and before a restore. Any member
-- can then restore the project from the account menu → Backups…, no matter
-- whose browser made the mistake or which device holds a local backup.
-- The app keeps the newest 20 snapshots per project and prunes the rest.
--
-- The app probes for this table on sign-in and works fine before this runs
-- (local, per-browser backups only).

create table if not exists public.board_snapshots (
  id          text primary key,
  board_id    text not null references public.boards (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid not null references auth.users (id) on delete cascade,
  by_email    text,                        -- shown in the Backups list
  reason      text,                        -- 'auto' | 'before deleting …' | …
  task_count  integer not null default 0,  -- list display without pulling jsonb
  tab_count   integer not null default 0,
  tasks       jsonb not null,
  tabs        jsonb
);

create index if not exists board_snapshots_board_idx
  on public.board_snapshots (board_id, created_at desc);

alter table public.board_snapshots enable row level security;

drop policy if exists "members read snapshots" on public.board_snapshots;
create policy "members read snapshots" on public.board_snapshots
  for select using (public.is_board_member(board_id));

drop policy if exists "members create snapshots" on public.board_snapshots;
create policy "members create snapshots" on public.board_snapshots
  for insert with check (public.is_board_member(board_id) and created_by = auth.uid());

-- Needed so clients can prune beyond the newest 20 per project.
drop policy if exists "members delete snapshots" on public.board_snapshots;
create policy "members delete snapshots" on public.board_snapshots
  for delete using (public.is_board_member(board_id));
