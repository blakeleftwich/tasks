-- Card attachments ("+ Add something" → Image / File).
-- Run in the Supabase SQL Editor. Until it runs, attachments still work
-- locally; they just don't sync (the app probe-gates the column), and
-- signed-in uploads will fail until the bucket below exists.

-- 1) Small metadata on the task row (kind/name/url/path — never file bytes,
--    so realtime task syncs stay light).
alter table public.tasks
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 2) The files themselves live in a public storage bucket. URLs contain
--    random ids, matching the app's share-by-link (capability URL) model.
insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', true)
  on conflict (id) do nothing;

-- Any signed-in user can upload; only the uploader can delete their file.
-- (Wrapped so re-running this file doesn't error on existing policies.)
do $$ begin
  create policy "attachments upload" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'attachments');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "attachments delete own" on storage.objects
    for delete to authenticated
    using (bucket_id = 'attachments' and owner = auth.uid());
exception when duplicate_object then null; end $$;
