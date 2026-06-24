/* Daily Task Board
 * - Flat task model persisted to localStorage (offline / no login).
 * - Optional Supabase sync across devices when configured + signed in.
 */

const STORAGE_KEY = "taskManager.v2";
const LEGACY_KEY = "taskManager.v1";

const COLUMNS = [
  { key: "todo", label: "Do" },
  { key: "inProgress", label: "Doing" },
  { key: "done", label: "Done" },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);

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
let selectedDate = todayKey();
const expandedIds = new Set(); // cards expanded via the menu button (view state, not persisted)

let supa = null; // Supabase client (when configured)
let user = null; // signed-in user (when authed)
let boards = []; // boards the signed-in user belongs to
let currentBoardId = null; // active board (null = single-board / legacy mode)
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
function formatLong(key) {
  const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  let label = keyToDate(key).toLocaleDateString(undefined, opts);
  if (key === todayKey()) label = "Today · " + label;
  return label;
}
function formatShort(key) {
  return keyToDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function shiftDay(key, delta) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + delta);
  return toKey(date);
}

/* =====================================================================
 * Local persistence + migration
 * ===================================================================== */
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tasks)) return parsed.tasks;
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
      for (const status of COLUMN_KEYS) {
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
  return {
    id: t.id || makeId(),
    day: t.day || todayKey(),
    status: COLUMN_KEYS.includes(t.status) ? t.status : "todo",
    position: typeof t.position === "number" ? t.position : 0,
    title: t.title || "",
    notes: t.notes || "",
    due: t.due || null,
    priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : null,
    label: t.label || null,
    updated_at: t.updated_at || nowIso(),
  };
}

function getTask(id) {
  return tasks.find((t) => t.id === id) || null;
}

// Ordered tasks for a given day + column.
function group(day, status) {
  return tasks
    .filter((t) => t.day === day && t.status === status)
    .sort((a, b) => a.position - b.position);
}

