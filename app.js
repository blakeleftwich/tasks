/* Daily Task Board
 * - Flat task model persisted to localStorage (offline / no login).
 * - Optional Supabase sync across devices when configured + signed in.
 */

const STORAGE_KEY = "taskManager.v2";
const LEGACY_KEY = "taskManager.v1";

const DEFAULT_CATEGORIES = [
  { key: "todo", label: "To Do" },
  { key: "inProgress", label: "In Progress" },
  { key: "done", label: "Done" },
];
// A board is split into tabs; each tab owns its own columns (categories) AND its
// own tasks. Tabs are editable/unlimited — a board can stay a single simple
// To Do / In Progress / Done list or grow into several parallel trackers.
// `categories` is always a live reference to the *active* tab's columns, so the
// column/tag code below can stay tab-agnostic.
const TABS_KEY = "taskManager.tabs.v1";
const LEGACY_CATEGORIES_KEY = "taskManager.categories.v1";

let tabs = [];
let activeTabKey = null;
let categories = []; // === activeTab().columns (reassigned on every tab switch)
const categoryKeys = () => categories.map((c) => c.key);

// The first/default tab of every board uses a FIXED key (not a random one), so
// all clients, devices and reloads agree on it. This is critical: a task stores
// its owning tab's key, and if that key were random-per-load, tasks would appear
// to vanish whenever the key changed (across a reload, device, or shared user).
const DEFAULT_TAB_KEY = "default";

function makeTab(label, columns, key) {
  return {
    key: key || makeId(),
    label: label || "New tab",
    columns: Array.isArray(columns) && columns.length ? columns : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  };
}
// The default tab (first tab of a board) — always the same stable key.
function defaultTab(columns) {
  return makeTab("Main", columns, DEFAULT_TAB_KEY);
}

// New boards / new tabs start with a single blank category (user preference).
function defaultColumns() {
  return [{ key: makeId(), label: "New Set" }];
}

// Did this browser already have tasks before tabs existed? If so, the migrated
// first tab must keep the canonical To Do / In Progress / Done columns so those
// tasks (status todo/inProgress/done) still have a home.
function hasLegacyTasks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return !!(parsed && Array.isArray(parsed.tasks) && parsed.tasks.length);
  } catch (e) {
    return false;
  }
}

function activeTab() {
  return tabs.find((t) => t.key === activeTabKey) || tabs[0] || null;
}
// The first tab also owns legacy tasks that predate tabs (no `tab` field).
function activeTabIsFirst() {
  return tabs.length > 0 && activeTab() === tabs[0];
}
// A task's home tab: its own tab if that tab still exists, otherwise the FIRST
// tab. So a task is never hidden just because its tab key is unknown — null
// legacy tasks, or a key stamped by a divergent client/reload, surface in the
// first tab instead of vanishing. This is the core "never lose a task" net.
function taskBelongsToTab(t) {
  if (t.tab && tabs.some((tab) => tab.key === t.tab)) return t.tab;
  return tabs[0] ? tabs[0].key : null;
}
function inActiveTab(t) {
  return taskBelongsToTab(t) === activeTabKey;
}

// Point `categories` at the active tab's columns; repair any empty/invalid state.
function syncActiveCategories() {
  if (!tabs.length) tabs = [defaultTab()];
  if (!activeTab()) activeTabKey = tabs[0].key;
  const t = activeTab();
  if (!Array.isArray(t.columns) || !t.columns.length) t.columns = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  categories = t.columns;
}

// Wrap a board's existing flat `columns` array into a single default tab.
function tabsFromColumns(columns) {
  return [defaultTab(Array.isArray(columns) && columns.length ? columns : null)];
}

function loadLocalTabs() {
  // New format: { tabs, activeTabKey }.
  try {
    const parsed = JSON.parse(localStorage.getItem(TABS_KEY));
    if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
      tabs = parsed.tabs;
      activeTabKey = parsed.activeTabKey || tabs[0].key;
      syncActiveCategories();
      return;
    }
  } catch (e) {
    /* ignore */
  }
  // Migrate the old single set of categories into one "To-Do" tab.
  let cols = null;
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_CATEGORIES_KEY));
    if (Array.isArray(old) && old.length) cols = old;
  } catch (e) {
    /* ignore */
  }
  // No saved categories: keep canonical columns only if legacy tasks need them,
  // otherwise start fresh with a single category.
  if (!cols) cols = hasLegacyTasks() ? DEFAULT_CATEGORIES.map((c) => ({ ...c })) : defaultColumns();
  tabs = [defaultTab(cols)];
  activeTabKey = tabs[0].key;
  syncActiveCategories();
  saveLocalTabs(); // persist now so the generated keys stay stable across reloads/re-loads
}

function saveLocalTabs() {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabKey }));
  } catch (e) {
    /* ignore */
  }
}

loadLocalTabs(); // populate tabs / activeTabKey / categories (migrating if needed)

const CATEGORY_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

// A dark, readable version of a hex colour: same hue, scaled toward black until
// its luminance is low enough for AA contrast on the light tinted pill — works
// for every hue (greens/yellows need more darkening than blues).
function darkenColor(hex) {
  const r0 = parseInt(hex.slice(1, 3), 16);
  const g0 = parseInt(hex.slice(3, 5), 16);
  const b0 = parseInt(hex.slice(5, 7), 16);
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (f) => 0.2126 * lin(r0 * f) + 0.7152 * lin(g0 * f) + 0.0722 * lin(b0 * f);
  let f = 1;
  while (f > 0.15 && lum(f) > 0.14) f -= 0.05;
  return `rgb(${Math.round(r0 * f)}, ${Math.round(g0 * f)}, ${Math.round(b0 * f)})`;
}

const LABELS = [
  { key: "blue", color: "#3b82f6" },
  { key: "green", color: "#10b981" },
  { key: "amber", color: "#f59e0b" },
  { key: "red", color: "#ef4444" },
  { key: "purple", color: "#8b5cf6" },
];

// Fields that live on a task (and map 1:1 to DB columns, snake_case aside).
const TASK_FIELDS = ["id", "day", "status", "position", "title", "notes", "due", "priority", "label", "updated_at"];

/* ---------- State ---------- */
let tasks = []; // flat array of task objects
let expandedCardId = null; // the card expanded in place (view state, not persisted)
let propsOpenForId = null; // card whose priority/due/colour options are revealed
let selectedCardId = null; // keyboard-selected card (for shortcuts)
let searchQuery = ""; // lowercased search filter
let shownCompletedCols = new Set(); // task-set (column) keys currently revealing completed tasks
// Collapsed task-set (column) keys — a local view preference, remembered across reloads.
let collapsedSets = (() => {
  try {
    const a = JSON.parse(localStorage.getItem("collapsedSets"));
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) {
    return new Set();
  }
})();
function saveCollapsed() {
  try {
    localStorage.setItem("collapsedSets", JSON.stringify([...collapsedSets]));
  } catch (e) {
    /* ignore */
  }
}

let supa = null; // Supabase client (when configured)
let user = null; // signed-in user (when authed)
let boards = []; // boards the signed-in user belongs to
let currentBoardId = null; // active board (null = single-board / legacy mode)
let checklistSyncable = false; // whether the tasks.checklist column exists yet
let completedSyncable = false; // whether the tasks.completed column exists yet
let columnsSyncable = false; // whether the boards.columns column exists yet
let tagSyncable = false; // whether the tasks.tag column exists yet
let tabsSyncable = false; // whether the boards.tabs column exists yet
let taskTabSyncable = false; // whether the tasks.tab column exists yet
let assigneeSyncable = false; // whether the tasks.assignee column exists yet
let attachmentsSyncable = false; // whether the tasks.attachments column exists yet
let blocksSyncable = false; // whether the tasks.blocks column exists yet
let suppressRealtimeUntil = 0; // ignore our own echoed writes briefly
let pendingReload = false; // a remote change arrived while editing

/* =====================================================================
 * Date helpers
 * ===================================================================== */
function todayKey() {
  return toKey(new Date());
}
function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// Short date for the due-date badge (the only date still shown).
function formatShort(key) {
  return keyToDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* =====================================================================
 * Local persistence + migration
 * ===================================================================== */
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tasks)) return parsed.tasks.map(normalizeTask); // builds blocks for pre-block tasks
    }
  } catch (e) {
    console.warn("Could not read saved data; starting fresh.", e);
  }
  return migrateLegacy();
}

function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const old = JSON.parse(raw);
    const out = [];
    for (const [day, cols] of Object.entries(old.days || {})) {
      for (const status of ["todo", "inProgress", "done"]) {
        (cols[status] || []).forEach((t, i) => {
          out.push(normalizeTask({ ...t, day, status, position: i }));
        });
      }
    }
    return out;
  } catch (e) {
    console.warn("Legacy migration skipped.", e);
    return [];
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks }));
  } catch (e) {
    console.error("Could not save locally.", e);
  }
}

// Safety snapshot: keep the last non-empty task set per board in a separate key,
// so a transient sync glitch (or an accidental wipe) can never make data
// unrecoverable. Restore with window.restoreTasksBackup().
const BACKUPS_KEY = "taskManager.backups.v1";
function backupTasks(boardId, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  try {
    const all = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "{}");
    all[boardId || "__local__"] = { at: nowIso(), tasks: arr };
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(all));
  } catch (e) {
    /* ignore quota */
  }
}

/* =====================================================================
 * Task helpers
 * ===================================================================== */
function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "t_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTask(t) {
  const blocks = normalizeBlocks(t);
  return {
    id: t.id || makeId(),
    day: t.day || todayKey(),
    status: t.status || "todo",
    tab: t.tab || null,
    position: typeof t.position === "number" ? t.position : 0,
    title: t.title || "",
    // notes/checklist are legacy mirrors of the blocks (kept in sync for
    // search and for clients/DBs that predate the blocks column).
    notes: blockNotes(blocks),
    due: t.due || null,
    priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : null,
    label: t.label || null,
    tag: t.tag || null,
    assignee: (typeof t.assignee === "string" && t.assignee.trim()) || null,
    checklist: blockItems(blocks),
    blocks,
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
    completed: !!t.completed,
    updated_at: t.updated_at || nowIso(),
  };
}

/* A card body is an ordered list of blocks: {id, type:"text", text} or
 * {id, type:"checklist", items:[{id,text,done}]}. Tasks that predate blocks
 * (or rows synced without the blocks column) rebuild them from the legacy
 * notes/checklist fields. Never-filled empty blocks are dropped on load. */
function normalizeBlocks(t) {
  let blocks = Array.isArray(t.blocks) ? t.blocks : [];
  blocks = blocks.filter(
    (b) =>
      b &&
      b.id &&
      ((b.type === "text" && typeof b.text === "string") || (b.type === "checklist" && Array.isArray(b.items)))
  );
  if (!blocks.length) {
    blocks = [];
    if (t.notes && String(t.notes).trim()) blocks.push({ id: makeId(), type: "text", text: String(t.notes) });
    if (Array.isArray(t.checklist) && t.checklist.length)
      blocks.push({ id: makeId(), type: "checklist", items: t.checklist });
  }
  return blocks.filter((b) => (b.type === "text" ? b.text.trim() : b.items.length));
}
function blockNotes(blocks) {
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
}
function blockItems(blocks) {
  return blocks.filter((b) => b.type === "checklist").flatMap((b) => b.items || []);
}

function getTask(id) {
  return tasks.find((t) => t.id === id) || null;
}

