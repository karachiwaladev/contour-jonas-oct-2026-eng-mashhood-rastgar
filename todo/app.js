// Todo app: IndexedDB storage, status and tag filters, due dates, inline editing.

// --- Client-side database -------------------------------------------------
const DB_NAME = 'todo';
const DB_VERSION = 4; // v1 created the store; v2 added due/tags; v3 added repeat; v4 adds priority (no migration needed)
const STORE = 'tasks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

const db = {
  all:    ()     => tx('readonly',  s => s.index('createdAt').getAll()),
  add:    (task) => tx('readwrite', s => s.add({ ...task, done: false, createdAt: Date.now() })),
  update: (task) => tx('readwrite', s => s.put(task)),
  remove: (id)   => tx('readwrite', s => s.delete(id)),
};

// --- Helpers ----------------------------------------------------------------
function parseTags(text) {
  const seen = new Set();
  return (text || '').split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t && !seen.has(t) && seen.add(t));
}

function isOverdue(task) {
  return Boolean(task.due) && !task.done && new Date(task.due) < new Date();
}

function formatDue(due) {
  return new Date(due).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// --- Recurrence -------------------------------------------------------------
// repeat: null | { unit: 'day'|'week'|'month'|'year', every: N }
const UNIT_LABEL = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };

function repeatLabel(repeat) {
  if (!repeat) return '';
  if (repeat.unit === 'day' && repeat.every > 1) return `repeats every ${repeat.every} days`;
  return `repeats ${UNIT_LABEL[repeat.unit]}`;
}

const pad = n => String(n).padStart(2, '0');
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One step forward. Month and year steps keep the day of month, clamped to the month's last day.
function addInterval(date, repeat) {
  const d = new Date(date);
  if (repeat.unit === 'day')  { d.setDate(d.getDate() + repeat.every); return d; }
  if (repeat.unit === 'week') { d.setDate(d.getDate() + 7 * repeat.every); return d; }
  const months = repeat.unit === 'month' ? repeat.every : 12 * repeat.every;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes());
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

// First occurrence strictly after now, stepping from the scheduled due time.
function nextOccurrence(due, repeat) {
  const now = new Date();
  let d = new Date(due);
  do { d = addInterval(d, repeat); } while (d <= now);
  return toLocalInput(d);
}

// Read a repeat value from a <select> plus an "every N days" number input.
function readRepeat(select, every) {
  const v = select.value;
  if (v === 'none') return null;
  if (v === 'custom') return { unit: 'day', every: Math.min(365, Math.max(2, parseInt(every.value, 10) || 2)) };
  return { unit: v, every: 1 };
}

function repeatToSelect(repeat) {
  if (!repeat) return 'none';
  return repeat.unit === 'day' && repeat.every > 1 ? 'custom' : repeat.unit;
}

// --- Priority ----------------------------------------------------------------
// priority: 'none' | 'low' | 'medium' | 'high'  (missing reads as 'none')
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const priorityOf = task => PRIORITIES.includes(task.priority) ? task.priority : 'none';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// --- State and UI -----------------------------------------------------------
const state = { status: 'all', tag: null, priority: null, editing: null };

const form      = document.getElementById('add-form');
const addTitle  = document.getElementById('add-title');
const addDue    = document.getElementById('add-due');
const addTags   = document.getElementById('add-tags');
const addRepeat = document.getElementById('add-repeat');
const addEvery  = document.getElementById('add-every');
const addEveryLabel = document.getElementById('add-every-label');
const addPriority = document.getElementById('add-priority');
const priorityBar = document.getElementById('priority-filter');
const statusBar = document.getElementById('status-filter');
const tagBar    = document.getElementById('tag-filter');
const list      = document.getElementById('list');
const empty     = document.getElementById('empty');
const count     = document.getElementById('count');

function matches(task) {
  if (state.status === 'active' && task.done) return false;
  if (state.status === 'done' && !task.done) return false;
  if (state.tag && !(task.tags || []).includes(state.tag)) return false;
  if (state.priority && priorityOf(task) !== state.priority) return false;
  return true;
}

async function render() {
  const tasks = await db.all();
  renderPriorityFilter();
  renderTagFilter(tasks);

  const visible = tasks.filter(matches);
  list.replaceChildren(...visible.map(t => state.editing === t.id ? renderEditor(t) : renderTask(t)));
  empty.hidden = visible.length > 0;

  const open = tasks.filter(t => !t.done).length;
  const filtered = state.status !== 'all' || state.tag || state.priority;
  count.textContent = tasks.length
    ? `${open} of ${tasks.length} remaining${filtered ? `, showing ${visible.length}` : ''}`
    : '';
}

function renderPriorityFilter() {
  priorityBar.replaceChildren(...['high', 'medium', 'low', 'none'].map(p => el('button', {
    type: 'button',
    className: 'chip' + (state.priority === p ? ' active' : ''),
    textContent: p[0].toUpperCase() + p.slice(1),
    ariaPressed: String(state.priority === p),
    onclick: () => { state.priority = state.priority === p ? null : p; render(); },
  })));
}