function isOverdue(task) {
  return task.due && task.due < todayKey() && task.status !== "done";
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

function reindex(day, status) {
  const g = group(day, status);
  g.forEach((t, i) => {
    t.position = i;
    t.updated_at = nowIso();
  });
  return g;
}

function addTask(status) {
  const task = normalizeTask({ day: selectedDate, status, position: group(selectedDate, status).length });
  tasks.push(task);
  persist([task]);
  render();
  const el = document.querySelector(`[data-id="${task.id}"] .card-title`);
  if (el) el.focus();
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
  const { day, status } = tasks[idx];
  tasks.splice(idx, 1);
  const changed = reindex(day, status);
  saveLocal();
  remoteDelete(id);
  if (changed.length) persist(changed);
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
  const target = group(selectedDate, toStatus).filter((t) => t.id !== id);
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
  if (fromStatus !== toStatus) reindex(selectedDate, fromStatus).forEach((t) => changed.set(t.id, t));
  saveLocal();
  persist([...changed.values()]);
  render();
}

function moveByButton(id, dir) {
  const task = getTask(id);
  if (!task) return;
  const idx = COLUMN_KEYS.indexOf(task.status);
  const next = COLUMN_KEYS[idx + dir];
  if (next) moveTaskTo(id, next);
}

function carryOver() {
  const today = todayKey();
  const pending = tasks.filter((t) => t.day < today && (t.status === "todo" || t.status === "inProgress"));
  if (!pending.length) return;
  if (!confirm(`Carry over ${pending.length} unfinished task${pending.length === 1 ? "" : "s"} to today?`)) return;

  pending.forEach((t) => {
    t.day = today;
    t.updated_at = nowIso();
  });
  // Re-pack positions for today's affected columns.
  const changed = new Map(pending.map((t) => [t.id, t]));
  ["todo", "inProgress"].forEach((s) => reindex(today, s).forEach((t) => changed.set(t.id, t)));
  selectedDate = today;
  saveLocal();
  persist([...changed.values()]);
  render();
}

/* =====================================================================
 * Rendering
 * ===================================================================== */
const board = document.getElementById("board");
const cardTemplate = document.getElementById("card-template");

function render() {
  document.getElementById("long-date").textContent = formatLong(selectedDate);
  document.getElementById("date-picker").value = selectedDate;
  renderCarryOver();

  board.innerHTML = "";
  COLUMNS.forEach((col, colIndex) => {
    const items = group(selectedDate, col.key);

    const column = document.createElement("section");
    column.className = "column";
    column.dataset.col = col.key;
    column.innerHTML = `
      <div class="column-header">
        <span class="dot"></span>
        <h2>${col.label}</h2>
        <span class="count">${items.length}</span>
      </div>
      <div class="card-list"></div>
      <div class="add-row"><button class="add-btn">+ Add task</button></div>
    `;

    const list = column.querySelector(".card-list");
    if (items.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No tasks";
      list.appendChild(hint);
    } else {
      items.forEach((task) => list.appendChild(renderCard(task, colIndex)));
    }

    column.querySelector(".add-btn").addEventListener("click", () => addTask(col.key));
    board.appendChild(column);
  });

  // Size descriptions of already-expanded cards now that they're in the DOM.
  board.querySelectorAll(".card.expanded .card-notes").forEach(autoGrow);
}

function renderCarryOver() {
  const btn = document.getElementById("carry-over");
  const today = todayKey();
  const count = tasks.filter((t) => t.day < today && (t.status === "todo" || t.status === "inProgress")).length;
  if (selectedDate === today && count > 0) {
    btn.hidden = false;
    btn.textContent = `↪ Carry over ${count} unfinished task${count === 1 ? "" : "s"}`;
  } else {
    btn.hidden = true;
  }
}

function setMenuState(btn, expanded) {
  btn.textContent = expanded ? "▴" : "▾";
  btn.setAttribute("aria-expanded", String(expanded));
  const label = expanded ? "Collapse" : "Expand";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function renderCard(task, colIndex) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  if (expandedIds.has(task.id)) node.classList.add("expanded");

  // Label colour as the left border.
  const labelDef = LABELS.find((l) => l.key === task.label);
  node.style.borderLeftColor = labelDef ? labelDef.color : "var(--border)";

  // Priority dot.
  const dot = node.querySelector(".priority-dot");
  if (task.priority) {
    dot.hidden = false;
    dot.classList.add(task.priority);
    dot.title = task.priority[0].toUpperCase() + task.priority.slice(1) + " priority";
  }

  // Title + notes.
  const title = node.querySelector(".card-title");
  const notes = node.querySelector(".card-notes");
  title.value = task.title;
  notes.value = task.notes;
  autoGrow(notes);
  // Persist text on change (not every keystroke) to limit sync churn.
  title.addEventListener("input", () => saveLocal());
  title.addEventListener("change", () => updateTask(task.id, { title: title.value }));
  notes.addEventListener("input", () => {
    autoGrow(notes);
    saveLocal();
  });
  notes.addEventListener("change", () => updateTask(task.id, { notes: notes.value }));

  // Due badge — the meta row only appears once a due date is set.
  const badge = node.querySelector(".due-badge");
  node.querySelector(".card-meta").hidden = !task.due;
  if (task.due) {
    badge.hidden = false;
    badge.textContent = "📅 " + formatShort(task.due);
    if (isOverdue(task)) badge.classList.add("overdue");
  }

  // Controls.
  const prio = node.querySelector(".priority-select");
  prio.value = task.priority || "";
  prio.addEventListener("change", () => updateAndRender(task.id, { priority: prio.value || null }));

  const dueInput = node.querySelector(".due-input");
  dueInput.value = task.due || "";
  dueInput.addEventListener("change", () => updateAndRender(task.id, { due: dueInput.value || null }));

  renderSwatches(node.querySelector(".label-swatches"), task);

  const left = node.querySelector(".move-left");
  const right = node.querySelector(".move-right");
  left.disabled = colIndex === 0;
  right.disabled = colIndex === COLUMNS.length - 1;
  left.addEventListener("click", () => moveByButton(task.id, -1));
  right.addEventListener("click", () => moveByButton(task.id, 1));

  node.querySelector(".delete-btn").addEventListener("click", async () => {
    const name = task.title.trim();
    const ok = await confirmModal({
      message: name ? `“${name}” will be permanently deleted.` : "This task will be permanently deleted.",
      confirmLabel: "Delete",
    });
    if (ok) deleteTask(task.id);
  });

  // Up/down arrow toggles the card open/closed (description + options).
  const menuBtn = node.querySelector(".menu-btn");
  setMenuState(menuBtn, expandedIds.has(task.id));
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const expanded = node.classList.toggle("expanded");
    if (expanded) {
      expandedIds.add(task.id);
      autoGrow(notes);
    } else {
      expandedIds.delete(task.id);
    }
    setMenuState(menuBtn, expanded);
  });

  // Press-and-move anywhere on the card (incl. text fields) starts a drag.
  node.addEventListener("pointerdown", (e) => onCardPointerDown(e, node, task.id));

  return node;
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
  none.title = "No label";
  none.addEventListener("click", () => updateAndRender(task.id, { label: null }));
  container.appendChild(none);
}