// Ordered tasks for a column (task set), scoped to the active tab. Not date-
// based: a set shows all its tasks regardless of the day they were created.
// (`day` still breaks position ties from before the merge; once a set is
// reordered, positions are unique and it no longer matters.)
function group(status) {
  return tasks
    .filter((t) => t.status === status && inActiveTab(t))
    .sort((a, b) => a.position - b.position || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function isOverdue(task) {
  return task.due && task.due < todayKey() && !task.completed;
}

/* =====================================================================
 * Mutations (write-through: local first, then remote if signed in)
 * ===================================================================== */
function persist(changed) {
  saveLocal();
  if (supa && user) {
    suppressRealtimeUntil = Date.now() + 1500;
    const rows = changed.map(rowFromTask);
    supa
      .from("tasks")
      .upsert(rows)
      .then(({ error }) => error && console.error("Sync upsert failed:", error.message));
  }
}

function remoteDelete(id) {
  if (supa && user) {
    suppressRealtimeUntil = Date.now() + 1500;
    supa
      .from("tasks")
      .delete()
      .eq("id", id)
      .then(({ error }) => error && console.error("Sync delete failed:", error.message));
  }
}

function reindex(status) {
  const g = group(status);
  g.forEach((t, i) => {
    t.position = i;
    t.updated_at = nowIso();
  });
  return g;
}

function addTask(status) {
  const task = normalizeTask({ day: todayKey(), status, tab: activeTabKey, position: group(status).length });
  tasks.push(task);
  expandedCardId = task.id; // open the new card so its title is editable
  selectedCardId = task.id;
  persist([task]);
  render();
  // A brand-new task opens ready to name — enter title edit mode immediately.
  const disp = document.querySelector(`[data-id="${task.id}"] .card-title-text`);
  if (disp) disp.click();
}

// Inline add: create a named task and keep the add field focused for the next one.
function quickAddTask(status, title) {
  const task = normalizeTask({ day: todayKey(), status, tab: activeTabKey, position: group(status).length, title });
  tasks.push(task);
  persist([task]);
  render();
  const input = document.querySelector(`.column[data-col="${status}"] .add-input`);
  if (input) input.focus();
}

function updateTask(id, fields) {
  const task = getTask(id);
  if (!task) return;
  Object.assign(task, fields, { updated_at: nowIso() });
  persist([task]);
}

function deleteTask(id) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const { status } = tasks[idx];
  tasks.splice(idx, 1);
  if (expandedCardId === id) expandedCardId = null;
  const changed = reindex(status);
  saveLocal();
  remoteDelete(id);
  if (changed.length) persist(changed);
  render();
}

async function requestDeleteTask(id) {
  const task = getTask(id);
  if (!task) return;
  const name = task.title.trim();
  const ok = await confirmModal({
    message: name ? `“${name}” will be permanently deleted.` : "This task will be permanently deleted.",
    confirmLabel: "Delete",
  });
  if (ok) deleteTask(id);
}

// Check circle: mark complete in place (dim + strikethrough); does not move the task.
function toggleCompleted(id) {
  const task = getTask(id);
  if (!task) return;
  updateTask(id, { completed: !task.completed });
  render();
}

// Move a task into a column, optionally before a specific card.
function moveTaskTo(id, toStatus, beforeId) {
  const task = getTask(id);
  if (!task) return;
  const fromStatus = task.status;
  task.status = toStatus;
  task.updated_at = nowIso();

  // Order: rebuild target column with the dragged card placed correctly.
  const target = group(toStatus).filter((t) => t.id !== id);
  let insertAt = target.length;
  if (beforeId != null) {
    const i = target.findIndex((t) => t.id === beforeId);
    if (i !== -1) insertAt = i;
  }
  target.splice(insertAt, 0, task);
  target.forEach((t, i) => {
    t.position = i;
    t.updated_at = nowIso();
  });

  const changed = new Map(target.map((t) => [t.id, t]));
  if (fromStatus !== toStatus) reindex(fromStatus).forEach((t) => changed.set(t.id, t));
  saveLocal();
  persist([...changed.values()]);
  render();
}

/* =====================================================================
 * Rendering
 * ===================================================================== */
const board = document.getElementById("board");
const cardTemplate = document.getElementById("card-template");

// A "grab" handle (6-dot grip) for the task-set header.
const GRIP_SVG = `<svg width="12" height="15" viewBox="0 0 12 15" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="7.5" r="1.4"/><circle cx="8.5" cy="7.5" r="1.4"/><circle cx="3.5" cy="12" r="1.4"/><circle cx="8.5" cy="12" r="1.4"/></svg>`;

/* ---------- Categories (columns) ---------- */
// All column/tag edits live inside a tab, so saving categories saves the tabs.
function persistCategories() {
  persistTabs();
}

function persistTabs() {
  // Never overwrite a board's tabs with an empty/degenerate set (would wipe
  // everyone's columns). If state looks broken, repair it before saving.
  if (!Array.isArray(tabs) || !tabs.length) {
    syncActiveCategories();
    if (!tabs.length) return;
  }
  if (supa && user && currentBoardId) {
    const b = boards.find((x) => x.id === currentBoardId);
    const activeCols = activeTab() ? activeTab().columns : categories;
    if (b) {
      b.tabs = tabs;
      b.columns = activeCols; // legacy mirror so old single-set readers still work
    }
    if (tabsSyncable) {
      supa
        .from("boards")
        .update({ tabs })
        .eq("id", currentBoardId)
        .then(({ error }) => error && console.error("Save tabs failed:", error.message));
    } else if (columnsSyncable) {
      // Pre-migration fallback: keep at least the active tab's columns synced.
      supa
        .from("boards")
        .update({ columns: activeCols })
        .eq("id", currentBoardId)
        .then(({ error }) => error && console.error("Save categories failed:", error.message));
    }
  } else {
    saveLocalTabs();
  }
}

function loadTabsForBoard() {
  const b = boards.find((x) => x.id === currentBoardId);
  if (b && Array.isArray(b.tabs) && b.tabs.length) {
    tabs = b.tabs;
  } else if (b && Array.isArray(b.columns) && b.columns.length) {
    tabs = tabsFromColumns(b.columns); // wrap an existing single-set board into one tab
  } else {
    tabs = [defaultTab()];
  }
  activeTabKey = tabs[0].key;
  syncActiveCategories();
}

function addCategory() {
  const cat = { key: makeId(), label: "New Set" };
  categories.push(cat);
  persistCategories();
  render();
  // Open the new set's name for editing, with the placeholder text selected.
  const disp = board.querySelector(`.column[data-col="${cat.key}"] .column-name-text`);
  if (disp) {
    disp.click();
    board.querySelector(`.column[data-col="${cat.key}"] .column-name-input`)?.select();
  }
}

async function deleteCategory(cat) {
  if (categories.length <= 1) return; // keep at least one
  const remaining = categories.filter((c) => c.key !== cat.key);
  const affected = tasks.filter((t) => t.status === cat.key && inActiveTab(t));
  const ok = await confirmModal({
    title: "Delete task set?",
    message: affected.length
      ? `Delete “${cat.label}”? Its ${affected.length} task${affected.length === 1 ? "" : "s"} will move to “${remaining[0].label}”.`
      : `Delete the empty task set “${cat.label}”?`,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  affected.forEach((t) => {
    t.status = remaining[0].key;
    t.updated_at = nowIso();
  });
  const t = activeTab();
  if (t) t.columns = remaining; // keep the tab and the live `categories` ref in step
  categories = remaining;
  persistCategories();
  if (affected.length) {
    saveLocal();
    persist(affected);
  }
  render();
}

/* ---------- Tags (per-category, selected per-task) ---------- */
const TAG_PENCIL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`;
const TAG_TRASH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

function categoryOf(task) {
  return categories.find((c) => c.key === task.status) || null;
}
function tagsOf(cat) {
  if (!cat) return [];
  if (!Array.isArray(cat.tags)) cat.tags = [];
  return cat.tags;
}

function renderTagSelector(node, task) {
  const trigger = node.querySelector(".tag-trigger");
  const menu = node.querySelector(".tag-menu");
  const selected = tagsOf(categoryOf(task)).find((t) => t.key === task.tag);
  trigger.textContent = (selected ? selected.label : "None") + "  ▾";
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    document.querySelectorAll(".tag-menu").forEach((m) => (m.hidden = true));
    if (!willOpen) {
      menu.hidden = true;
      return;
    }
    buildTagMenu(menu, task);
    const r = trigger.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + 4 + "px";
    menu.style.minWidth = r.width + "px";
    menu.hidden = false;
  });
}

function buildTagMenu(menu, task) {
  const cat = categoryOf(task);
  const tags = tagsOf(cat);
  menu.innerHTML = "";

  const none = document.createElement("button");
  none.className = "tag-menu-pick none" + (!task.tag ? " current" : "");
  none.textContent = "None";
  none.addEventListener("click", () => {
    menu.hidden = true;
    updateAndRender(task.id, { tag: null });
  });
  menu.appendChild(none);

  tags.forEach((tag, i) => {
    const color = tag.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    const row = document.createElement("div");
    row.className = "tag-menu-item";

    const dot = document.createElement("button");
    dot.className = "tag-color-dot";
    dot.style.background = color;
    dot.title = "Change colour";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleTagColor(tag, dot);
    });

    const pick = document.createElement("button");
    pick.className = "tag-menu-pick" + (task.tag === tag.key ? " current" : "");
    pick.textContent = tag.label;
    pick.addEventListener("click", () => {
      menu.hidden = true;
      updateAndRender(task.id, { tag: tag.key });
    });
    const ren = document.createElement("button");
    ren.className = "tag-menu-action";
    ren.title = "Rename tag";
    ren.innerHTML = TAG_PENCIL;
    ren.addEventListener("click", (e) => {
      e.stopPropagation();
      renameTag(pick, tag);
    });
    const del = document.createElement("button");
    del.className = "tag-menu-action delete";
    del.title = "Delete tag";
    del.innerHTML = TAG_TRASH;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTag(task, tag);
    });
    row.append(dot, pick, ren, del);
    menu.appendChild(row);
  });

  const divider = document.createElement("div");
  divider.className = "tag-menu-divider";
  menu.appendChild(divider);

  // New-tag row: pick a colour (click the dot to cycle), type a name, Enter.
  const newRow = document.createElement("div");
  newRow.className = "tag-menu-item";
  let pendingColor = CATEGORY_COLORS[tags.length % CATEGORY_COLORS.length];
  const newDot = document.createElement("button");
  newDot.className = "tag-color-dot";
  newDot.style.background = pendingColor;
  newDot.title = "Pick colour";
  newDot.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingColor = CATEGORY_COLORS[(CATEGORY_COLORS.indexOf(pendingColor) + 1) % CATEGORY_COLORS.length];
    newDot.style.background = pendingColor;
  });
  const add = document.createElement("input");
  add.className = "tag-menu-new";
  add.placeholder = "+ New tag…";
  add.addEventListener("click", (e) => e.stopPropagation());
  add.addEventListener("keydown", (e) => {
    const v = add.value.trim();
    if (e.key === "Enter" && v) createTag(task, v, pendingColor);
  });
  newRow.append(newDot, add);
  menu.appendChild(newRow);
}

/* ---------- Assignee (a free-text person name; picker lists names already
 * used on this project so assigning the same person twice is one click) ---- */
function knownAssignees() {
  const seen = new Map(); // lowercased → first-seen casing
  tasks.forEach((t) => {
    if (t.assignee && !seen.has(t.assignee.toLowerCase())) seen.set(t.assignee.toLowerCase(), t.assignee);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function renderAssigneeSelector(node, task) {
  const trigger = node.querySelector(".assignee-trigger");
  const menu = node.querySelector(".assignee-menu");
  trigger.textContent = (task.assignee || "Nobody") + "  ▾";
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    document.querySelectorAll(".tag-menu").forEach((m) => (m.hidden = true));
    if (!willOpen) {
      menu.hidden = true;
      return;
    }
    buildAssigneeMenu(menu, task);
    const r = trigger.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + 4 + "px";
    menu.style.minWidth = r.width + "px";
    menu.hidden = false;
  });
}

function buildAssigneeMenu(menu, task) {
  menu.innerHTML = "";

  const none = document.createElement("button");
  none.className = "tag-menu-pick none" + (!task.assignee ? " current" : "");
  none.textContent = "Nobody";
  none.addEventListener("click", () => {
    menu.hidden = true;
    updateAndRender(task.id, { assignee: null });
  });
  menu.appendChild(none);

  knownAssignees().forEach((name) => {
    const pick = document.createElement("button");
    pick.className = "tag-menu-pick" + (task.assignee === name ? " current" : "");
    pick.textContent = "👤 " + name;
    pick.addEventListener("click", () => {
      menu.hidden = true;
      updateAndRender(task.id, { assignee: name });
    });
    menu.appendChild(pick);
  });

  const divider = document.createElement("div");
  divider.className = "tag-menu-divider";
  menu.appendChild(divider);

  const add = document.createElement("input");
  add.className = "tag-menu-new";
  add.placeholder = "+ New person…";
  add.addEventListener("click", (e) => e.stopPropagation());
  add.addEventListener("keydown", (e) => {
    const v = add.value.trim();
    if (e.key === "Enter" && v) {
      menu.hidden = true;
      updateAndRender(task.id, { assignee: v });
    }
  });
  menu.appendChild(add);
}

function createTag(task, label, color) {
  const cat = categoryOf(task);
  if (!cat) return;
  const tags = tagsOf(cat);
  const tag = { key: makeId(), label, color: color || CATEGORY_COLORS[tags.length % CATEGORY_COLORS.length] };
  tags.push(tag);
  persistCategories();
  updateAndRender(task.id, { tag: tag.key }); // creating selects it for this task
}

// Click a tag's colour dot to cycle through the palette (keeps the menu open).
function cycleTagColor(tag, dotEl) {
  const i = CATEGORY_COLORS.indexOf(tag.color);
  tag.color = CATEGORY_COLORS[(i + 1) % CATEGORY_COLORS.length];
  if (dotEl) dotEl.style.background = tag.color;
  persistCategories();
}

function renameTag(pickBtn, tag) {
  const input = document.createElement("input");
  input.className = "tag-rename-input";
  input.value = tag.label;
  pickBtn.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("click", (e) => e.stopPropagation());
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const v = input.value.trim();
    if (v && v !== tag.label) {
      tag.label = v;
      persistCategories();
    }
    render();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      input.value = tag.label;
      input.blur();
    }
  });
}

async function deleteTag(task, tag) {
  const cat = categoryOf(task);
  if (!cat) return;
  const users = tasks.filter((t) => t.status === cat.key && t.tag === tag.key && inActiveTab(t));
  if (users.length) {
    const ok = await confirmModal({
      title: "Delete tag?",
      message: `Delete “${tag.label}”? It will be removed from ${users.length} task${users.length === 1 ? "" : "s"} in this task set.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
  }
  cat.tags = tagsOf(cat).filter((t) => t.key !== tag.key);
  persistCategories();
  users.forEach((t) => {
    t.tag = null;
    t.updated_at = nowIso();
  });
  if (users.length) {
    saveLocal();
    persist(users);
  }
  render();
}

/* ---------- Reorder categories by dragging the column header ----------
 * Same feel as dragging task cards: a floating clone follows the cursor while a
 * dashed placeholder shows where the column will land. */
let colDrag = null;
let justColumnDragged = false;

function removeColumnListeners() {
  window.removeEventListener("pointermove", onColumnMove);
  window.removeEventListener("pointerup", onColumnUp);
  window.removeEventListener("pointercancel", onColumnUp);
}

function onColumnPointerDown(e, column) {
  const touch = isTouch(e);
  if (!touch && e.button !== 0) return;
  if (e.target.closest("input, textarea, .col-delete, .col-collapse")) return; // not renaming / deleting / collapsing
  justColumnDragged = false;
  const rect = column.getBoundingClientRect();
  colDrag = {
    column,
    active: false,
    touch,
    startX: e.clientX,
    startY: e.clientY,
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    lpTimer: null,
  };
  if (touch) {
    colDrag.lpTimer = setTimeout(() => {
      if (colDrag && !colDrag.active) {
        startColumnLift();
        buzz();
      }
    }, LONG_PRESS_MS);
  }
  window.addEventListener("pointermove", onColumnMove);
  window.addEventListener("pointerup", onColumnUp);
  window.addEventListener("pointercancel", onColumnUp);
}

function onColumnMove(e) {
  if (!colDrag) return;
  if (!colDrag.active) {
    const dist = Math.hypot(e.clientX - colDrag.startX, e.clientY - colDrag.startY);
    if (colDrag.touch) {
      if (dist > TOUCH_SLOP) {
        clearTimeout(colDrag.lpTimer);
        removeColumnListeners();
        colDrag = null;
      }
      return;
    }
    if (dist < 6) return;
    startColumnLift();
  }
  e.preventDefault();
  colDrag.clone.style.left = e.clientX - colDrag.grabX + "px";
  colDrag.clone.style.top = e.clientY - colDrag.grabY + "px";
  placeColumnPlaceholder(e.clientX, e.clientY);
  moveAutoScroll(e.clientX, e.clientY);
}

function placeColumnPlaceholder(x, y) {
  if (!colDrag || !colDrag.placeholder) return;
  const after = columnAfterElement(x, y);
  const addTile = board.querySelector(".add-taskset");
  if (after == null) board.insertBefore(colDrag.placeholder, addTile);
  else board.insertBefore(colDrag.placeholder, after);
}

function startColumnLift() {
  colDrag.active = true;
  document.body.classList.add("col-dragging-active");
  const col = colDrag.column;
  const clone = col.cloneNode(true);
  clone.classList.add("col-drag-clone");
  clone.style.width = colDrag.width + "px";
  clone.style.height = colDrag.height + "px";
  document.body.appendChild(clone);
  colDrag.clone = clone;

  const ph = document.createElement("div");
  ph.className = "col-placeholder";
  ph.style.height = colDrag.height + "px";
  colDrag.placeholder = ph;
  col.style.display = "none";
  col.after(ph);

  beginAutoScroll((x, y) => placeColumnPlaceholder(x, y));
}

// The column the placeholder should sit before. Ordering follows the layout:
// vertical (by Y) in stacked view, horizontal (by X) in side-by-side columns —
// so dragging a set feels just like dragging a task.
function columnAfterElement(x, y) {
  const stacked = board.classList.contains("stacked");
  const cols = [...board.querySelectorAll(".column")].filter((c) => c.style.display !== "none");
  return cols.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = stacked ? y - box.top - box.height / 2 : x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function onColumnUp() {
  removeColumnListeners();
  endAutoScroll();
  if (!colDrag) return;
  if (colDrag.lpTimer) clearTimeout(colDrag.lpTimer);
  const d = colDrag;
  colDrag = null;
  if (!d.active) return; // a tap (rename), not a drag

  justColumnDragged = true;
  setTimeout(() => (justColumnDragged = false), 0);

  // New order: the placeholder marks where the dragged column lands.
  const newOrder = [];
  [...board.children].forEach((el) => {
    if (el === d.placeholder) newOrder.push(d.column.dataset.col);
    else if (el.classList.contains("column") && el !== d.column) newOrder.push(el.dataset.col);
  });
  categories.sort((a, b) => newOrder.indexOf(a.key) - newOrder.indexOf(b.key));

  d.clone.remove();
  d.placeholder.remove();
  d.column.style.display = "";
  document.body.classList.remove("col-dragging-active");
  persistCategories();
  render();
}

/* =====================================================================
 * Tabs — a left-aligned bar above the board. Each tab owns its own columns
 * AND its own tasks; clicking one switches both. Click the active tab again to
 * rename it; the × deletes it; drag to reorder (mouse, like cards/columns).
 * ===================================================================== */
const tabBar = document.getElementById("tab-bar");

// Pin any legacy tasks that predate the `tab` field to the first tab, so the
// "first tab owns untagged tasks" rule survives tab reordering.
// Re-home tasks that have no tab (legacy) OR a tab key that matches no current
// tab (e.g. stamped by an older buggy build or a divergent client) onto the
// first tab, and persist the repair so it sticks for everyone. This both
// prevents future loss and RECOVERS tasks that a key mismatch had hidden.
function adoptOrphanTasks() {
  if (!tabs.length) return;
  const known = new Set(tabs.map((t) => t.key));
  const firstKey = tabs[0].key;
  const healed = [];
  tasks.forEach((t) => {
    if ((!t.tab || !known.has(t.tab)) && t.tab !== firstKey) {
      t.tab = firstKey;
      t.updated_at = nowIso();
      healed.push(t);
    }
  });
  if (healed.length) {
    saveLocal();
    if (supa && user && currentBoardId) persist(healed); // fix it in the cloud too
  }
}

function renderTabs() {
  if (!tabBar) return;
  tabBar.innerHTML = "";
  // No tab chips until the user actually makes tabs — a project with only the
  // implicit "Main" tab just shows the "+ Tab" button.
  const showPills = tabs.length > 1;
  if (showPills) tabs.forEach((tab) => {
    const el = document.createElement("div");
    el.className = "tab" + (tab.key === activeTabKey ? " active" : "");
    el.dataset.tab = tab.key;

    const name = document.createElement("button");
    name.className = "tab-name";
    name.type = "button";
    name.textContent = tab.label;
    name.addEventListener("click", () => {
      if (justTabDragged) return; // a drag, not a click
      if (tab.key === activeTabKey) startTabRename(name, tab); // click active again → rename
      else switchTab(tab.key);
    });
    el.appendChild(name);

    // Every user-created tab is deletable (even the only one); the base "Main"
    // tab has no delete affordance.
    if (tab.key !== DEFAULT_TAB_KEY) {
      const del = document.createElement("button");
      del.className = "tab-delete";
      del.type = "button";
      del.title = "Delete tab";
      del.setAttribute("aria-label", "Delete tab");
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteTab(tab);
      });
      el.appendChild(del);
    }

    el.addEventListener("pointerdown", (e) => onTabPointerDown(e, el));
    tabBar.appendChild(el);
  });

  // "+ Tab" at the end of the row (the expected place for a new-tab affordance).
  const add = document.createElement("button");
  add.className = "tab-add";
  add.type = "button";
  add.title = "Add a tab";
  add.setAttribute("aria-label", "Add a tab");
  add.textContent = "+ Tab";
  add.addEventListener("click", addTab);
  tabBar.appendChild(add);
}

