# Session Log

## 2026-07-04 (later) — Drag auto-scroll; set grab handle; text-only set rename

- **Auto-scroll while dragging**: near a viewport edge during a card or column drag, the window scrolls vertically (up + down) and the board scrolls horizontally (left + right, side-by-side columns), so you can drop into off-screen spots. Shared `beginAutoScroll/moveAutoScroll/endAutoScroll` (rAF loop; edge=72px, max 22px/frame; `onScroll` re-places the drop marker as content moves). Wired into card drag (`startLift`/`onDragMove`/`onDragEnd`) and column drag (`startColumnLift`/`onColumnMove`/`onColumnUp`; factored `placeColumnPlaceholder`). NOTE: rAF doesn't fire in the headless preview, so verified the scroll math via a `setTimeout` rAF-shim (scrolled down then back up) — real browsers run it.
- **Set grab handle**: replaced the colored header dot with a 6-dot **grip** icon (`GRIP_SVG`), tinted with the set's colour, `cursor: grab`. The whole header is still draggable (grip is just the affordance).
- **Text-only set rename**: the set-name header now uses the `textEdit` helper (like card title/notes/checklist) — only clicking the **name text** enters edit; clicking empty header space doesn't. `onDisplayClick: () => !justColumnDragged` so the click that ends a drag doesn't open edit. Removed the now-dead `startCategoryRename`; `addCategory` opens the new set's name via `.column-name-text` click + selects "New Set".
- Verified: grip present/tinted + drags to reorder; name edits only on text; empty-header click doesn't edit; new set opens selected; auto-scroll math both directions; no console errors.

---

## 2026-07-04 (later) — Collapsible task sets

- Each task set (column) now has a **collapse caret** (`.col-collapse`, ▾ in the header, rotates when collapsed). Clicking it hides that set's card-list / add-row / show-completed button (and skips rendering its cards); the header stays.
- Per-set + **persisted** across reloads via `collapsedSets` (localStorage array of column keys) + `saveCollapsed()`. `render()` adds `.collapsed` and skips the body when collapsed.
- Caret is excluded from the column drag (`onColumnPointerDown` closest check) and stops propagation so it doesn't rename/drag.
- CSS: `.column.collapsed` hides body + drops the header border; in **column mode** a collapsed set shrinks to a slim header (`flex:0 0 auto; width:max-content; min-width:0; max-width:240px`) — needed `min-width:0` to beat the base `.column min-width:280`. In **stacked** mode it's a thin full-width header row.
- Verified: collapse/expand per set, persists across reload, caret doesn't trigger rename/drag, slim in column mode (191px) vs expanded (933px); no console errors.

---

## 2026-07-04 (later) — Beach theme 🏖️

- Added a **"Beach"** theme (15th; in the cycle + labelled "Beach 🏖️"). More than a palette — it's a little scene, all CSS scoped to `html[data-theme="beach"]`:
  - Beachy palette (sky/sea blues, sandy surface, deep-teal text, sunny-orange accent).
  - `body` background = sky→sand `linear-gradient` + a `radial-gradient` **sun**; `background-attachment: fixed`.
  - **Frosted header** (`rgba` + `backdrop-filter: blur`) so the sky peeks through.
  - **Animated rolling surf** along the bottom (`body::after`, inline SVG data-URI wave, `@keyframes beach-surf` shifting `background-position-x`; disabled under `prefers-reduced-motion`).
  - A **beach umbrella ⛱️** planted bottom-left (`body::before`).
  - Decorations are `z-index:-1` + `pointer-events:none` (show through the transparent gutters, never block clicks/drag) and vanish when you switch themes.
- Verified: palette resolves w/ good contrast; surf SVG decodes 1200×120 + animates; umbrella + sun + frosted header present; switching away removes the scene; no console errors.

---

## 2026-07-04 — "New Set" wording; optional tabs; dashed add-box; CSS var bugfix