// Update a metadata field and re-render so indicators refresh.
function updateAndRender(id, fields) {
  updateTask(id, fields);
  render();
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

/* =====================================================================
 * Drag & drop — custom pointer-based.
 * Holding the mouse button and moving drags the whole card (from anywhere on
 * it, including text fields); a plain click still edits. Touch/pen keep the
 * ← → buttons so list scrolling isn't hijacked.
 * ===================================================================== */
let drag = null;
let justDragged = false;
const DRAG_THRESHOLD = 5; // px before a hold becomes a drag

function onCardPointerDown(e, node, id) {
  if (e.button !== 0 || e.pointerType !== "mouse") return;
  justDragged = false;
  const rect = node.getBoundingClientRect();
  drag = {
    id,
    node,
    active: false,
    startX: e.clientX,
    startY: e.clientY,
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    startLift();
  }
  e.preventDefault();
  drag.clone.style.left = e.clientX - drag.grabX + "px";
  drag.clone.style.top = e.clientY - drag.grabY + "px";
  updatePlaceholder(e.clientX, e.clientY);
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
  window.removeEventListener("pointermove", onDragMove);
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.active) return; // a click, not a drag

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
  const firstSignIn = !user && !!nextUser;
  user = nextUser;
  if (user) {
    await setupBoards(); // load boards, honor a share link, pick the active board
    await pullRemote(firstSignIn); // migrate local tasks into the personal board on first sign-in
    subscribeRealtime();
  } else {
    boards = [];
    currentBoardId = null;
  }
  renderAuthBar();
  renderBoardBar();
  render();
}

/* ---------- Boards ---------- */
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
  await supa.from("board_members").insert({ board_id: board.id, user_id: user.id });
  boards.push(board);
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
  await pullRemote(false);
  renderBoardBar();
  render();
}

async function createBoard() {
  const name = (window.prompt("Name this board:", "New board") || "").trim();
  if (!name) return;
  const board = { id: makeId(), name, owner_id: user.id };
  const { error } = await supa.from("boards").insert(board);
  if (error) {
    console.error("Could not create board:", error.message);
    return;
  }
  await supa.from("board_members").insert({ board_id: board.id, user_id: user.id });
  boards.push(board);
  await switchBoard(board.id);
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
  tasks = data.map(taskFromRow);
  saveLocal();
}

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

function renderBoardBar() {
  const bar = document.getElementById("board-bar");
  if (!bar) return;
  if (!user || !currentBoardId) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = "";

  const picker = document.createElement("select");
  picker.className = "board-picker";
  picker.setAttribute("aria-label", "Board");
  boards
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name + (b.owner_id === user.id ? "" : " (shared)");
      if (b.id === currentBoardId) opt.selected = true;
      picker.appendChild(opt);
    });
  picker.addEventListener("change", () => switchBoard(picker.value));
  bar.appendChild(picker);

  const newBtn = document.createElement("button");
  newBtn.className = "ghost-btn";
  newBtn.textContent = "+ New board";
  newBtn.addEventListener("click", createBoard);
  bar.appendChild(newBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "ghost-btn";
  shareBtn.textContent = "🔗 Share";
  shareBtn.title = "Copy a link that lets a teammate join this board";
  shareBtn.addEventListener("click", () => shareBoard(shareBtn));
  bar.appendChild(shareBtn);
}

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
 * Date navigation
 * ===================================================================== */
document.getElementById("prev-day").addEventListener("click", () => {
  selectedDate = shiftDay(selectedDate, -1);
  render();
});
document.getElementById("next-day").addEventListener("click", () => {
  selectedDate = shiftDay(selectedDate, 1);
  render();
});
document.getElementById("today-btn").addEventListener("click", () => {
  selectedDate = todayKey();
  render();
});
document.getElementById("date-picker").addEventListener("change", (e) => {
  if (e.target.value) {
    selectedDate = e.target.value;
    render();
  }
});
document.getElementById("carry-over").addEventListener("click", carryOver);

/* =====================================================================
 * Boot
 * ===================================================================== */
const hadV2 = localStorage.getItem(STORAGE_KEY) !== null;
tasks = loadLocal();
if (!hadV2) {
  // First run on this version: persist (incl. any legacy migration) and drop the old key.
  saveLocal();
  localStorage.removeItem(LEGACY_KEY);
}
render();
initSync();