function switchTab(key) {
  if (!key || key === activeTabKey) return;
  expandedCardId = null; // drop edit/selection state from the tab we're leaving
  propsOpenForId = null;
  selectedCardId = null;
  activeTabKey = key;
  syncActiveCategories();
  if (!(supa && user && currentBoardId)) saveLocalTabs(); // active tab is a local view pref
  render();
}

function addTab() {
  // Start with a single blank category; fresh keys keep it independent of other tabs.
  const tab = makeTab("New Tab", defaultColumns());
  tabs.push(tab);
  activeTabKey = tab.key;
  syncActiveCategories();
  persistTabs();
  render();
  const tabEl = [...tabBar.querySelectorAll(".tab")].find((el) => el.dataset.tab === tab.key);
  const nameEl = tabEl && tabEl.querySelector(".tab-name");
  if (nameEl) startTabRename(nameEl, tab);
}

async function deleteTab(tab) {
  if (tab.key === DEFAULT_TAB_KEY || tabs.length <= 1) return; // the base tab stays
  // Everything currently shown in this tab (including orphans homed here).
  const doomed = tasks.filter((t) => taskBelongsToTab(t) === tab.key);
  const ok = await confirmModal({
    title: "Delete tab?",
    message: doomed.length
      ? `Delete “${tab.label}”? Its ${doomed.length} task${doomed.length === 1 ? "" : "s"} and columns will be permanently deleted.`
      : `Delete the empty tab “${tab.label}”?`,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  doomed.forEach((t) => remoteDelete(t.id));
  const doomedIds = new Set(doomed.map((t) => t.id));
  tasks = tasks.filter((t) => !doomedIds.has(t.id));
  tabs = tabs.filter((x) => x.key !== tab.key);
  if (activeTabKey === tab.key) activeTabKey = tabs[0].key;
  syncActiveCategories();
  saveLocal();
  persistTabs();
  render();
}

function startTabRename(nameEl, tab) {
  const input = document.createElement("input");
  input.className = "tab-name-input";
  input.value = tab.label;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("click", (e) => e.stopPropagation());
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const v = input.value.trim();
    if (v && v !== tab.label) {
      tab.label = v;
      persistTabs();
    }
    renderTabs();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      input.value = tab.label;
      input.blur();
    }
  });
}

/* ---------- Reorder tabs by dragging (clone + placeholder, like columns) ---------- */
let tabDrag = null;
let justTabDragged = false;

function removeTabListeners() {
  window.removeEventListener("pointermove", onTabMove);
  window.removeEventListener("pointerup", onTabUp);
  window.removeEventListener("pointercancel", onTabUp);
}

function onTabPointerDown(e, el) {
  const touch = isTouch(e);
  if (!touch && e.button !== 0) return;
  if (e.target.closest("input, .tab-delete")) return; // renaming / deleting
  justTabDragged = false;
  const rect = el.getBoundingClientRect();
  tabDrag = {
    el,
    active: false,
    touch,
    startX: e.clientX,
    startY: e.clientY,
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    lpTimer: null,
  };
  if (touch) {
    tabDrag.lpTimer = setTimeout(() => {
      if (tabDrag && !tabDrag.active) {
        startTabLift();
        buzz();
      }
    }, LONG_PRESS_MS);
  }
  window.addEventListener("pointermove", onTabMove);
  window.addEventListener("pointerup", onTabUp);
  window.addEventListener("pointercancel", onTabUp);
}

