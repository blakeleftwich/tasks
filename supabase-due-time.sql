-- Due time on tasks (alongside the due date), for same-day todo lists.
-- Run once in the Supabase SQL Editor (project jyccdxemtaeegyuotyfz).
--
-- Stored as "HH:MM" (24h) text, exactly as the app's <input type="time">
-- produces it. The app probes for this column on sign-in and works fine
-- before this runs (times then stay on the device that set them).

alter table public.tasks add column if not exists due_time text;
