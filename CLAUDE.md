# CLAUDE.md — Daily Task Board

## Overview
Single-page task/project board. Categories (columns) hold cards (tasks); cards have a description, checklist, due date, color, and a tag. **Vanilla HTML/CSS/JS, no build step, no framework.** Hosted on Vercel; optional cloud sync + shared boards via Supabase.

## Key files
- `index.html` — markup + the `<template id="card-template">` cards are cloned from.
- `app.js` — the entire app (one module): data model, `render()`, custom pointer drag, Supabase sync/auth, categories, tags, keyboard shortcuts.
- `styles.css` — all styles.
- `config.js` — Supabase URL + **publishable** anon key (public by design; safe to commit — RLS enforces access).
- `supabase-*.sql` — one migration file per feature; the user runs them in the Supabase SQL Editor.
- `lab.html` — standalone UX sandbox (not part of the app).

## Architecture
- **Local-first**: everything saves to `localStorage` on every change (works signed-out/offline). Keys: `taskManager.v2` (tasks), `taskManager.categories.v1` (categories), `currentBoardId`, `stackedView`.
- **Cloud (signed in)**: Supabase `tasks` / `boards` / `board_members` tables, RLS-scoped per user/board, realtime on `tasks`. Browser talks to Supabase directly (no server). Magic-link auth.
- **Data model**: task `status`=category key, `tag`=tag key, `label`=color key, `completed`=bool, plus day/position/title/notes/due/checklist. Categories = `[{key,label,tags:[{key,label,color}]}]` stored per-board in `boards.columns` (synced) or localStorage (signed-out).

## Conventions
- **Commit + push every completed change** (push to `main` auto-deploys via Vercel). The user verifies on the live site, not the in-harness preview. Pause before destructive/irreversible DB actions.
- **New DB columns are probe-gated**: add a `*Syncable` flag set by a `select <col> limit 1` probe on sign-in; only write the field when present. This keeps the app working before the migration is run. Ship code + provide the SQL.
- **Drag** is custom pointer-based and **mouse-only**; cards and categories share the floating-clone + dashed-placeholder pattern.
- Match surrounding style: plain functions, `const`/`let`, no framework, small focused helpers.

## Testing note
The in-harness preview reports `innerWidth: 0` (mobile layout) and screenshots time out — verify behavior with `preview_eval` running real handlers, and **reload between tests** (in-memory state leaks otherwise).