function onTabMove(e) {
  if (!tabDrag) return;
  if (!tabDrag.active) {
    const dist = Math.hypot(e.clientX - tabDrag.startX, e.clientY - tabDrag.startY);
    if (tabDrag.touch) {
      if (dist > TOUCH_SLOP) {
        clearTimeout(tabDrag.lpTimer);
        removeTabListeners();
        tabDrag = null;
      }
      return;
    }
    if (dist < 6) return;
    startTabLift();
  }
  e.preventDefault();
  tabDrag.clone.style.left = e.clientX - tabDrag.grabX + "px";
  tabDrag.clone.style.top = e.clientY - tabDrag.grabY + "px";
  const after = tabAfterElement(e.clientX);
  const addBtn = tabBar.querySelector(".tab-add");
  if (after == null) tabBar.insertBefore(tabDrag.placeholder, addBtn);
  else tabBar.insertBefore(tabDrag.placeholder, after);
}

function startTabLift() {
  tabDrag.active = true;
  document.body.classList.add("tab-dragging-active");
  const el = tabDrag.el;
  const clone = el.cloneNode(true);
  clone.classList.add("tab-drag-clone");
  clone.style.width = tabDrag.width + "px";
  clone.style.height = tabDrag.height + "px";
  document.body.appendChild(clone);
  tabDrag.clone = clone;

  const ph = document.createElement("div");
  ph.className = "tab-placeholder";
  ph.style.width = tabDrag.width + "px";
  ph.style.height = tabDrag.height + "px";
  tabDrag.placeholder = ph;
  el.style.display = "none";
  el.after(ph);
}

function tabAfterElement(x) {
  const els = [...tabBar.querySelectorAll(".tab")].filter((c) => c.style.display !== "none");
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function onTabUp() {
  removeTabListeners();
  if (!tabDrag) return;
  if (tabDrag.lpTimer) clearTimeout(tabDrag.lpTimer);
  const d = tabDrag;
  tabDrag = null;
  if (!d.active) return; // a tap (switch/rename), not a drag

  justTabDragged = true;
  setTimeout(() => (justTabDragged = false), 0);

  const newOrder = [];
  [...tabBar.children].forEach((el) => {
    if (el === d.placeholder) newOrder.push(d.el.dataset.tab);
    else if (el.classList.contains("tab") && el !== d.el) newOrder.push(el.dataset.tab);
  });
  tabs.sort((a, b) => newOrder.indexOf(a.key) - newOrder.indexOf(b.key));

  d.clone.remove();
  d.placeholder.remove();
  d.el.style.display = "";
  document.body.classList.remove("tab-dragging-active");
  persistTabs();
  render();
}

function render() {
  const beforeFlip = flipNextRender ? snapshotCards() : null;
  const boardTitle = currentBoardName();
  document.getElementById("app-title").textContent = boardTitle;
  document.title = boardTitle === "New Project" ? boardTitle : `${boardTitle} · New Project`;
  renderTabs();

  board.innerHTML = "";
  categories.forEach((col, index) => {
    const all = group(col.key);
    const completedInCol = all.filter((t) => t.completed);
    const items = all.filter(isVisibleTask);

    const column = document.createElement("section");
    const collapsed = collapsedSets.has(col.key);
    column.className = "column" + (collapsed ? " collapsed" : "");
    column.dataset.col = col.key;
    column.innerHTML = `
      <div class="column-header" title="Click to collapse / expand">
        <span class="col-grip" title="Drag to reorder">${GRIP_SVG}</span>
        <span class="column-name-slot"></span>
        <span class="count">${items.length}</span>
        <button class="col-delete" type="button" title="Delete task set" aria-label="Delete task set">×</button>
      </div>
      <div class="card-list"></div>
      <div class="add-row"><input class="add-input" type="text" placeholder="+ Add something" aria-label="Add something" /></div>
    `;
    // Clicking the header (anywhere but the name text / delete) collapses or
    // expands the set. The name text and delete stop their own clicks; a click
    // that ends a drag is ignored via justColumnDragged.
    column.querySelector(".column-header").addEventListener("click", () => {
      if (justColumnDragged) return;
      if (collapsedSets.has(col.key)) collapsedSets.delete(col.key);
      else collapsedSets.add(col.key);
      saveCollapsed();
      render();
    });
    // Set name — click the text itself (not the empty header space) to rename.
    const nameEdit = textEdit({
      value: col.label,
      placeholder: "Set name",
      wrapClass: "column-name-wrap",
      displayClass: "column-name-text",
      inputClass: "column-name-input",
      onCommit: (v) => {
        if (v && v !== col.label) {
          col.label = v;
          persistCategories();
        }
        render();
      },
      onDisplayClick: () => !justColumnDragged, // don't edit on the click that ends a drag
    });
    column.querySelector(".column-name-slot").replaceWith(nameEdit);
    const delBtn = column.querySelector(".col-delete");
    delBtn.hidden = categories.length <= 1; // keep at least one
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCategory(col);
    });
    column.querySelector(".column-header").addEventListener("pointerdown", (e) => onColumnPointerDown(e, column));

    const list = column.querySelector(".card-list");
    if (!collapsed) items.forEach((task) => list.appendChild(renderCard(task)));

    // Low-profile "Show completed" toggle — only when expanded and it has completed items.
    if (!collapsed && completedInCol.length > 0) {
      const shown = shownCompletedCols.has(col.key);
      const scBtn = document.createElement("button");
      scBtn.className = "show-completed" + (shown ? " on" : "");
      scBtn.type = "button";
      scBtn.textContent = `${shown ? "Hide" : "Show"} completed (${completedInCol.length})`;
      scBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (shown) shownCompletedCols.delete(col.key);
        else shownCompletedCols.add(col.key);
        render();
      });
      column.querySelector(".add-row").before(scBtn);
    }

    const addInput = column.querySelector(".add-input");
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const value = addInput.value.trim();
      if (value) quickAddTask(col.key, value);
    });
    board.appendChild(column);
  });

  // "+ Task Set" tile at the end of the board — slim to the right in column mode,
  // full width below in stack mode (styled in CSS).
  const addTile = document.createElement("button");
  addTile.className = "add-taskset";
  addTile.type = "button";
  addTile.title = "Add task set";
  addTile.setAttribute("aria-label", "Add task set");
  addTile.innerHTML = `<span class="ats-plus">+</span><span class="ats-label">New Set</span>`;
  addTile.addEventListener("click", addCategory);
  board.appendChild(addTile);

  if (beforeFlip) flipCards(beforeFlip);
  flipNextRender = false;
}

function renderCard(task) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  const expanded = expandedCardId === task.id;
  if (expanded) node.classList.add("expanded");
  if (task.id === selectedCardId) node.classList.add("selected");
  if (task.completed) node.classList.add("done-card");

  // Left edge = the colour you pick.
  const colorDef = LABELS.find((l) => l.key === task.label);
  node.style.borderLeftColor = colorDef ? colorDef.color : "var(--border)";

  // Check circle — marks the task complete in place (dim + strikethrough).
  const check = node.querySelector(".check");
  if (task.completed) {
    check.classList.add("on");
    check.textContent = "✓";
  }
  check.title = task.completed ? "Mark not done" : "Mark done";
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCompleted(task.id);
  });

  // Title — click the text itself to edit. On a collapsed card, a click on the
  // title just expands the card (we let the click bubble to the card handler).
  const titleEl = node.querySelector(".card-title");
  const titleEdit = textEdit({
    value: task.title,
    placeholder: "Task name",
    wrapClass: "card-title-wrap",
    displayClass: "card-title-text",
    inputClass: "card-title-input",
    onCommit: (v) => updateTask(task.id, { title: v }),
    onDisplayClick: () => expandedCardId === task.id, // collapsed → false → bubble → expand
  });
  titleEl.replaceWith(titleEdit);

  // Meta: due / priority / checklist progress (progress counts all checklist
  // blocks together).
  const checklist = blockItems(task.blocks || []);
  const badge = node.querySelector(".due-badge");
  if (task.due) {
    badge.hidden = false;
    badge.textContent = "📅 " + formatShort(task.due);
    if (isOverdue(task)) badge.classList.add("overdue");
  }
  const selectedTag = tagsOf(categoryOf(task)).find((t) => t.key === task.tag);
  const pill = node.querySelector(".tag-pill");
  if (selectedTag) {
    pill.hidden = false;
    const color = selectedTag.color || "#94a3b8";
    pill.innerHTML = `<span class="tag-pill-dot"></span>`;
    pill.querySelector(".tag-pill-dot").style.background = color;
    pill.append(selectedTag.label);
    pill.style.background = color + "1a";
    pill.style.color = darkenColor(color);
  }
  const who = node.querySelector(".assignee-chip");
  if (task.assignee) {
    who.hidden = false;
    who.textContent = "👤 " + task.assignee;
  }
  const chip = node.querySelector(".progress-chip");
  if (checklist.length) {
    const done = checklist.filter((i) => i.done).length;
    const pct = Math.round((done / checklist.length) * 100);
    chip.hidden = false;
    if (done === checklist.length) chip.classList.add("complete");
    chip.innerHTML = `<span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span><span class="progress-count">${done}/${checklist.length}</span>`;
  }
  node.querySelector(".card-meta").hidden = !task.due && !selectedTag && !task.assignee && checklist.length === 0;

  // Body: the card's blocks (text boxes + checklists, as many of each as the
  // user added, in order), attachments, then the "+ Add something" chooser.
  renderBlocks(node, task);
  renderAttachments(node, task);
  renderBlockAdd(node, task);

  // Menu fields: tag, assignee, due date, colour (at the bottom).
  renderTagSelector(node, task);
  renderAssigneeSelector(node, task);
  const dueInput = node.querySelector(".due-input");
  dueInput.value = task.due || "";
  dueInput.addEventListener("change", () => updateAndRender(task.id, { due: dueInput.value || null }));
  renderSwatches(node.querySelector(".label-swatches"), task);

  // "More" toggle: the priority/due/colour options start collapsed.
  const propsToggle = node.querySelector(".props-toggle");
  const propsOpen = propsOpenForId === task.id;
  node.classList.toggle("props-open", propsOpen);
  propsToggle.textContent = propsOpen ? "Less ▴" : "More ▾";
  propsToggle.setAttribute("aria-expanded", String(propsOpen));
  propsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !node.classList.contains("props-open");
    node.classList.toggle("props-open", open);
    propsOpenForId = open ? task.id : null;
    propsToggle.textContent = open ? "Less ▴" : "More ▾";
    propsToggle.setAttribute("aria-expanded", String(open));
  });

  // Delete.
  node.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    requestDeleteTask(task.id);
  });

  // Click a collapsed card to expand it in place; click its header (the top
  // row, but not the title text) again to collapse it. Inner clicks (title
  // text, notes, checklist, buttons) are handled by their own handlers.
  node.addEventListener("click", (e) => {
    if (justDragged) return;
    if (e.target.closest(".check, .delete-btn")) return;
    if (expandedCardId === task.id) {
      if (e.target.closest(".card-top")) collapseCard(); // header click → collapse
      return;
    }
    e.stopPropagation();
    selectedCardId = task.id;
    expandCard(task.id);
  });

  // Drag (mouse) is always available.
  node.addEventListener("pointerdown", (e) => onCardPointerDown(e, node, task.id));

  return node;
}

/* ---------- Expand / collapse (animated on the live node) ---------- */
function setCardExpanded(node, open) {
  if (!node) return;
  node.classList.toggle("expanded", open);
}

function expandCard(id) {
  if (expandedCardId && expandedCardId !== id) {
    setCardExpanded(board.querySelector(`.card[data-id="${expandedCardId}"]`), false);
  }
  const node = board.querySelector(`.card[data-id="${id}"]`);
  if (!node) return;
  expandedCardId = id;
  selectedCardId = id;
  propsOpenForId = null; // options start collapsed each time a card opens
  setCardExpanded(node, true);
}

function collapseCard() {
  if (!expandedCardId) return;
  pruneEmptyBlocks(expandedCardId); // never-filled boxes vanish on close
  setCardExpanded(board.querySelector(`.card[data-id="${expandedCardId}"]`), false);
  expandedCardId = null;
}

/* ---------- FLIP: glide cards to their new spot on the next render ---------- */
let flipNextRender = false;
function snapshotCards() {
  const m = new Map();
  board.querySelectorAll(".card").forEach((el) => m.set(el.dataset.id, el.getBoundingClientRect()));
  return m;
}
function flipCards(before) {
  board.querySelectorAll(".card").forEach((el) => {
    const old = before.get(el.dataset.id);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)";
      el.style.transform = "";
    });
  });
}

