-- Live sync for project-level changes (tabs / task sets / renames).
-- The app already receives realtime events for the tasks table; this adds the
-- boards table to the same publication so edits to a project's tabs, task
-- sets, and name appear on other members' screens without a reload.
--
-- Run in the Supabase SQL Editor (project jyccdxemtaeegyuotyfz).
-- Safe to run once; re-running errors with "already member of publication",
-- which just means it is already done.
--
-- The app works without this migration: clients then catch up on the next
-- focus/reconnect resync instead of instantly.

alter publication supabase_realtime add table public.boards;
