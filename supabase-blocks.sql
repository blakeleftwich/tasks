-- Card body blocks: a task can hold any number of text boxes and checklists,
-- in order, stored as one jsonb array:
--   [{id, type:"text", text} | {id, type:"checklist", items:[{id,text,done}]}]
-- Run in the Supabase SQL Editor. Until it runs, the app still syncs a
-- flattened fallback through the legacy notes/checklist columns (first-ish
-- text/checklist survive; extra blocks stay local), so nothing breaks.

alter table public.tasks
  add column if not exists blocks jsonb;