function renderSwatches(container, task) {
  LABELS.forEach((l) => {
    const b = document.createElement("button");
    b.className = "swatch" + (task.label === l.key ? " selected" : "");
    b.style.background = l.color;
    b.title = l.key;
    b.addEventListener("click", () => {
      const next = task.label === l.key ? null : l.key;
      updateAndRender(task.id, { label: next });
    });
    container.appendChild(b);
  });
  const none = document.createElement("button");
  none.className = "swatch none" + (!task.label ? " selected" : "");
  none.textContent = "✕";
  none.title = "No color";
  none.addEventListener("click", () => updateAndRender(task.id, { label: null }));
  container.appendChild(none);
}

// Update a metadata field and re-render so indicators refresh.
function updateAndRender(id, fields) {
  updateTask(id, fields);
  render();
}

/* ---------- Inline "click the text to edit" field ----------
 * Shows the value (or its placeholder) as inline text sized to the text itself,
 * so ONLY a click on the actual text enters edit mode — clicking the empty area
 * around it does nothing and shows no edit cursor. Used for the card title,
 * description, and checklist steps.
 *   opts: { value, placeholder, multiline, displayClass, inputClass,
 *           onCommit(v), onInput(v)?, onDisplayClick(e)? -> false to let bubble } */
function textEdit(opts) {
  const wrap = document.createElement("span");
  wrap.className = "tedit" + (opts.multiline ? " tedit-multi" : "") + (opts.wrapClass ? " " + opts.wrapClass : "");
  let value = opts.value != null ? String(opts.value) : "";

  const display = document.createElement("span");
  display.className = "tedit-text" + (opts.displayClass ? " " + opts.displayClass : "");
  const paint = () => {
    display.textContent = value !== "" ? value : opts.placeholder || "";
    display.classList.toggle("tedit-placeholder", value === "");
  };
  paint();
  display.addEventListener("click", (e) => {
    if (opts.onDisplayClick && opts.onDisplayClick(e) === false) return; // let it bubble (e.g. expand)
    e.stopPropagation();
    edit();
  });
  wrap.appendChild(display);
  wrap.startEdit = edit;

  function edit() {
    const field = document.createElement(opts.multiline ? "textarea" : "input");
    field.className = "tedit-input" + (opts.inputClass ? " " + opts.inputClass : "");
    if (!opts.multiline) field.type = "text";
    else field.rows = 1;
    field.value = value;
    if (opts.placeholder) field.placeholder = opts.placeholder;
    wrap.replaceChild(field, display);
    if (opts.multiline) autoGrow(field);
    field.focus();
    const n = field.value.length;
    try {
      field.setSelectionRange(n, n);
    } catch (e) {
      /* ignore */
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      value = field.value;
      paint();
      if (field.parentNode === wrap) wrap.replaceChild(display, field);
      opts.onCommit && opts.onCommit(value);
    };
    field.addEventListener("blur", finish);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!opts.multiline || !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        field.blur();
      } else if (e.key === "Escape") {
        e.stopPropagation(); // just cancel the edit, don't also collapse the card
        field.value = value;
        field.blur();
      }
    });
    field.addEventListener("input", () => {
      if (opts.multiline) autoGrow(field);
      opts.onInput && opts.onInput(field.value);
    });
    // While editing, keep clicks/drags from reaching the card underneath.
    field.addEventListener("click", (e) => e.stopPropagation());
    field.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  return wrap;
}

/* ---------- "+ Add something" body blocks ----------
 * A card's body starts empty; this menu is the one place to add to it.
 * A card can hold any number of text boxes and checklists, in order.
 * Extend BLOCK_TYPES to offer new kinds of content later. */
const BLOCK_TYPES = [
  { key: "text", icon: "📝", label: "Text" },
  { key: "checklist", icon: "☑️", label: "Checklist" },
  { key: "image", icon: "🖼️", label: "Image" },
  { key: "file", icon: "📎", label: "File" },
];

function renderBlockAdd(node, task) {
  const btn = node.querySelector(".block-add-btn");
  const menu = node.querySelector(".block-menu");
  const picker = node.querySelector(".attach-input");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    document.querySelectorAll(".tag-menu").forEach((m) => (m.hidden = true));
    if (!willOpen) return;
    buildBlockMenu(menu, node, task, picker);
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + 4 + "px";
    menu.style.minWidth = "150px";
    menu.hidden = false;
  });
  picker.addEventListener("click", (e) => e.stopPropagation());
  picker.addEventListener("change", () => {
    const file = picker.files && picker.files[0];
    picker.value = "";
    if (file) addAttachment(task, file, picker.dataset.kind);
  });
}

function buildBlockMenu(menu, node, task, picker) {
  menu.innerHTML = "";
  BLOCK_TYPES.forEach((b) => {
    const pick = document.createElement("button");
    pick.className = "tag-menu-pick";
    pick.textContent = b.icon + " " + b.label;
    pick.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = true;
      chooseBlock(node, task, b.key, picker);
    });
    menu.appendChild(pick);
  });
}

function chooseBlock(node, task, key, picker) {
  if (key === "image" || key === "file") {
    picker.accept = key === "image" ? "image/*" : "";
    picker.dataset.kind = key;
    picker.click();
    return;
  }
  // Add the block in memory only — it's persisted (and synced) when it gets
  // its first content, and quietly dropped if it never does.
  const block =
    key === "text" ? { id: makeId(), type: "text", text: "" } : { id: makeId(), type: "checklist", items: [] };
  task.blocks.push(block);
  render();
  const sel = `[data-id="${task.id}"] [data-block-id="${block.id}"]`;
  if (key === "text") document.querySelector(sel)?.startEdit(); // straight into typing
  else document.querySelector(`${sel} .checklist-input`)?.focus();
}

// Persist a task's blocks plus the legacy notes/checklist mirrors.
function commitBlocks(task) {
  task.blocks = task.blocks.filter((b) => (b.type === "text" ? b.text.trim() : true));
  updateTask(task.id, { blocks: task.blocks, notes: blockNotes(task.blocks), checklist: blockItems(task.blocks) });
}

function pruneEmptyBlocks(taskId) {
  const task = getTask(taskId);
  if (!task || !Array.isArray(task.blocks)) return;
  const pruned = task.blocks.filter((b) => (b.type === "text" ? b.text.trim() : b.items.length));
  if (pruned.length !== task.blocks.length) {
    task.blocks = pruned;
    commitBlocks(task);
  }
}

function renderBlocks(node, task) {
  const box = node.querySelector(".card-blocks");
  (task.blocks || []).forEach((block) => {
    box.appendChild(block.type === "checklist" ? renderChecklistBlock(task, block) : renderTextBlock(task, block));
  });
}

function renderTextBlock(task, block) {
  const edit = textEdit({
    value: block.text,
    placeholder: "Add text…",
    multiline: true,
    wrapClass: "card-notes-wrap",
    displayClass: "card-notes-text",
    inputClass: "card-notes-input",
    onCommit: (v) => setTextBlock(task.id, block.id, v),
  });
  edit.dataset.blockId = block.id;
  return edit;
}

function setTextBlock(taskId, blockId, text) {
  const task = getTask(taskId);
  if (!task) return;
  const block = task.blocks.find((b) => b.id === blockId);
  if (!block) return;
  const emptied = !text.trim();
  block.text = text;
  commitBlocks(task); // an emptied box is filtered out here
  if (emptied) render();
}

/* ---------- Attachments (images + files) ----------
 * Signed in: the file goes to the public "attachments" storage bucket and the
 * task row only carries small metadata (never file bytes — every realtime
 * change re-pulls task rows, so embedded files would multiply egress).
 * Signed out: stored locally as a data URL (images get downscaled), capped so
 * localStorage stays healthy. */
async function addAttachment(task, file, kind) {
  kind = kind === "image" || (file.type || "").startsWith("image/") ? "image" : "file";
  const att = { id: makeId(), kind, name: file.name, size: file.size };
  try {
    if (user && supa) {
      const clean = file.name.replace(/[^\w.\-]+/g, "_");
      const path = (currentBoardId || "personal") + "/" + att.id + "-" + clean;
      const up = await supa.storage.from("attachments").upload(path, file);
      if (up.error) throw up.error;
      att.path = path;
      att.url = supa.storage.from("attachments").getPublicUrl(path).data.publicUrl;
    } else {
      att.url = kind === "image" ? await imageToDataUrl(file) : await fileToDataUrl(file);
      if (att.url.length > 1_400_000) {
        alert("That file is too big to keep on this device (about 1 MB max while signed out). Sign in to attach bigger files.");
        return;
      }
    }
  } catch (err) {
    console.error("Attachment failed", err);
    alert("Couldn't attach that file: " + (err.message || err));
    return;
  }
  const list = Array.isArray(task.attachments) ? task.attachments.slice() : [];
  list.push(att);
  updateAndRender(task.id, { attachments: list });
}

function renderAttachments(node, task) {
  const box = node.querySelector(".card-attachments");
  const list = Array.isArray(task.attachments) ? task.attachments : [];
  box.hidden = list.length === 0;
  list.forEach((att) => {
    const item = document.createElement("div");
    item.className = "attach-item " + (att.kind === "image" ? "attach-image" : "attach-file");
    item.title = att.name;
    if (att.kind === "image") {
      const img = document.createElement("img");
      img.src = att.url;
      img.alt = att.name;
      img.loading = "lazy";
      item.appendChild(img);
    } else {
      const chip = document.createElement("span");
      chip.className = "attach-name";
      chip.textContent = "📎 " + att.name;
      item.appendChild(chip);
    }
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      openAttachment(att);
    });
    const del = document.createElement("button");
    del.className = "attach-del";
    del.textContent = "×";
    del.title = "Remove attachment";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAttachment(task, att);
    });
    item.appendChild(del);
    box.appendChild(item);
  });
}

function openAttachment(att) {
  if (!att.url) return;
  if (att.url.startsWith("data:")) {
    // Browsers block navigating straight to data: URLs — hand over a blob URL.
    fetch(att.url)
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        window.open(u, "_blank");
        setTimeout(() => URL.revokeObjectURL(u), 60_000);
      });
  } else {
    window.open(att.url, "_blank");
  }
}

function removeAttachment(task, att) {
  const list = (task.attachments || []).filter((a) => a.id !== att.id);
  updateAndRender(task.id, { attachments: list });
  if (att.path && supa && user) {
    supa.storage.from("attachments").remove([att.path]); // best-effort cleanup
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Couldn't read file"));
    r.readAsDataURL(file);
  });
}

// Downscale + re-encode big images so the local copy stays small.
async function imageToDataUrl(file) {
  const raw = await fileToDataUrl(file);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = raw;
  });
  const MAX = 1400;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  if (scale === 1 && raw.length < 500_000) return raw;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/* ---------- Checklist blocks (sub-steps; a card can have several) ---------- */
function renderChecklistBlock(task, block) {
  const wrap = document.createElement("div");
  wrap.className = "card-checklist";
  wrap.dataset.blockId = block.id;

  const list = document.createElement("ul");
  list.className = "checklist-items";
  (block.items || []).forEach((item) => {
    const li = document.createElement("li");
    li.className = "checklist-item" + (item.done ? " done" : "");
    li.dataset.itemId = item.id;

    const handle = document.createElement("span");
    handle.className = "checklist-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.addEventListener("pointerdown", (e) => onChecklistHandleDown(e, task.id, block.id, li));

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.done;
    cb.addEventListener("change", () => toggleChecklistItem(task.id, block.id, item.id));

    const text = textEdit({
      value: item.text,
      placeholder: "Step",
      multiline: true,
      wrapClass: "checklist-wrap",
      displayClass: "checklist-text-display",
      inputClass: "checklist-text-input",
      onCommit: (v) => updateChecklistText(task.id, block.id, item.id, v),
    });

    const del = document.createElement("button");
    del.className = "checklist-del";
    del.textContent = "×";
    del.title = "Remove step";
    del.addEventListener("click", () => deleteChecklistItem(task.id, block.id, item.id));

    li.append(handle, cb, text, del);
    list.appendChild(li);
  });

  const addInput = document.createElement("input");
  addInput.className = "checklist-input";
  addInput.type = "text";
  addInput.placeholder = "+ Add a step…";
  addInput.setAttribute("aria-label", "Add a step");
  addInput.addEventListener("keydown", (e) => {
    const value = addInput.value.trim();
    if (e.key === "Enter" && value) addChecklistItem(task.id, block.id, value);
  });

  wrap.append(list, addInput);
  return wrap;
}

