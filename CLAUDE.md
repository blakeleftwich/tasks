# CLAUDE.md — Project Board (formerly "Daily Task Board")

## Overview
Single-page **project board** — **no longer date-based** (was a daily board). Hierarchy: **Projects** (code: `boards`) → optional **Tabs** → **Task Sets** (UI name; code: `categories`/columns) → **tasks** (code/UI: cards). Cards have a description, checklist, due date, color, and a tag. **Vanilla HTML/CSS/JS, no build step, no framework.** Hosted on Vercel; optional cloud sync + shared projects via Supabase.

**UI vs code terminology** (renamed for users; code kept old names): board→**Project**, category/column→**Task Set**, "Daily Task Board"→**New Project**. Default view is **stacked** (vertical).

## Key files
- `index.html` — markup + the `<template id="card-template">` cards are cloned from.
- `app.js` — the entire app (one module): data model, `render()`, custom pointer drag, Supabase sync/auth, categories, tags, keyboard shortcuts.
- `styles.css` — all styles.
- `config.js` — Supabase URL + **publishable** anon key (public by design; safe to commit — RLS enforces access).
- `supabase-*.sql` — one migration file per feature; the user runs them in the Supabase SQL Editor.
- `lab.html` — standalone UX sandbox (not part of the app).

## Architecture
- **Local-first**: everything saves to `localStorage` on every change (works signed-out/offline). Keys: `taskManager.v2` (tasks), `taskManager.tabs.v1` (`{tabs, activeTabKey}`; replaced `taskManager.categories.v1`), `boardThemes` (per-project theme, **local-only**), `collapsedSets`, `taskManager.backups.v1` (safety snapshot), `currentBoardId`, `stackedView`.
- **Cloud (signed in)**: Supabase `tasks` / `boards` / `board_members` tables, RLS-scoped per user/project, realtime on `tasks`. Browser talks to Supabase directly (no server). Magic-link auth.
- **Data model**: task `status`=task-set key, `tab`=tab key, `tag`, `label`=color, `completed`, `position`, title/notes/due/checklist. **`day` is VESTIGIAL** — kept only because DB `tasks.day` is `NOT NULL` (new tasks stamp today); **not used for filtering** (a set shows all its tasks regardless of day). Tabs = per-project `[{key,label,columns:[{key,label,tags:[…]}]}]` in `boards.tabs` (jsonb, probe-gated) or localStorage.
- **Tab keys**: the first/"Main" tab uses the FIXED constant `DEFAULT_TAB_KEY = "default"` (never `makeId()`). Random per-load keys previously made tasks "vanish" across clients/reloads. Safety nets: `taskBelongsToTab()` homes unknown-tab tasks to the first tab (never hidden); `adoptOrphanTasks()` heals + persists. See [[tab-keys-must-be-deterministic]].

## Conventions
- **Commit + push every completed change** (push to `main` auto-deploys via Vercel). The user verifies on the live site, not the in-harness preview. Pause before destructive/irreversible DB actions.
- **New DB columns are probe-gated**: add a `*Syncable` flag set by a `select <col> limit 1` probe on sign-in; only write the field when present. This keeps the app working before the migration is run. Ship code + provide the SQL.
- **Drag** is custom pointer-based, **mouse + touch** (touch = long-press to pick up). Cards, task sets, and tabs share the floating-clone + dashed-placeholder pattern; auto-scrolls near viewport edges. **Set/column drag ordering is axis-aware** (Y when stacked, X when side-by-side).
- **Editable text** (card title/notes/checklist, set name) uses the `textEdit()` helper: shows inline text sized to itself so **only clicking the text** enters edit mode. Sets & cards **collapse by clicking their header** (not the name text).
- Match surrounding style: plain functions, `const`/`let`, no framework, small focused helpers.

## Testing note
In-harness preview (`mcp__Claude_Preview__preview_*`): **screenshots time out**, `requestAnimationFrame` **doesn't fire** (rAF-driven code like drag auto-scroll can't be seen run — verify the logic with a `setTimeout` rAF-shim), and programmatic `.focus()`/`.blur()` don't match `:focus` (drive commits with a dispatched `FocusEvent('blur')`). Verify behavior with `preview_eval` running real handlers; **reload between tests** (in-memory + CSS state leaks otherwise). User verifies on the live Vercel site.
