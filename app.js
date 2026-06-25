/* Daily Task Board
 * - Flat task model persisted to localStorage (offline / no login).
 * - Optional Supabase sync across devices when configured + signed in.
 */

const STORAGE_KEY = "taskManager.v2";
const LEGACY_KEY = "taskManager.v1";

const COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "inProgress", label: "In Progress" },
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
let expandedCardId = null; // the card expanded in place (view state, not persisted)
let selectedCardId = null; // keyboard-selected card (for shortcuts)
let searchQuery = ""; // lowercased search filter

let supa = null; // Supabase client (when configured)
let user = null; // signed-in user (when authed)
let boards = []; // boards the signed-in user belongs to
let currentBoardId = null; // active board (null = single-board / legacy mode)
let checklistSyncable = false; // whether the tasks.checklist column exists yet
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
    checklist: Array.isArray(t.checklist) ? t.checklist : [],
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
  expandedCardId = task.id; // open the new card so its title is editable
  selectedCardId = task.id;
  persist([task]);
  render();
  // A brand-new task opens ready to name — make the title editable + focused.
  const el = document.querySelector(`[data-id="${task.id}"] .card-title`);
  if (el) {
    el.removeAttribute("readonly");
    el.focus();
  }
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
  if (expandedCardId === id) expandedCardId = null;
  const changed = reindex(day, status);
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

// Check circle: advance to the next column; Done loops back to In Progress.
function advanceTask(id) {
  const task = getTask(id);
  if (!task) return;
  const order = ["todo", "inProgress", "done"];
  const next = task.status === "done" ? "inProgress" : order[order.indexOf(task.status) + 1];
  if (next && next !== task.status) {
    flipNextRender = true;
    moveTaskTo(id, next);
  }
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
  flipNextRender = true;
  render();
}

/* =====================================================================
 * Rendering
 * ===================================================================== */
const board = document.getElementById("board");
const cardTemplate = document.getElementById("card-template");

function render() {
  const beforeFlip = flipNextRender ? snapshotCards() : null;
  const boardTitle = currentBoardName();
  document.getElementById("app-title").textContent = boardTitle;
  document.title = boardTitle === "Daily Task Board" ? boardTitle : `${boardTitle} · Daily Task Board`;
  document.getElementById("date-display").textContent = formatLong(selectedDate);
  document.getElementById("date-picker").value = selectedDate;
  renderCarryOver();

  board.innerHTML = "";
  COLUMNS.forEach((col) => {
    const items = group(selectedDate, col.key).filter(matchesSearch);

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
      items.forEach((task) => list.appendChild(renderCard(task)));
    }

    column.querySelector(".add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      addTask(col.key);
    });
    board.appendChild(column);
  });

  // Size descriptions of already-expanded cards now that they're in the DOM.
  board.querySelectorAll(".card.expanded .card-notes").forEach(autoGrow);

  if (beforeFlip) flipCards(beforeFlip);
  flipNextRender = false;
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