function renderTagFilter(tasks) {
  const tags = [...new Set(tasks.flatMap(t => t.tags || []))].sort();
  if (state.tag && !tags.includes(state.tag)) state.tag = null;
  tagBar.hidden = tags.length === 0;
  tagBar.replaceChildren(...tags.map(tag => el('button', {
    type: 'button',
    className: 'chip' + (state.tag === tag ? ' active' : ''),
    textContent: tag,
    ariaPressed: String(state.tag === tag),
    onclick: () => { state.tag = state.tag === tag ? null : tag; render(); },
  })));
}

function renderTask(task) {
  const li = el('li');
  li.dataset.id = task.id;
  li.classList.toggle('done', task.done);
  li.classList.toggle('overdue', isOverdue(task));

  const box = el('input', { type: 'checkbox', id: `task-${task.id}`, checked: task.done });
  box.addEventListener('change', async () => {
    await db.update({ ...task, done: box.checked });
    if (box.checked && task.repeat && task.due) {
      await db.add({ title: task.title, tags: task.tags || [], repeat: task.repeat, priority: priorityOf(task), due: nextOccurrence(task.due, task.repeat) });
    }
    render();
  });

  const title = el('label', { className: 'title', htmlFor: box.id, textContent: task.title });
  const meta = el('div', { className: 'meta' });
  if (priorityOf(task) !== 'none') meta.append(el('span', { className: `prio ${priorityOf(task)}`, textContent: priorityOf(task) }));
  if (task.due) {
    meta.append(el('span', { className: 'due', textContent: (isOverdue(task) ? 'Overdue · ' : 'Due ') + formatDue(task.due) }));
  }
  if (task.repeat) meta.append(el('span', { className: 'repeat', textContent: repeatLabel(task.repeat) }));
  for (const tag of task.tags || []) meta.append(el('span', { className: 'chip', textContent: tag }));

  const edit = el('button', { type: 'button', className: 'ghost', textContent: 'Edit' });
  edit.setAttribute('aria-label', `Edit ${task.title}`);
  edit.addEventListener('click', () => { state.editing = task.id; render(); });

  const del = el('button', { type: 'button', className: 'ghost', textContent: 'Delete' });
  del.setAttribute('aria-label', `Delete ${task.title}`);
  del.addEventListener('click', async () => { await db.remove(task.id); render(); });

  li.append(box, el('div', { className: 'main' }, title, meta), el('div', { className: 'actions' }, edit, del));
  return li;
}

function renderEditor(task) {
  const li = el('li', { className: 'editing' });
  li.dataset.id = task.id;

  const title = el('input', { type: 'text', value: task.title, required: true, className: 'edit-title' });
  const due   = el('input', { type: 'datetime-local', value: task.due || '', className: 'edit-due' });
  const tags  = el('input', { type: 'text', value: (task.tags || []).join(', '), placeholder: 'work, home', className: 'edit-tags' });
  const repeat = el('select', { className: 'edit-repeat' },
    ...[['none', 'none'], ['day', 'daily'], ['week', 'weekly'], ['month', 'monthly'], ['year', 'yearly'], ['custom', 'every N days']]
      .map(([v, t]) => el('option', { value: v, textContent: t })));
  repeat.value = repeatToSelect(task.repeat);
  const every = el('input', { type: 'number', min: 2, max: 365, value: task.repeat?.every > 1 ? task.repeat.every : 2, className: 'edit-every' });
  const everyLabel = el('label', { hidden: repeat.value !== 'custom' }, 'N days ', every);
  const priority = el('select', { className: 'edit-priority' },
    ...PRIORITIES.map(v => el('option', { value: v, textContent: v })));
  priority.value = priorityOf(task);
  repeat.addEventListener('change', () => { everyLabel.hidden = repeat.value !== 'custom'; });

  const save = el('button', { type: 'button', textContent: 'Save' });
  save.addEventListener('click', async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const rep = readRepeat(repeat, every);
    if (rep && !due.value) { due.focus(); return; }
    await db.update({ ...task, title: t, due: due.value || null, tags: parseTags(tags.value), repeat: rep, priority: priority.value });
    state.editing = null;
    render();
  });

  const cancel = el('button', { type: 'button', className: 'ghost', textContent: 'Cancel' });
  cancel.addEventListener('click', () => { state.editing = null; render(); });

  const editor = el('div', { className: 'editor' },
    title,
    el('div', { className: 'row' },
      el('label', {}, 'Due ', due),
      el('label', { className: 'grow' }, 'Tags ', tags),
      el('label', {}, 'Repeat ', repeat),
      everyLabel,
      el('label', {}, 'Priority ', priority)),
    el('div', { className: 'buttons' }, save, cancel));

  li.append(editor);
  title.focus();
  return li;
}

// --- Events -----------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = addTitle.value.trim();
  if (!title) return;
  const repeat = readRepeat(addRepeat, addEvery);
  if (repeat && !addDue.value) { addDue.focus(); return; }
  await db.add({ title, due: addDue.value || null, tags: parseTags(addTags.value), repeat, priority: addPriority.value });
  form.reset();
  addEveryLabel.hidden = true;
  addTitle.focus();
  render();
});

addRepeat.addEventListener('change', () => { addEveryLabel.hidden = addRepeat.value !== 'custom'; });

statusBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-status]');
  if (!btn) return;
  state.status = btn.dataset.status;
  for (const b of statusBar.querySelectorAll('button')) {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  render();
});

render();
