-- Daily Task Board — Per-board tabs
-- Run once in the Supabase SQL Editor (after the earlier migrations).
--
-- A board can now hold several tabs; each tab owns its own columns AND its own
-- tasks. Clicking a tab switches both.

-- 1) Per-board tab list. Each tab carries its columns (the old single `columns`
--    shape, now nested per tab):
--    [{ "key": "...", "label": "To-Do", "columns": [{ "key": "...", "label": "...", "tags": [...] }] }, ...]
--    Left null for existing boards; the app wraps their current `columns` into a
--    single "To-Do" tab until they add another.
alter table public.boards add column if not exists tabs jsonb;

-- 2) Which tab a task belongs to (the owning tab's key). Null = the first tab,
--    so tasks created before this migration stay put.
alter table public.tasks add column if not exists tab text;
