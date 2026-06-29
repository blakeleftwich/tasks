-- Daily Task Board — Per-task tag selection
-- Run once in the Supabase SQL Editor.
--
-- The tag DEFINITIONS live per-category inside boards.columns (already synced).
-- This just adds the per-task field that stores which tag a task has selected.

alter table public.tasks add column if not exists tag text;
