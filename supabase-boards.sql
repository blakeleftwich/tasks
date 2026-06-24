-- Daily Task Board — Shared boards (personal + shareable team boards)
-- Run this in the Supabase SQL Editor AFTER supabase-schema.sql.
--
-- Adds a "board" layer: every task belongs to a board, and a board is shared by
-- sending its link (a teammate who opens it while signed in auto-joins). Access
-- is granted by board membership. Your existing tasks move into a personal
-- "My Tasks" board automatically.

-- ---------- Tables ----------
create table if not exists public.boards (
  id          text primary key,
  name        text not null default 'My Tasks',
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.board_members (
  board_id    text not null references public.boards (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (board_id, user_id)
);

alter table public.tasks
  add column if not exists board_id text references public.boards (id) on delete cascade;

create index if not exists tasks_board_idx on public.tasks (board_id);

-- ---------- Membership check (security definer avoids RLS recursion) ----------
create or replace function public.is_board_member(b text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = b and user_id = auth.uid()
  );
$$;

-- ---------- RLS ----------
alter table public.boards enable row level security;
alter table public.board_members enable row level security;

-- boards: members can read; any signed-in user can create a board they own / manage it
drop policy if exists "members read boards" on public.boards;
create policy "members read boards" on public.boards
  for select using (public.is_board_member(id));

drop policy if exists "create own board" on public.boards;
create policy "create own board" on public.boards
  for insert with check (owner_id = auth.uid());

drop policy if exists "owner updates board" on public.boards;
create policy "owner updates board" on public.boards
  for update using (owner_id = auth.uid());

drop policy if exists "owner deletes board" on public.boards;
create policy "owner deletes board" on public.boards
  for delete using (owner_id = auth.uid());

-- board_members: you manage only your own membership (join via link / leave)
drop policy if exists "read own membership" on public.board_members;
create policy "read own membership" on public.board_members
  for select using (user_id = auth.uid());

drop policy if exists "join board" on public.board_members;
create policy "join board" on public.board_members
  for insert with check (user_id = auth.uid());

drop policy if exists "leave board" on public.board_members;
create policy "leave board" on public.board_members
  for delete using (user_id = auth.uid());

-- tasks: replace any earlier policy with board-membership access
drop policy if exists "Users manage their own tasks" on public.tasks;
drop policy if exists "Team members share all tasks" on public.tasks; -- if Option 1 was tried
create policy "Board members manage tasks" on public.tasks
  for all
  using (public.is_board_member(board_id))
  with check (public.is_board_member(board_id));

-- ---------- Migrate existing data into personal boards ----------
insert into public.boards (id, name, owner_id)
select gen_random_uuid()::text, 'My Tasks', u.user_id
from (select distinct user_id from public.tasks where board_id is null) u
where not exists (select 1 from public.boards b where b.owner_id = u.user_id);

insert into public.board_members (board_id, user_id)
select b.id, b.owner_id from public.boards b
where not exists (
  select 1 from public.board_members m where m.board_id = b.id and m.user_id = b.owner_id
);

update public.tasks t
set board_id = b.id
from public.boards b
where b.owner_id = t.user_id and t.board_id is null;

-- ----------------------------------------------------------------------------
-- Share a board:  in the app, click "🔗 Share" to copy a join link.
-- Remove yourself: delete from public.board_members where user_id = auth.uid() and board_id = '...';
-- ----------------------------------------------------------------------------