function checklistBlockOf(taskId, blockId) {
  const task = getTask(taskId);
  const block = task && (task.blocks || []).find((b) => b.id === blockId && b.type === "checklist");
  return block ? { task, block } : null;
}

function addChecklistItem(taskId, blockId, text) {
  const found = checklistBlockOf(taskId, blockId);
  if (!found) return;
  found.block.items.push({ id: makeId(), text, done: false });
  commitBlocks(found.task);
  render();
  const el = document.querySelector(`[data-id="${taskId}"] [data-block-id="${blockId}"] .checklist-input`);
  if (el) el.focus();
}

function toggleChecklistItem(taskId, blockId, itemId) {
  const found = checklistBlockOf(taskId, blockId);
  const item = found && found.block.items.find((i) => i.id === itemId);
  if (!item) return;
  item.done = !item.done;
  commitBlocks(found.task);
  render();
}

function updateChecklistText(taskId, blockId, itemId, text) {
  const found = checklistBlockOf(taskId, blockId);
  const item = found && found.block.items.find((i) => i.id === itemId);
  if (!item) return;
  item.text = text;
  commitBlocks(found.task);
}

function deleteChecklistItem(taskId, blockId, itemId) {
  const found = checklistBlockOf(taskId, blockId);
  if (!found) return;
  found.block.items = found.block.items.filter((i) => i.id !== itemId);
  commitBlocks(found.task);
  render();
}

/* ---------- Checklist reorder (drag handle, pointer-based) ---------- */
let listDrag = null;

function removeChecklistListeners() {
  window.removeEventListener("pointermove", onChecklistMove);
  window.removeEventListener("pointerup", onChecklistUp);
  window.removeEventListener("pointercancel", onChecklistUp);
}

function onChecklistHandleDown(e, taskId, blockId, li) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.stopPropagation(); // keep the card itself from starting a drag
  e.preventDefault(); // the handle is for dragging — don't scroll/select (touch + mouse)
  listDrag = { taskId, blockId, li, ul: li.parentElement };
  li.classList.add("reordering");
  window.addEventListener("pointermove", onChecklistMove);
  window.addEventListener("pointerup", onChecklistUp);
  window.addEventListener("pointercancel", onChecklistUp);
}

function onChecklistMove(e) {
  if (!listDrag) return;
  e.preventDefault();
  const { ul, li } = listDrag;
  const after = checklistAfterElement(ul, e.clientY);
  if (after == null) ul.appendChild(li);
  else ul.insertBefore(li, after);
}

function onChecklistUp() {
  removeChecklistListeners();
  if (!listDrag) return;
  const { taskId, blockId, ul, li } = listDrag;
  li.classList.remove("reordering");
  const order = [...ul.querySelectorAll(".checklist-item")].map((el) => el.dataset.itemId);
  const found = checklistBlockOf(taskId, blockId);
  if (found) {
    found.block.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    commitBlocks(found.task);
  }
  listDrag = null;
  render();
}

function checklistAfterElement(ul, y) {
  const items = [...ul.querySelectorAll(".checklist-item:not(.reordering)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

/* =====================================================================
 * Drag & drop — custom pointer-based, works with mouse AND touch.
 * Mouse: hold and move past a small threshold to drag the whole card (a plain
 * click still edits). Touch: long-press a collapsed card to pick it up (moving
 * before the press completes scrolls the list instead). Cards, columns and tabs
 * all share this feel.
 * ===================================================================== */
let drag = null;
let justDragged = false;
const DRAG_THRESHOLD = 5; // px before a mouse hold becomes a drag
const LONG_PRESS_MS = 300; // touch: hold (roughly still) this long to start dragging
const TOUCH_SLOP = 12; // touch: moving more than this before the hold = a scroll, not a drag

function isTouch(e) {
  return e.pointerType !== "mouse";
}
function buzz() {
  try {
    if (navigator.vibrate) navigator.vibrate(10);
  } catch (e) {
    /* ignore */
  }
}
function removeDragListeners() {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragEnd);
}

/* Auto-scroll while dragging near a viewport edge, so you can drop into places
 * that are currently off-screen. Scrolls the window vertically (up + down) and
 * the board horizontally (left + right, in side-by-side columns). The onScroll
 * callback re-places the drop marker as the content moves under the pointer. */
let autoScroll = null;
function beginAutoScroll(onScroll) {
  if (autoScroll) return;
  autoScroll = { x: 0, y: 0, onScroll, raf: 0 };
  const EDGE = 72; // px from an edge where scrolling kicks in
  const MAX = 22; // max px per frame at the very edge
  const step = () => {
    if (!autoScroll) return;
    const { x, y } = autoScroll;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let dy = 0;
    let dx = 0;
    if (y < EDGE) dy = -Math.ceil((1 - y / EDGE) * MAX);
    else if (y > vh - EDGE) dy = Math.ceil((1 - (vh - y) / EDGE) * MAX);
    if (x < EDGE) dx = -Math.ceil((1 - x / EDGE) * MAX);
    else if (x > vw - EDGE) dx = Math.ceil((1 - (vw - x) / EDGE) * MAX);
    let moved = false;
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) moved = true;
    }
    if (dx && board.scrollWidth > board.clientWidth + 1) {
      const before = board.scrollLeft;
      board.scrollLeft += dx;
      if (board.scrollLeft !== before) moved = true;
    }
    if (moved && autoScroll.onScroll) autoScroll.onScroll(x, y);
    autoScroll.raf = requestAnimationFrame(step);
  };
  autoScroll.raf = requestAnimationFrame(step);
}
function moveAutoScroll(x, y) {
  if (autoScroll) {
    autoScroll.x = x;
    autoScroll.y = y;
  }
}
function endAutoScroll() {
  if (autoScroll) {
    cancelAnimationFrame(autoScroll.raf);
    autoScroll = null;
  }
}

function onCardPointerDown(e, node, id) {
  const touch = isTouch(e);
  if (!touch) {
    if (e.button !== 0) return;
  } else {
    // Touch: long-press to drag. Don't start on buttons (tap them) or on an
    // already-open card (it's being read/edited — scroll it instead).
    if (expandedCardId === id) return;
    if (e.target.closest("button, .check, .delete-btn")) return;
  }
  // Mouse: if pressing inside a text field you've already focused (caret active),
  // let it select/copy/paste instead of dragging.
  const field = e.target.closest("textarea, input[type='text']");
  if (!touch && field && document.activeElement === field && !field.readOnly) return;
  justDragged = false;
  const rect = node.getBoundingClientRect();
  drag = {
    id,
    node,
    active: false,
    touch,
    startX: e.clientX,
    startY: e.clientY,
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    lpTimer: null,
  };
  if (touch) {
    drag.lpTimer = setTimeout(() => {
      if (drag && !drag.active) {
        startLift();
        buzz();
      }
    }, LONG_PRESS_MS);
  }
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  if (!drag.active) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (drag.touch) {
      // Moved before the long-press fired → the user is scrolling; let go.
      if (dist > TOUCH_SLOP) {
        clearTimeout(drag.lpTimer);
        removeDragListeners();
        drag = null;
      }
      return; // otherwise keep waiting for the press to complete
    }
    if (dist < DRAG_THRESHOLD) return;
    startLift();
  }
  e.preventDefault();
  drag.clone.style.left = e.clientX - drag.grabX + "px";
  drag.clone.style.top = e.clientY - drag.grabY + "px";
  updatePlaceholder(e.clientX, e.clientY);
  moveAutoScroll(e.clientX, e.clientY);
}

function startLift() {
  drag.active = true;
  document.body.classList.add("dragging-active");
  if (document.activeElement && drag.node.contains(document.activeElement)) document.activeElement.blur();

  const clone = drag.node.cloneNode(true);
  clone.classList.add("drag-clone");
  clone.style.width = drag.width + "px";
  clone.style.height = drag.height + "px";
  document.body.appendChild(clone);
  drag.clone = clone;

  const ph = document.createElement("div");
  ph.className = "card-placeholder";
  ph.style.height = drag.height + "px";
  drag.placeholder = ph;
  drag.node.style.display = "none";
  drag.node.after(ph);

  beginAutoScroll((x, y) => updatePlaceholder(x, y));
}

function updatePlaceholder(x, y) {
  const column = columnFromPoint(x, y);
  document.querySelectorAll(".column").forEach((c) => c.classList.toggle("drag-over", c === column));
  if (!column) return;
  const list = column.querySelector(".card-list");
  const after = getDragAfterElement(list, y);
  if (after == null) list.appendChild(drag.placeholder);
  else list.insertBefore(drag.placeholder, after);
}

function onDragEnd(e) {
  removeDragListeners();
  endAutoScroll();
  if (!drag) return;
  if (drag.lpTimer) clearTimeout(drag.lpTimer);
  const d = drag;
  drag = null;
  if (!d.active) return; // a tap/click, not a drag

  e.preventDefault();
  justDragged = true;
  // Only suppress the synthetic click that fires immediately after this drag,
  // not a genuine click later (in case the browser fires no click at all).
  setTimeout(() => (justDragged = false), 0);

  const list = d.placeholder.parentElement;
  const column = list ? list.closest(".column") : null;
  let beforeId = null;
  const next = d.placeholder.nextElementSibling;
  if (next && next.dataset && next.dataset.id) beforeId = next.dataset.id;

  d.clone.remove();
  d.placeholder.remove();
  d.node.style.display = "";
  document.body.classList.remove("dragging-active");
  document.querySelectorAll(".column").forEach((c) => c.classList.remove("drag-over"));

  if (column) moveTaskTo(d.id, column.dataset.col, beforeId); // re-renders
}

// Swallow the click that may follow a drag so it doesn't focus a field.
document.addEventListener(
  "click",
  (e) => {
    if (justDragged && e.target.closest(".card")) {
      e.stopPropagation();
      e.preventDefault();
    }
    justDragged = false;
  },
  true
);