function renderCard(task) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  const expanded = expandedCardId === task.id;
  if (expanded) node.classList.add("expanded");
  if (task.id === selectedCardId) node.classList.add("selected");
  if (task.status === "done") node.classList.add("done-card");

  // Left edge = the colour you pick.
  const colorDef = LABELS.find((l) => l.key === task.label);
  node.style.borderLeftColor = colorDef ? colorDef.color : "var(--border)";

  // Check circle — advances to the next column (Done → back to In Progress).
  const check = node.querySelector(".check");
  if (task.status === "done") {
    check.classList.add("on");
    check.textContent = "✓";
  }
  check.title = task.status === "done" ? "Move back to In Progress" : "Move to next column";
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    advanceTask(task.id);
  });

  // Title stays read-only by default. Clicking a collapsed card just expands it
  // (the title is NOT focused). Clicking the name on an already-open card begins
  // editing it.
  const title = node.querySelector(".card-title");
  const notes = node.querySelector(".card-notes");
  title.value = task.title;
  title.addEventListener("mousedown", (e) => {
    if (!title.hasAttribute("readonly")) return; // already editing
    if (expandedCardId === task.id) title.removeAttribute("readonly"); // open → start editing here
    else e.preventDefault(); // collapsed → expand only, don't focus the name
  });
  title.addEventListener("blur", () => title.setAttribute("readonly", ""));
  title.addEventListener("input", () => saveLocal());
  title.addEventListener("change", () => updateTask(task.id, { title: title.value }));

  // Meta: due / priority / checklist progress.
  const checklist = Array.isArray(task.checklist) ? task.checklist : [];
  const badge = node.querySelector(".due-badge");
  if (task.due) {
    badge.hidden = false;
    badge.textContent = "📅 " + formatShort(task.due);
    if (isOverdue(task)) badge.classList.add("overdue");
  }
  const pill = node.querySelector(".priority-pill");
  if (task.priority) {
    pill.hidden = false;
    pill.textContent = task.priority[0].toUpperCase() + task.priority.slice(1);
    pill.classList.add(task.priority);
  }
  const chip = node.querySelector(".progress-chip");
  if (checklist.length) {
    const done = checklist.filter((i) => i.done).length;
    const pct = Math.round((done / checklist.length) * 100);
    chip.hidden = false;
    if (done === checklist.length) chip.classList.add("complete");
    chip.innerHTML = `<span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span><span class="progress-count">${done}/${checklist.length}</span>`;
  }
  node.querySelector(".card-meta").hidden = !task.due && !task.priority && checklist.length === 0;

  // Description.
  notes.value = task.notes;
  notes.addEventListener("input", () => {
    autoGrow(notes);
    saveLocal();
  });
  notes.addEventListener("change", () => updateTask(task.id, { notes: notes.value }));

  // Checklist.
  renderChecklist(node, task, checklist);

  // Menu fields: priority, due date, colour (at the bottom).
  const prio = node.querySelector(".priority-select");
  prio.value = task.priority || "";
  prio.addEventListener("change", () => updateAndRender(task.id, { priority: prio.value || null }));
  const dueInput = node.querySelector(".due-input");
  dueInput.value = task.due || "";
  dueInput.addEventListener("change", () => updateAndRender(task.id, { due: dueInput.value || null }));
  renderSwatches(node.querySelector(".label-swatches"), task);

  // Delete.
  node.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    requestDeleteTask(task.id);
  });

  // Click the card to expand it in place (a plain click, not a drag).
  node.addEventListener("click", (e) => {
    if (justDragged) return;
    if (e.target.closest(".check, .delete-btn")) return;
    if (expandedCardId === task.id) return; // already open — inner clicks edit
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
  if (open) {
    autoGrow(node.querySelector(".card-notes"));
  } else {
    node.querySelector(".card-title").setAttribute("readonly", ""); // reset edit state
  }
}

function expandCard(id) {
  if (expandedCardId && expandedCardId !== id) {
    setCardExpanded(board.querySelector(`.card[data-id="${expandedCardId}"]`), false);
  }
  const node = board.querySelector(`.card[data-id="${id}"]`);
  if (!node) return;
  expandedCardId = id;
  selectedCardId = id;
  setCardExpanded(node, true);
}

function collapseCard() {
  if (!expandedCardId) return;
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

/* ---------- Checklist (sub-steps) ---------- */
function renderChecklist(node, task, checklist) {
  const list = node.querySelector(".checklist-items");
  checklist.forEach((item) => {
    const li = document.createElement("li");
    li.className = "checklist-item" + (item.done ? " done" : "");
    li.dataset.itemId = item.id;

    const handle = document.createElement("span");
    handle.className = "checklist-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.addEventListener("pointerdown", (e) => onChecklistHandleDown(e, task.id, li));

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.done;
    cb.addEventListener("change", () => toggleChecklistItem(task.id, item.id));

    const text = document.createElement("input");
    text.type = "text";
    text.className = "checklist-text";
    text.value = item.text;
    text.addEventListener("change", () => updateChecklistText(task.id, item.id, text.value));

    const del = document.createElement("button");
    del.className = "checklist-del";
    del.textContent = "×";
    del.title = "Remove step";
    del.addEventListener("click", () => deleteChecklistItem(task.id, item.id));

    li.append(handle, cb, text, del);
    list.appendChild(li);
  });

  const addInput = node.querySelector(".checklist-input");
  addInput.addEventListener("keydown", (e) => {
    const value = addInput.value.trim();
    if (e.key === "Enter" && value) addChecklistItem(task.id, value);
  });
}

function checklistOf(task) {
  if (!Array.isArray(task.checklist)) task.checklist = [];
  return task.checklist;
}

function addChecklistItem(taskId, text) {
  const task = getTask(taskId);
  if (!task) return;
  checklistOf(task).push({ id: makeId(), text, done: false });
  updateTask(taskId, { checklist: task.checklist });
  render();
  const el = document.querySelector(`[data-id="${taskId}"] .checklist-input`);
  if (el) el.focus();
}

function toggleChecklistItem(taskId, itemId) {
  const task = getTask(taskId);
  if (!task) return;
  const item = checklistOf(task).find((i) => i.id === itemId);
  if (!item) return;
  item.done = !item.done;
  updateTask(taskId, { checklist: task.checklist });
  render();
}

function updateChecklistText(taskId, itemId, text) {
  const task = getTask(taskId);
  if (!task) return;
  const item = checklistOf(task).find((i) => i.id === itemId);
  if (!item) return;
  item.text = text;
  updateTask(taskId, { checklist: task.checklist });
}

function deleteChecklistItem(taskId, itemId) {
  const task = getTask(taskId);
  if (!task) return;
  task.checklist = checklistOf(task).filter((i) => i.id !== itemId);
  updateTask(taskId, { checklist: task.checklist });
  render();
}

/* ---------- Checklist reorder (drag handle, pointer-based) ---------- */
let listDrag = null;

function onChecklistHandleDown(e, taskId, li) {
  if (e.button !== 0 || e.pointerType !== "mouse") return;
  e.stopPropagation(); // keep the card itself from starting a drag
  e.preventDefault();
  listDrag = { taskId, li, ul: li.parentElement };
  li.classList.add("reordering");
  window.addEventListener("pointermove", onChecklistMove);
  window.addEventListener("pointerup", onChecklistUp, { once: true });
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
  window.removeEventListener("pointermove", onChecklistMove);
  if (!listDrag) return;
  const { taskId, ul, li } = listDrag;
  li.classList.remove("reordering");
  const order = [...ul.querySelectorAll(".checklist-item")].map((el) => el.dataset.itemId);
  const task = getTask(taskId);
  if (task && Array.isArray(task.checklist)) {
    task.checklist.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    updateTask(taskId, { checklist: task.checklist });
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
 * Drag & drop — custom pointer-based.
 * Holding the mouse button and moving drags the whole card (from anywhere on
 * it, including text fields); a plain click still edits. Mouse only, so touch/pen
 * list scrolling isn't hijacked.
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
  if (checklistSyncable) row.checklist = t.checklist || [];
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
    const probe = await supa.from("tasks").select("checklist").limit(1);
    checklistSyncable = !probe.error; // false until supabase-checklist.sql is run
    await pullRemote(firstSignIn); // migrate local tasks into the personal board on first sign-in
    subscribeRealtime();
  } else {
    boards = [];
    currentBoardId = null;
  }
  renderAuthBar();
  renderBoardControls();
  render();
}

/* ---------- Boards ---------- */
function currentBoardName() {
  if (user && currentBoardId) {
    const b = boards.find((x) => x.id === currentBoardId);
    if (b) return b.name;
  }
  return "Daily Task Board";
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
  renderBoardControls();
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

  // Board name as the heading — click to rename (owner only).
  const nameBtn = document.createElement("button");
  nameBtn.className = "board-name" + (owned ? "" : " not-owner");
  nameBtn.textContent = current ? current.name : "Board";
  if (owned) {
    nameBtn.title = "Click to rename";
    nameBtn.addEventListener("click", () => startRename(nameBtn, current));
  } else {
    nameBtn.disabled = true;
  }
  wrap.appendChild(nameBtn);

  // Down arrow — open the board switcher.
  const switchBtn = document.createElement("button");
  switchBtn.className = "board-switch";
  switchBtn.textContent = "▾";
  switchBtn.setAttribute("aria-label", "Switch board");
  switchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = document.getElementById("board-menu");
    if (menu) menu.hidden = !menu.hidden;
  });
  wrap.appendChild(switchBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "ghost-btn";
  shareBtn.textContent = "🔗 Share";
  shareBtn.title = "Copy a link that lets a teammate join this board";
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

      // Last remaining board can't be removed.
      if (boards.length > 1) {
        const isOwner = b.owner_id === user.id;
        const action = document.createElement("button");
        action.className = "board-menu-action " + (isOwner ? "delete" : "leave");
        action.title = isOwner ? "Delete board" : "Leave board";
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
  addRow.textContent = "+ New board";
  addRow.addEventListener("click", () => {
    menu.hidden = true;
    createBoard();
  });
  menu.appendChild(addRow);

  wrap.appendChild(menu);
}

async function deleteBoard(board) {
  const ok = await confirmModal({
    title: "Delete board?",
    message: `“${board.name}” and all its tasks will be permanently deleted for everyone on it.`,
    confirmLabel: "Delete board",
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
    title: "Leave board?",
    message: `You'll be removed from “${board.name}”. Its tasks stay for everyone else.`,
    confirmLabel: "Leave board",
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
  return (task.title + " " + (task.notes || "")).toLowerCase().includes(searchQuery);
}

function visibleColumn(status) {
  return group(selectedDate, status).filter(matchesSearch);
}

function moveSelection(dx, dy) {
  document.body.classList.add("kb-nav"); // reveal the selection ring
  const cols = COLUMN_KEYS.map(visibleColumn);
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
    addTask("todo");
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
    advanceTask(selectedCardId);
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
// Click the date text to open the native date picker.
document.getElementById("date-display").addEventListener("click", () => {
  const picker = document.getElementById("date-picker");
  try {
    picker.showPicker();
  } catch (e) {
    picker.focus();
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
