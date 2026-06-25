-- Daily Task Board — Checklist (sub-steps inside a task)
-- Run this in the Supabase SQL Editor (once). Adds a JSON column that stores
-- each task's checklist items: [{ "id": "...", "text": "...", "done": false }, ...]

alter table public.tasks
  add column if not exists checklist jsonb not null default '[]'::jsonb;
