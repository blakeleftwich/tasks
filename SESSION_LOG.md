# Session Log

## 2026-06-30 — Mobile layout pass

### Mobile usability (touch drag already shipped earlier)
- **Chrome height cut ~380px → 272px** above the board on a 375px screen. Header: compact date (`formatHeaderDate()` shows "Today" / "Tue, Jun 30" when `innerWidth<=600`, full long date otherwise; a `resize` listener swaps on rotate), smaller title/board-name/date fonts, tighter padding, truncated signed-in email. Toolbar: now two tidy rows ([search | Stack] then [+Tab +Category]) via `toolbar-left/right { flex:1 1 100% }` + search `flex:1` instead of `width:100%`.
- **Check circle bumped 15px → 20px** on mobile (tap target); card title 0.78→0.82rem.
- Verified at 375px: no horizontal overflow, tap-to-expand + check-tap work, expanded card fits, tag menu stays on-screen, board scrolls horizontally, delete modal has edge gaps. Desktop long-date unchanged. No console errors.
- Note: check `#475569`→`var(--text)` etc. were part of the earlier theme commit; this pass is layout-only.

---

## 2026-06-30 — Colour themes + confirmations

### Migration confirmed
- User ran `supabase-tabs.sql` on the correct project (`jyccdxemtaeegyuotyfz`); re-probed via REST → `boards.tabs` and `tasks.tab` both 200. Tabs now sync cross-device.

### Carry-over (no change needed)
- Confirmed (with a reproduction in preview) that checked-off (`completed`) tasks are already excluded from carry-over — both the button count and the action filter `!t.completed`. This has been true since the first version; user agreed it works as intended.

### Colour themes (new)
- **Small round palette button** (`#theme-btn`) at the left of the title block (left of the board name/dropdown). Click cycles 6 themes: Default, Sand, Mint, Rose, Lavender, Slate.
- Themes are CSS-variable overrides on `html[data-theme="…"]` (neutral palette only — `--bg/--surface/--text/--muted/--border/--hover`; semantic accents unchanged). Added a `--hover` var and routed the pervasive `#eef2fb` hover colour through it so themes stay cohesive across header/columns/cards/tabs.
- **Remembered per board, locally** (`localStorage boardThemes` = `{ boardId|"__local__": themeKey }`) — a personal view preference like the active tab / stacked view, applied on boot and on every board switch (`applyBoardTheme()` in `setUser`/`switchBoard`). Not synced across devices/members (would need a `boards.theme` column — deferred).
- **Theme set expanded to 14**: light (Default, Sand, Mint, Rose, Lavender, Slate), bright (Sky, Sunny, Bubblegum), dark (Midnight, Carbon), neon (Neon/cyan, Synthwave/pink, Matrix/green — dark bg + recoloured `--todo` accent). To make dark/neon legible, added vars `--hover-border`, `--accent-soft` (focus/drag tints), `--field` (notes textarea) and routed the old hardcoded `#cbd5e6/#cdd6e6/#eef4ff/#f3f7ff/#f0f6ff/#f8fafc/#475569` through them. **Bug fix**: the prior commit's `replace_all #eef2fb→var(--hover)` had clobbered `--hover`'s own definition into `var(--hover)` (circular → hovers transparent on the default theme); restored to `#eef2fb`. Remaining hardcoded light bits (overdue badge, delete-hover red, carry button amber) are intentional alerts, left as-is.

### Security Q (answered, no change)
- Reviewed RLS: strangers with just the app URL + their own login can't see/edit a user's data (they get their own board). Board access is **capability-based** via the share link (board id) — anyone signed-in who has a board's id can join and fully edit its tasks (no read-only mode; owner can't kick members from the UI). Board ids are random UUIDs. Offered read-only-share / remove-member as future work.

---

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

### Follow-up refinements (same day)
- **+ Tab + + Category** moved together to the toolbar's right (`.toolbar-right`), both as ghost buttons, vertically aligned with the Stack/Columns toggle. Removed the stray vertical scrollbar arrows (the tab bar's `overflow-x:auto` was implicitly making `overflow-y` auto → set `overflow-y:hidden`).
- **Tab bar now aligns with the board**: full-width in columns mode, centred (720px, via `body.stacked-view`) in stack mode, so the leftmost tab sits over the first category card's left corner in both modes. Active-tab indicator changed from a clipped `::after` to a `border-bottom` on `.tab-name`.
- **New default**: new boards (`createBoard`) and new tabs (`addTab`) now start with a **single** category (`defaultColumns()`), not three. Migration still keeps the canonical 3 columns for browsers that already had tasks (`hasLegacyTasks()`), so no existing tasks are orphaned.

### Also
- `.claude/launch.json` set to `autoPort` (5173 was busy) so the static preview server picks a free port.

### Follow-up 2 — wider stacked column + mobile/touch drag
- **Stacked view column** widened 720 → **900px** via a new `--stack-width` CSS var (used by both `.board.stacked` and the centred `.tab-bar`).
- **Touch/mobile drag now works** (was mouse-only). Custom pointer drag is now mouse **and** touch: mouse keeps the move-threshold behaviour; touch uses a **long-press (300ms, ~12px slop)** to pick up a card / column header / tab, and moving before the press completes scrolls instead. Applied to all four drag handlers (`onCardPointerDown`/`onColumnPointerDown`/`onTabPointerDown` long-press; checklist handle drags immediately since it's a dedicated handle). Added `pointercancel` cleanup + `removeXListeners()` helpers, `touch-action:none` on the body during an active drag, and `navigator.vibrate` feedback on pickup. Taps still switch tabs / expand cards / rename. Verified all paths with simulated `pointerType:'touch'` events (long-press drag, scroll-cancel, tap-to-expand, tab tap-switch).

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