- **"New Task Set" → "New Set"** everywhere (default column, addCategory, the add tile label). **Add field**: "+ Add a task…" → **"+ Add something"**.
- **Tabs are now optional/hidden by default**: `renderTabs` shows tab chips only when `tabs.length > 1`; a project with just the implicit base tab shows only "+ Tab". Base tab relabeled **"Main"** (`defaultTab()`), shown as a chip (switch/rename, no ×) once user tabs exist. Every **user tab is deletable even as the only one** (× on any `key !== DEFAULT_TAB_KEY`); `deleteTab` refuses only the base tab.
- **Empty set cleanup**: removed the "No tasks" hint and the `.column` `min-height:160px` (no more large empty area — empty sets are compact). The **add field is now a dashed, card-shaped box** (radius 10px) that reads as a placeholder for the first task.
- **Bugfix (latent, from the theme commit's global find-replace)**: `:root` had `--hover-border: var(--hover-border)` and `--accent-soft: var(--accent-soft)` — **circular self-references**, so both resolved empty. That had silently broken the add-input dashed border, the card focus tint, and ALL drag-placeholder tints (card/column/tab) since 2026-06-30. Restored to `#cbd5e6` / `#eef4ff`. (Same class of bug as the earlier `--hover` fix; these two were missed.)
- Verified (preview): fresh project has no chips + "+ Tab"; add tab → [Main][New Tab] with × only on New Tab; delete → back to no chips; "New Set" + "+ Add something"; empty set compact w/ dashed add box; add task + add set work; vars resolve; no console errors.

---

## 2026-07-03 (later) — Default stacked; per-set completed toggle; click-text-to-edit

- **Default view is now stacked**: `stackedView = (localStorage.getItem("stackedView") ?? "1") === "1"` (respects an existing pref, defaults stacked).
- **Per-task-set "Show completed"**: removed the global toolbar toggle. Each task set (column) shows a low-profile `.show-completed` button ("Show/Hide completed (N)") only when it has ≥1 completed task. Per-column reveal tracked in an in-memory `shownCompletedCols` Set (resets on reload). `isVisibleTask()` now checks `shownCompletedCols.has(task.status)`. Empty-but-has-completed columns skip the "No tasks" hint.
- **Click-the-text-to-edit** (`textEdit()` helper): card **title**, **description**, and **checklist steps** now render as inline text sized to the text; only a click on the actual text enters edit mode (swaps in an input/textarea) — clicking the empty area around it does nothing and shows no edit cursor. Collapsed-card title click still expands (handler returns false → click bubbles). New-task auto-edit now triggers via `.card-title-text` click. `setCardExpanded` simplified (no more readonly reset — was `.card-title` which no longer exists). Enter/Escape in an edit field stop-propagate so they don't also hit board shortcuts. CSS: new `.tedit*` + `.card-title-text/-input`, `.card-notes-text/-input`, `.checklist-text-display/-input`.
- Verified (preview, column + mobile): collapsed title→expand, expanded title-text→edit, empty-area click→no edit, notes/checklist text→edit, empty-notes placeholder clickable, new-task opens in edit, card drag intact, per-set toggle reveals/hides, stacked default; no console errors.

---

## 2026-07-03 — Terminology + layout overhaul; carry-over → show-completed

### Terminology (user-facing strings only; DB/vars unchanged)
- **"Category" → "Task Set"**, **"board" → "Project"**, app/default title **"Daily Task Board" → "New Project"**. Default labels: single category "To Do" → **"New Task Set"**; default/new tab "To-Do"/"New tab" → **"New Tab"**. Updated all buttons, confirm modals, titles, aria-labels, prompts, alerts in `index.html` + `app.js`. `currentBoardName()` default is now "New Project" (and `render()`'s document.title check matches).

### Button placement
- **"+ Tab"** now renders at the **end of the tab row** (convention), not the toolbar. `renderTabs()` appends it; tab-drag placeholder inserts before it.
- **"+ Task Set"** is now a **dashed tile at the end of the board**: slim (44px) on the right in column mode so it doesn't shift columns, full-width with label below the columns in stack mode. Rendered in `render()`.
- **Board converted from CSS grid → flex** so the add tile can be slim (grid forced every item to a 280px track). `.column { flex: 1 1 280px }`; stacked = `flex-direction:column`; mobile column basis 150px. Column-drag `onColumnMove` inserts the placeholder before `.add-taskset`. Toolbar-right no longer holds the add buttons.

### Carry-over removed → show-completed toggle
- Deleted `carryOver()`/`renderCarryOver()`/the carry button + listener. **Checked-off tasks are now hidden by default**; a **"Show checked off (N)" / "Hide checked off (N)"** toggle sits on the **right of the search row** (`#toggle-completed`, in `.toolbar-right`), shown only when there are completed items (or they're showing). `showCompleted` persisted in localStorage; `isVisibleTask()` gates render + keyboard nav (NOT `group()`, so positions/counts stay whole).

### Verified (preview, desktop + mobile, both views)
Renames render; +Tab last in row; slim tile right (col) / full-width (stack); check-circle hides a task; toggle shows/hides + count; column drag works with flex board + tile stays last; add-tile and add-tab create; no horizontal overflow; no console errors.

---

## 2026-07-02 — Data-loss fix: tab-key divergence (tasks "disappearing")

### Root cause (confirmed)
- The first/default tab's key was generated with `makeId()` (random) **every time** a board loaded without a persisted `boards.tabs` (i.e. any board where the owner never edited tabs/columns — the common case). So each **reload / device / shared user** produced a *different* key. Creating or editing a task stamps it with that session's key, and `inActiveTab()` **hid** any task whose `tab` didn't match the current key. Result: tasks weren't deleted — they were **hidden**, and diverging keys progressively hid everything on shared boards and across reloads. (Good news: the data was recoverable, since it was a display filter, not a delete.)

### Fixes (app.js)
- **A. Deterministic key**: `DEFAULT_TAB_KEY = "default"`; `defaultTab()` gives the first/default tab this fixed key everywhere it's generated (`tabsFromColumns`, `loadTabsForBoard` fallback, `loadLocalTabs` migration, `syncActiveCategories`, `createBoard`). `makeTab` now takes an optional key; addTab still uses a random unique key for 2nd+ tabs (those get shared via `boards.tabs`, owner-persisted). Boards that already persisted a random first-tab key keep it (authoritative) — deterministic key only affects freshly-generated defaults.
- **B. Never-hide net**: `taskBelongsToTab(t)` returns the task's tab if it still exists, else the **first tab** — so a task with a null/unknown key surfaces in the first tab instead of vanishing. `inActiveTab` and `deleteTab` now use it.
- **C. Heal + recover**: `adoptOrphanTasks()` re-homes null/unknown-tab tasks onto the first tab **and persists** the repair (cloud too), so already-hidden tasks reappear and the fix sticks for all members/devices. Converges everyone to one key with no realtime storm (healed rows already match → no re-write).
- **D. Guards**: `createBoard`/`ensurePersonalBoard` now check the `board_members` insert and roll back the orphan board on failure (a failed membership row made a board invisible via RLS — a cause of "made a board, can't find it"). `persistTabs` refuses to write an empty/degenerate tab set.
- **F. Backups**: `pullRemote` snapshots the last non-empty task set to `taskManager.backups.v1` before replacing (so an unexpectedly-empty remote can't erase a board), warns in console when it happens, and exposes `window.restoreTasksBackup()` to re-add missing tasks + re-sync.

### Verified (preview, mocked)
Tasks stamped random/unknown keys + null all heal to `default` and render (were hidden before); multi-tab: unknown-key task shows in first tab while valid 2nd-tab task stays put; backup restore re-adds a wiped set (3→0→3); fresh boot key stable across reloads; no console errors.

### Known limitation (noted, not fixed here)
- Non-owners can't persist **tab/column structure** changes on a shared board (RLS: only owner updates `boards.tabs`) — such edits stay local and won't survive their reload. Tasks are unaffected (members can write tasks; healing covers them). Owner-only structure matches the existing tag-definition behavior. Could add local-overlay or owner-only affordance later.

---

## 2026-06-30 — Board switcher on mobile

### Fix: board header dropdown unusable on touch
- Two root causes: (1) the ▾ switch was a tiny 25×24 target and tapping the board *name* opened an inline rename (awkward on touch); (2) the switcher menu's action buttons (`.board-menu-action` rename/delete/leave) are `opacity:0` until `:hover`, so on touch they were invisible/untappable.
- **Fix**: on phones (`window.innerWidth<=600`) or for non-owners, tapping the board **name** now opens the switcher (big target); desktop owner keeps inline rename. Added a **rename pencil** to the current owned board's menu row (reuses `startRename` on the header name button) so mobile users can still rename. Enlarged `.board-switch` on mobile. Revealed hover-only action buttons (`.board-menu-action`, `.col-delete`, `.tab-delete`, card `.delete-btn`, `.checklist-del`) via `@media (max-width:760px),(hover:none)` so category/tab/task deletes are tappable on touch too.
- Verified (mocked signed-in at 375px): name-tap opens menu, rename pencil + delete visible and working, board switch works; desktop unchanged (name→inline rename, ▾→menu, actions hover-revealed). No console errors.

---

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