function columnFromPoint(x, y) {
  return (
    [...document.querySelectorAll(".column")].find((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null
  );
}

function getDragAfterElement(list, y) {
  const cards = [...list.querySelectorAll(".card")].filter((c) => c.offsetParent !== null);
  return cards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

/* =====================================================================
 * Supabase sync + auth
 * ===================================================================== */
function syncConfigured() {
  const c = window.APP_CONFIG || {};
  return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

function rowFromTask(t) {
  const row = { user_id: user.id };
  if (currentBoardId) row.board_id = currentBoardId;
  if (checklistSyncable) row.checklist = t.checklist || [];
  if (completedSyncable) row.completed = !!t.completed;
  if (tagSyncable) row.tag = t.tag || null;
  if (taskTabSyncable) row.tab = t.tab || null; // note: distinct from `tag` above
  if (assigneeSyncable) row.assignee = t.assignee || null;
  if (attachmentsSyncable) row.attachments = t.attachments || [];
  if (blocksSyncable) row.blocks = t.blocks || [];
  TASK_FIELDS.forEach((f) => (row[f] = t[f]));
  return row;
}

function taskFromRow(r) {
  return normalizeTask(r);
}

async function initSync() {
  const bar = document.getElementById("auth-bar");
  if (!syncConfigured()) {
    bar.hidden = true; // local-only mode
    return;
  }
  bar.hidden = false;
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    supa = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

    const { data } = await supa.auth.getSession();
    await setUser(data.session ? data.session.user : null);

    supa.auth.onAuthStateChange((_event, session) => {
      setUser(session ? session.user : null);
    });
  } catch (e) {
    console.error("Sync unavailable; running local-only.", e);
    renderAuthBar("Sync unavailable — working offline.");
  }
}

async function setUser(nextUser) {
  const sameUser = user && nextUser && user.id === nextUser.id;
  const firstSignIn = !user && !!nextUser;
  user = nextUser;
  // Token-refresh / focus events re-fire for the same user — don't re-run board
  // setup (that's what created duplicate "My Tasks" boards).
  if (sameUser) return;
  if (user) {
    await setupBoards(); // load boards, honor a share link, pick the active board
    const probe = await supa.from("tasks").select("checklist").limit(1);
    checklistSyncable = !probe.error; // false until supabase-checklist.sql is run
    const probeDone = await supa.from("tasks").select("completed").limit(1);
    completedSyncable = !probeDone.error;
    const probeCols = await supa.from("boards").select("columns").limit(1);
    columnsSyncable = !probeCols.error; // false until supabase-categories.sql is run
    const probeTag = await supa.from("tasks").select("tag").limit(1);
    tagSyncable = !probeTag.error; // false until supabase-tags.sql is run
    const probeTabs = await supa.from("boards").select("tabs").limit(1);
    tabsSyncable = !probeTabs.error; // false until supabase-tabs.sql is run
    const probeTaskTab = await supa.from("tasks").select("tab").limit(1);
    taskTabSyncable = !probeTaskTab.error;
    const probeAssignee = await supa.from("tasks").select("assignee").limit(1);
    assigneeSyncable = !probeAssignee.error; // false until supabase-assignee.sql is run
    const probeAttach = await supa.from("tasks").select("attachments").limit(1);
    attachmentsSyncable = !probeAttach.error; // false until supabase-attachments.sql is run
    const probeBlocks = await supa.from("tasks").select("blocks").limit(1);
    blocksSyncable = !probeBlocks.error; // false until supabase-blocks.sql is run
    await cleanupDuplicatePersonalBoards(); // tidy any dupes from the old race
    loadTabsForBoard(); // this board's tabs (+ their columns)
    await pullRemote(firstSignIn); // migrate local tasks into the personal board on first sign-in
    subscribeRealtime();
  } else {
    boards = [];
    currentBoardId = null;
    loadLocalTabs(); // restore local tabs / active tab / categories
    adoptOrphanTasks();
  }
  renderAuthBar();
  renderBoardControls();
  applyBoardTheme();
  render();
}

/* ---------- Boards ---------- */
function currentBoardName() {
  if (user && currentBoardId) {
    const b = boards.find((x) => x.id === currentBoardId);
    if (b) return b.name;
  }
  return "New Project";
}

function isPersonalBoard(id) {
  const b = boards.find((x) => x.id === id);
  return !!(b && user && b.owner_id === user.id);
}

async function loadBoards() {
  const { data, error } = await supa.from("boards").select("*").order("created_at");
  if (error) {
    // boards table not set up yet → fall back to single-board mode.
    console.warn("Boards unavailable; running in single-board mode.", error.message);
    boards = [];
    return false;
  }
  boards = data || [];
  return true;
}

async function ensurePersonalBoard() {
  if (boards.some((b) => b.owner_id === user.id)) return;
  const board = { id: makeId(), name: "My Tasks", owner_id: user.id };
  const { error } = await supa.from("boards").insert(board);
  if (error) {
    console.error("Could not create personal board:", error.message);
    return;
  }
  const { error: memErr } = await supa.from("board_members").insert({ board_id: board.id, user_id: user.id });
  if (memErr) {
    // Without membership the board is invisible (RLS) — roll it back so we retry
    // cleanly next load instead of stranding it.
    console.error("Could not join personal board:", memErr.message);
    await supa.from("boards").delete().eq("id", board.id);
    return;
  }
  boards.push(board);
}

// Remove extra "My Tasks" boards left by the old duplicate-creation race — but
// only ones with zero tasks, so no data is ever lost.
async function cleanupDuplicatePersonalBoards() {
  const isDupe = (b) => b.owner_id === user.id && b.name === "My Tasks";
  if (boards.filter(isDupe).length <= 1) return;
  for (const b of boards.filter(isDupe)) {
    if (boards.filter(isDupe).length <= 1) break; // always keep one
    const { count, error } = await supa.from("tasks").select("id", { count: "exact", head: true }).eq("board_id", b.id);
    if (error || count) continue; // keep boards that have tasks (or if the count failed)
    await supa.from("boards").delete().eq("id", b.id);
    boards = boards.filter((x) => x.id !== b.id);
    if (currentBoardId === b.id) currentBoardId = null;
  }
  if (!currentBoardId || !boards.some((b) => b.id === currentBoardId)) {
    currentBoardId = (boards.find((b) => b.owner_id === user.id) || boards[0] || {}).id || null;
    if (currentBoardId) localStorage.setItem("currentBoardId", currentBoardId);
  }
}

async function maybeJoinFromLink() {
  const param = new URLSearchParams(window.location.search).get("board");
  if (!param) return null;
  history.replaceState({}, "", window.location.pathname); // tidy the URL
  const { error } = await supa.from("board_members").upsert({ board_id: param, user_id: user.id });
  if (error) {
    console.error("Could not join shared board:", error.message);
    alert("That share link looks invalid or expired.");
    return null;
  }
  return param;
}

async function setupBoards() {
  const ok = await loadBoards();
  if (!ok) {
    currentBoardId = null; // legacy single-board mode (pre-migration)
    return;
  }
  await ensurePersonalBoard();
  const joinId = await maybeJoinFromLink();
  if (joinId) {
    await loadBoards(); // now includes the joined board
    if (boards.some((b) => b.id === joinId)) {
      currentBoardId = joinId;
      localStorage.setItem("currentBoardId", joinId);
      return;
    }
  }
  const saved = localStorage.getItem("currentBoardId");
  currentBoardId =
    (saved && boards.some((b) => b.id === saved) && saved) ||
    (boards.find((b) => b.owner_id === user.id) || boards[0] || {}).id ||
    null;
}

async function switchBoard(id) {
  if (!id || id === currentBoardId) return;
  currentBoardId = id;
  localStorage.setItem("currentBoardId", id);
  loadTabsForBoard();
  await pullRemote(false);
  renderBoardControls();
  applyBoardTheme();
  render();
}

async function createBoard() {
  const name = (window.prompt("Name this project:", "New project") || "").trim();
  if (!name) return;
  const board = { id: makeId(), name, owner_id: user.id };
  const { error } = await supa.from("boards").insert(board);
  if (error) {
    console.error("Could not create board:", error.message);
    alert("Could not create the project — please try again.");
    return;
  }
  // The membership row is what makes the board visible (RLS). If it fails the
  // board would exist but be invisible on reload — roll it back instead.
  const { error: memErr } = await supa.from("board_members").insert({ board_id: board.id, user_id: user.id });
  if (memErr) {
    console.error("Could not join the new board:", memErr.message);
    await supa.from("boards").delete().eq("id", board.id);
    alert("Could not create the project — please try again.");
    return;
  }
  board.tabs = [defaultTab(defaultColumns())]; // new boards start with one category (stable key)
  boards.push(board);
  await switchBoard(board.id);
  persistTabs(); // save the initial single-category tab to this new board
}

async function shareBoard(btn) {
  const url = window.location.origin + window.location.pathname + "?board=" + currentBoardId;
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = "✓ Link copied";
    setTimeout(() => (btn.textContent = original), 1600);
  } catch (e) {
    window.prompt("Copy this share link:", url);
  }
}

async function pullRemote(maybeMigrate) {
  let query = supa.from("tasks").select("*");
  if (currentBoardId) query = query.eq("board_id", currentBoardId);
  const { data, error } = await query;
  if (error) {
    console.error("Could not load remote tasks:", error.message);
    return;
  }
  if (maybeMigrate && data.length === 0 && tasks.length > 0 && isPersonalBoard(currentBoardId)) {
    // First sign-in with existing local tasks → push them into the personal board.
    const { error: upErr } = await supa.from("tasks").upsert(tasks.map(rowFromTask));
    if (upErr) console.error("Migration upload failed:", upErr.message);
    saveLocal();
    return;
  }
  // Snapshot the current (last-known-good) tasks before replacing them, so an
  // unexpectedly-empty remote result can never silently erase a board.
  if (tasks.length) backupTasks(currentBoardId, tasks);
  if (data.length === 0 && tasks.length > 0) {
    console.warn(`Remote returned 0 tasks for board ${currentBoardId} but ${tasks.length} were local; backed up. Run restoreTasksBackup() to recover if this was unexpected.`);
  }
  tasks = data.map(taskFromRow);
  adoptOrphanTasks(); // re-home null/orphaned tab keys onto the first tab
  saveLocal();
}

// Manual recovery lever: re-add any tasks from the local backup that are missing
// from the current board, and push them back to the cloud.
window.restoreTasksBackup = function restoreTasksBackup() {
  try {
    const all = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "{}");
    const snap = all[currentBoardId || "__local__"];
    if (!snap || !Array.isArray(snap.tasks) || !snap.tasks.length) {
      console.warn("No task backup found for this board.");
      return 0;
    }
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const restored = [];
    snap.tasks.map(normalizeTask).forEach((t) => {
      if (!byId.has(t.id)) {
        byId.set(t.id, t);
        restored.push(t);
      }
    });
    tasks = [...byId.values()];
    saveLocal();
    if (restored.length && supa && user && currentBoardId) persist(restored);
    render();
    console.log(`Restored ${restored.length} task(s) from backup taken ${snap.at}.`);
    return restored.length;
  } catch (e) {
    console.error("Restore failed:", e);
    return 0;
  }
};

let realtimeChannel = null;
function subscribeRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supa
    .channel("tasks-sync")
    // No filter: RLS limits what we receive. We reload the active board on any
    // visible change, so a shared board updates live for everyone on it.
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
      if (Date.now() < suppressRealtimeUntil) return; // ignore our own echoes
      if (document.activeElement && document.activeElement.closest(".card")) {
        pendingReload = true; // don't yank the board while typing
        return;
      }
      pullRemote(false).then(render);
    })
    .subscribe();
}

// When the user finishes editing, apply any deferred remote changes.
document.addEventListener(
  "blur",
  () => {
    if (pendingReload && supa && user) {
      pendingReload = false;
      pullRemote(false).then(render);
    }
  },
  true
);

function renderAuthBar(message) {
  const bar = document.getElementById("auth-bar");
  bar.innerHTML = "";
  if (message) {
    const span = document.createElement("span");
    span.className = "auth-msg";
    span.textContent = message;
    bar.appendChild(span);
    return;
  }
  if (user) {
    bar.innerHTML = `<span class="synced-dot" title="Synced"></span>
      <span class="user-email">${user.email || "Signed in"}</span>`;
    const out = document.createElement("button");
    out.className = "ghost-btn";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
      await supa.auth.signOut();
      if (realtimeChannel) {
        supa.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    });
    bar.appendChild(out);
  } else {
    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "you@email.com";
    const btn = document.createElement("button");
    btn.className = "ghost-btn";
    btn.textContent = "Sign in to sync";
    btn.addEventListener("click", async () => {
      if (!email.value) return email.focus();
      btn.disabled = true;
      const { error } = await supa.auth.signInWithOtp({
        email: email.value,
        options: { emailRedirectTo: window.location.origin },
      });
      btn.disabled = false;
      renderAuthBar(error ? "Error: " + error.message : "Check your email for a sign-in link.");
    });
    email.addEventListener("keydown", (e) => e.key === "Enter" && btn.click());
    bar.appendChild(email);
    bar.appendChild(btn);
  }
}

