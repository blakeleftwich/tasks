-- Daily Task Board — Editable categories + in-place "complete"
-- Run once in the Supabase SQL Editor (after the earlier migrations).

-- 1) Let a task's status be any category key (was limited to todo/inProgress/done).
alter table public.tasks drop constraint if exists tasks_status_check;

-- 2) Per-task completion toggled by the check circle (dim + strikethrough, no move).
alter table public.tasks add column if not exists completed boolean not null default false;

-- 3) Per-board category list (the columns): [{ "key": "...", "label": "..." }, ...]
--    Left null for existing boards; the app falls back to To Do / In Progress / Done
--    until you rename or add a category.
alter table public.boards add column if not exists columns jsonb;
