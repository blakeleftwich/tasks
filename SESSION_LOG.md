# Session Log

## 2026-06-29 — Per-board tabs

### Accomplished
- **Tabs**: a left-aligned bar over the board (To-Do / Roadmap / Invites style). Each tab is its own mini-board — **its own columns AND its own tasks**. Click a tab to switch; click the active tab again to rename; × deletes (confirm modal, removes that tab's tasks); drag to reorder (mouse, reuses the column-drag clone+placeholder).
- **+ Category** moved to the right of the new tab-bar row; **+ Tab** added on the left. New tabs start with three default columns (To Do / In Progress / Done) with fresh keys.
- **Data model**: per-board `tabs = [{key,label,columns:[…]}]`; `categories` is now a live reference to the active tab's `columns` so all column/tag code is unchanged. Tasks gained a `tab` field. `group()` filters by active tab (single chokepoint). Legacy tasks (no `tab`) are pinned to the first tab via `adoptOrphanTasks()` so reordering tabs can't reassign them.
- **Persistence**: signed-out → `localStorage taskManager.tabs.v1` `{tabs, activeTabKey}` (migrates the old `taskManager.categories.v1` into one "To-Do" tab). Signed-in → probe-gated `boards.tabs` (jsonb) + `tasks.tab` (text); falls back to the legacy `boards.columns` write when `tabsSyncable` is false. Active tab is a local view pref (not synced).

### Migration (NOT yet applied)
- **`supabase-tabs.sql`** adds `boards.tabs jsonb` + `tasks.tab text`. **User must run it in the Supabase SQL Editor.** Code is probe-gated (`tabsSyncable`, `taskTabSyncable`), so deploying before the SQL is safe — extra tabs just won't sync cross-device until it's applied.

### Verified (in-harness preview, signed-out)
- Migration of legacy data into one tab; add/rename/delete tab; per-tab task isolation; can't delete last tab; +Category affects only the active tab; drag-reorder persists; legacy tasks stay with their tab after reorder; full reload restores tabs + active tab + per-tab tasks. No console errors.

### Also
- `.claude/launch.json` set to `autoPort` (5173 was busy) so the static preview server picks a free port.

---

## 2026-06-29

### Session goal
- Build the "Daily Task Board" from `Plan.txt` and iterate it into a flexible, synced task/project tracker. Ship each change live to Vercel.

### Accomplished (all live + verified)
- **Static site** (vanilla HTML/CSS/JS, no build step) deployed to **Vercel** → https://task-manager-phi-nine-59.vercel.app
- **GitHub repo** `git@github.com:blakeleftwich/tasks.git` connected to Vercel → push to `main` auto-deploys.
- **Supabase backend** (project `jyccdxemtaeegyuotyfz`): magic-link auth, Row-Level Security, realtime sync, shared **boards** (join-by-link).
- **Cards**: click-to-expand-in-place (animated), click name again (when open) to rename, description (Enter finishes), checklist (multi-line steps, drag-reorder), due date (overdue highlight), color (left edge), **tags** (see below). "More ▾" collapses the tag/due/color options.
- **Check circle = complete in place** (dim + strikethrough, no column move).
- **Categories** (formerly fixed To Do/In Progress/Done): editable, unlimited, per-board. Rename via header click, add via toolbar "+ Category", delete via header × (moves tasks to first category), reorder by dragging the header (clone+placeholder like cards). Board scrolls horizontally.
- **Tags**: per-category pool, per-task selection, "None" option. Create/rename/delete + color-coding (pick/cycle color; pill text auto-darkened to a readable hue-matched shade). Replaced the old priority dropdown.
- **Search**, **keyboard shortcuts** (N/Enter/arrows/C/Del/`/`/Esc, legend pinned in footer), **stacked⇄columns view toggle**, **carry-over** unfinished tasks into today, **delete-confirm modal**.
- **/lab.html** — standalone UX sandbox demoing card ideas (not wired to data).

### Code changes (files)
- `index.html` / `styles.css` / `app.js` — the whole app. `app.js` is the single ~1500-line module (data model, render, drag, sync, categories, tags, keyboard).
- `config.js` — Supabase URL + **publishable** key (public by design; RLS enforces security). Committed intentionally.
- `supabase-*.sql` — one migration per feature (see "Context").
- `lab.html` — UX demo. `README.md` — usage/setup. `Plan.txt` — original brief.
- Removed `supabase-team.sql` (Option-1 single-shared-list; superseded by boards).

### In progress / next step
- None pending — **all Supabase migrations applied** (verified via REST probe). Tag selection now syncs across devices/boards.

### Open questions / decisions deferred
- **Priority fully removed** (replaced by tags); old `priority` DB column is vestigial/unused. User OK'd; could restore if wanted.
- **Tag definitions are owner-only** on shared boards (matches board rename RLS); members can't edit. Not opened up.
- **Board-list realtime**: board renames/deletes only show to other members on their next load (realtime covers `tasks` only, not `boards`). Deferred.
- **Touch**: drag (cards + categories) and reorder are mouse-only. Long-press-to-drag for touch was offered, not built.
- **Category dot colors are positional** (by index) — shift when reordered. Offered to make per-category-stable; not done.

### Context for next time (gotchas + conventions)
- **Auto-ship**: commit + push every completed change without asking; user tests on the live site, not the in-harness preview. (Standing preference — see memory.) Still pause before destructive/risky DB actions.
- **Migrations are probe-gated**: each new DB column has a `*Syncable` flag set by a probe query on sign-in; if the column is missing the field saves locally only and task sync isn't broken. So deploying before the user runs the SQL is safe.
- **Migration status (verified via REST probe this session)**: all applied — boards ✅, checklist ✅, categories (`tasks.completed`, `boards.columns`) ✅, tags (`tasks.tag`) ✅.
- **Headless preview quirks** (why I verify with `preview_eval`, not screenshots): viewport reports `innerWidth: 0` → renders in mobile (≤760px) layout; **screenshots time out**; CSS `:focus` doesn't match programmatic `.focus()` (OS window unfocused). **Must reload between eval tests** or in-memory state (tasks/expanded/categories) leaks and gives false results.
- **Verifying Supabase schema without auth**: curl the REST API with the publishable key (`GET /rest/v1/<table>?select=<col>&limit=1` → 200 `[]` if exists, 400 if missing).
- **Data model**: task `status`=category key, `tag`=tag key, `label`=color key, `completed`=bool. Categories = `[{key,label,tags:[{key,label,color}]}]` stored in `boards.columns` (signed-in) or `localStorage taskManager.categories.v1` (signed-out). Tasks in `localStorage taskManager.v2`.
- **Drag**: custom pointer-based, mouse-only; cards and categories both use a floating clone + dashed placeholder. A focused text field keeps text-selection (drag doesn't hijack it); an unfocused field drags the card.