function renderBoardControls() {
  const appTitle = document.getElementById("app-title");
  const wrap = document.getElementById("board-controls");
  if (!wrap || !appTitle) return;

  if (!user || !currentBoardId) {
    wrap.hidden = true;
    appTitle.hidden = false; // plain "Daily Task Board" when signed out
    return;
  }
  appTitle.hidden = true;
  wrap.hidden = false;
  wrap.innerHTML = "";

  const current = boards.find((b) => b.id === currentBoardId);
  const owned = !!(current && current.owner_id === user.id);
  const toggleBoardMenu = () => {
    const m = document.getElementById("board-menu");
    if (m) m.hidden = !m.hidden;
  };
  const onPhone = () => window.innerWidth <= 600;

  // Board name as the heading. Desktop owner: click to rename. On phones (or for
  // non-owners) the whole name is the switcher's tap target — rename moves into
  // the menu, since an inline rename field is awkward on touch.
  const nameBtn = document.createElement("button");
  nameBtn.className = "board-name" + (owned ? "" : " not-owner");
  nameBtn.textContent = current ? current.name : "Project";
  nameBtn.title = owned ? "Rename project (opens the project switcher on mobile)" : "Switch project";
  nameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (owned && !onPhone()) startRename(nameBtn, current);
    else toggleBoardMenu();
  });
  wrap.appendChild(nameBtn);

  // Down arrow — open the board switcher.
  const switchBtn = document.createElement("button");
  switchBtn.className = "board-switch";
  switchBtn.textContent = "▾";
  switchBtn.setAttribute("aria-label", "Switch project");
  switchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBoardMenu();
  });
  wrap.appendChild(switchBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "ghost-btn";
  shareBtn.textContent = "🔗 Share";
  shareBtn.title = "Copy a link that lets a teammate join this project";
  shareBtn.addEventListener("click", () => shareBoard(shareBtn));
  wrap.appendChild(shareBtn);

  // Switch dropdown: pick a board, hover for a delete/leave action, "+ New" at the bottom.
  const TRASH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  const EXIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  const menu = document.createElement("div");
  menu.className = "board-menu";
  menu.id = "board-menu";
  menu.hidden = true;
  boards
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((b) => {
      const item = document.createElement("div");
      item.className = "board-menu-item" + (b.id === currentBoardId ? " current" : "");

      const pick = document.createElement("button");
      pick.className = "board-menu-pick";
      pick.textContent = b.name + (b.owner_id === user.id ? "" : " (shared)");
      pick.addEventListener("click", () => {
        menu.hidden = true;
        switchBoard(b.id);
      });
      item.appendChild(pick);

      // Rename the current board from the menu (the mobile rename path; also handy
      // on desktop). Reuses the inline rename on the header name button.
      if (b.id === currentBoardId && b.owner_id === user.id) {
        const ren = document.createElement("button");
        ren.className = "board-menu-action rename";
        ren.title = "Rename project";
        ren.innerHTML = TAG_PENCIL;
        ren.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.hidden = true;
          startRename(nameBtn, current);
        });
        item.appendChild(ren);
      }

      // Last remaining board can't be removed.
      if (boards.length > 1) {
        const isOwner = b.owner_id === user.id;
        const action = document.createElement("button");
        action.className = "board-menu-action " + (isOwner ? "delete" : "leave");
        action.title = isOwner ? "Delete project" : "Leave project";
        action.innerHTML = isOwner ? TRASH : EXIT;
        action.addEventListener("click", (e) => {
          e.stopPropagation();
          menu.hidden = true;
          if (isOwner) deleteBoard(b);
          else leaveBoard(b);
        });
        item.appendChild(action);
      }
      menu.appendChild(item);
    });

  const divider = document.createElement("div");
  divider.className = "board-menu-divider";
  menu.appendChild(divider);

  const addRow = document.createElement("button");
  addRow.className = "board-menu-new";
  addRow.textContent = "+ New project";
  addRow.addEventListener("click", () => {
    menu.hidden = true;
    createBoard();
  });
  menu.appendChild(addRow);

  wrap.appendChild(menu);
}

async function deleteBoard(board) {
  const ok = await confirmModal({
    title: "Delete project?",
    message: `“${board.name}” and all its tasks will be permanently deleted for everyone on it.`,
    confirmLabel: "Delete project",
  });
  if (!ok) return;
  const { error } = await supa.from("boards").delete().eq("id", board.id);
  if (error) {
    console.error("Delete board failed:", error.message);
    return;
  }
  removeBoardLocally(board.id);
}

async function leaveBoard(board) {
  const ok = await confirmModal({
    title: "Leave project?",
    message: `You'll be removed from “${board.name}”. Its tasks stay for everyone else.`,
    confirmLabel: "Leave project",
  });
  if (!ok) return;
  const { error } = await supa.from("board_members").delete().eq("board_id", board.id).eq("user_id", user.id);
  if (error) {
    console.error("Leave board failed:", error.message);
    return;
  }
  removeBoardLocally(board.id);
}

function removeBoardLocally(id) {
  boards = boards.filter((b) => b.id !== id);
  if (currentBoardId !== id) {
    renderBoardControls();
    return;
  }
  const fallback = boards.find((b) => b.owner_id === user.id) || boards[0];
  currentBoardId = fallback ? fallback.id : null;
  localStorage.setItem("currentBoardId", currentBoardId || "");
  renderBoardControls();
  if (currentBoardId) {
    pullRemote(false).then(render);
  } else {
    tasks = [];
    render();
  }
}

// Inline-rename the current board. The board id never changes, so share links
// keep working and members see the new name on their next load.
function startRename(nameBtn, board) {
  const input = document.createElement("input");
  input.className = "board-name-input";
  input.value = board.name;
  nameBtn.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = async () => {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (newName && newName !== board.name) {
      const { error } = await supa.from("boards").update({ name: newName }).eq("id", board.id);
      if (error) console.error("Rename failed:", error.message);
      else board.name = newName;
    }
    renderBoardControls();
    render();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      input.value = board.name;
      input.blur();
    }
  });
}

// Close the board switcher when clicking outside it.
document.addEventListener("click", (e) => {
  const menu = document.getElementById("board-menu");
  if (menu && !menu.hidden && !e.target.closest("#board-menu")) menu.hidden = true;
});

// Click outside a tag menu closes it.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".tag-select")) {
    document.querySelectorAll(".tag-menu").forEach((m) => (m.hidden = true));
  }
});

// Click outside the expanded card to collapse it.
document.addEventListener("click", (e) => {
  if (!expandedCardId) return;
  const card = e.target.closest(".card");
  if (!card || card.dataset.id !== expandedCardId) collapseCard();
});

/* =====================================================================
 * Search + keyboard shortcuts
 * ===================================================================== */
function matchesSearch(task) {
  if (!searchQuery) return true;
  return (task.title + " " + (task.notes || "") + " " + (task.assignee || "")).toLowerCase().includes(searchQuery);
}

// Whether a task shows in the board right now: matches search AND (not completed,
// unless its task set is currently revealing completed items).
function isVisibleTask(task) {
  return matchesSearch(task) && (!task.completed || shownCompletedCols.has(task.status));
}

function visibleColumn(status) {
  return group(status).filter(isVisibleTask);
}

function moveSelection(dx, dy) {
  document.body.classList.add("kb-nav"); // reveal the selection ring
  const cols = categoryKeys().map(visibleColumn);
  let ci = -1;
  let ri = -1;
  cols.forEach((arr, c) => {
    const r = arr.findIndex((t) => t.id === selectedCardId);
    if (r !== -1) {
      ci = c;
      ri = r;
    }
  });
  if (ci === -1) {
    const first = cols.findIndex((a) => a.length);
    if (first !== -1) {
      selectedCardId = cols[first][0].id;
      render();
    }
    return;
  }
  if (dy) ri = Math.max(0, Math.min(cols[ci].length - 1, ri + dy));
  if (dx) {
    let nc = ci;
    do {
      nc += dx;
    } while (nc >= 0 && nc < cols.length && cols[nc].length === 0);
    if (nc >= 0 && nc < cols.length && cols[nc].length) {
      ci = nc;
      ri = Math.min(ri, cols[ci].length - 1);
    }
  }
  const target = cols[ci][ri];
  if (target) {
    selectedCardId = target.id;
    render();
    document.querySelector(`[data-id="${selectedCardId}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

document.getElementById("search").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  render();
});

// Using the mouse/touch hides the keyboard selection ring.
document.addEventListener("pointerdown", () => document.body.classList.remove("kb-nav"));

// iOS Safari ignores user-scalable=no for pinch gestures; blocking the
// non-standard gesture events keeps the page at its loaded zoom level.
// (Double-tap zoom is handled by touch-action: manipulation in CSS.)
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

// Stacked / side-by-side view toggle (a local view preference). Defaults to
// stacked when the user hasn't chosen yet.
let stackedView = (localStorage.getItem("stackedView") ?? "1") === "1";
function applyView() {
  board.classList.toggle("stacked", stackedView);
  document.body.classList.toggle("stacked-view", stackedView); // centre the tab bar to match
  const btn = document.getElementById("view-toggle");
  btn.textContent = stackedView ? "▥ Columns" : "▤ Stack";
  btn.title = stackedView ? "Switch to side-by-side columns" : "Switch to a stacked view";
}
document.getElementById("view-toggle").addEventListener("click", () => {
  stackedView = !stackedView;
  localStorage.setItem("stackedView", stackedView ? "1" : "0");
  applyView();
});
applyView();

/* ---------- Colour theme (per board, cycled with the palette button) ----------
 * Remembered per board locally (a personal view preference, like the active
 * tab) so each board reopens in the colour it was left on. */
const THEMES = [
  "default", "sand", "mint", "rose", "lavender", "slate", // light
  "sky", "sunny", "bubblegum", // bright
  "midnight", "carbon", // dark
  "neon", "synthwave", "matrix", // neon
  "beach", // scene
];
const THEME_LABELS = {
  default: "Default", sand: "Sand", mint: "Mint", rose: "Rose", lavender: "Lavender", slate: "Slate",
  sky: "Sky", sunny: "Sunny", bubblegum: "Bubblegum",
  midnight: "Midnight", carbon: "Carbon",
  neon: "Neon", synthwave: "Synthwave", matrix: "Matrix",
  beach: "Beach 🏖️",
};

function themeBoardKey() {
  return user && currentBoardId ? currentBoardId : "__local__";
}
function loadBoardThemes() {
  try {
    return JSON.parse(localStorage.getItem("boardThemes")) || {};
  } catch (e) {
    return {};
  }
}
function currentBoardTheme() {
  return loadBoardThemes()[themeBoardKey()] || "default";
}
function applyTheme(key) {
  const root = document.documentElement;
  if (!key || key === "default") delete root.dataset.theme;
  else root.dataset.theme = key;
  const btn = document.getElementById("theme-btn");
  if (btn) btn.title = `Theme: ${THEME_LABELS[key] || "Default"} — click to change`;
}
function applyBoardTheme() {
  applyTheme(currentBoardTheme());
}
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(currentBoardTheme()) + 1) % THEMES.length];
  const all = loadBoardThemes();
  if (next === "default") delete all[themeBoardKey()];
  else all[themeBoardKey()] = next;
  try {
    localStorage.setItem("boardThemes", JSON.stringify(all));
  } catch (e) {
    /* ignore */
  }
  applyTheme(next);
}
document.getElementById("theme-btn").addEventListener("click", cycleTheme);
applyBoardTheme();

document.addEventListener("keydown", (e) => {
  if (!modalOverlay.hidden) return; // the modal owns the keyboard while open
  const typing = !!(e.target.matches && e.target.matches("input, textarea, select"));

  if (e.key === "Escape") {
    if (expandedCardId) {
      collapseCard();
    } else if (searchQuery) {
      searchQuery = "";
      document.getElementById("search").value = "";
      render();
    } else if (typing) {
      e.target.blur();
    }
    return;
  }
  if (typing) return;

  if (e.key === "/") {
    e.preventDefault();
    document.getElementById("search").focus();
    return;
  }
  if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    addTask((categories[0] || {}).key || "todo");
    return;
  }
  if (expandedCardId) return; // arrows/enter are for the board, not an open card

  if (e.key === "ArrowUp") return e.preventDefault(), moveSelection(0, -1);
  if (e.key === "ArrowDown") return e.preventDefault(), moveSelection(0, 1);
  if (e.key === "ArrowLeft") return e.preventDefault(), moveSelection(-1, 0);
  if (e.key === "ArrowRight") return e.preventDefault(), moveSelection(1, 0);
  if (e.key === "Enter" && selectedCardId) {
    e.preventDefault();
    expandCard(selectedCardId);
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selectedCardId) {
    e.preventDefault();
    requestDeleteTask(selectedCardId);
    return;
  }
  if (e.key.toLowerCase() === "c" && selectedCardId) {
    e.preventDefault();
    toggleCompleted(selectedCardId);
  }
});

/* =====================================================================
 * Confirmation modal
 * ===================================================================== */
const modalOverlay = document.getElementById("modal-overlay");
const modalConfirmBtn = document.getElementById("modal-confirm");
const modalCancelBtn = document.getElementById("modal-cancel");
let modalResolve = null;

function confirmModal({ title = "Delete task?", message = "", confirmLabel = "Delete" }) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-message").textContent = message;
  modalConfirmBtn.textContent = confirmLabel;
  modalOverlay.hidden = false;
  modalCancelBtn.focus();
  return new Promise((resolve) => (modalResolve = resolve));
}

function closeModal(result) {
  if (modalOverlay.hidden) return;
  modalOverlay.hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(result);
}

modalConfirmBtn.addEventListener("click", () => closeModal(true));
modalCancelBtn.addEventListener("click", () => closeModal(false));
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal(false);
});
document.addEventListener("keydown", (e) => {
  if (!modalOverlay.hidden && e.key === "Escape") closeModal(false);
});

/* =====================================================================
 * Boot
 * ===================================================================== */
const hadV2 = localStorage.getItem(STORAGE_KEY) !== null;
tasks = loadLocal();
adoptOrphanTasks(); // pin any pre-tabs tasks to the first tab
if (!hadV2) {
  // First run on this version: persist (incl. any legacy migration) and drop the old key.
  saveLocal();
  localStorage.removeItem(LEGACY_KEY);
}
render();
initSync();
