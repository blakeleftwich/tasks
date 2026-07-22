-- Adds the per-task assignee ("Assign to" under a card's More section).
-- Stored as free text (a person's name), not a user id — works for
-- signed-out use and for people who aren't project members.
-- Run this in the Supabase SQL Editor. Until it runs, assignees still
-- work locally; they just don't sync (the app probe-gates the column).

alter table public.tasks
  add column if not exists assignee text;
