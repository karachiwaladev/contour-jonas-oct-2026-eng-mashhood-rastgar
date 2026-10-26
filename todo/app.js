// Todo app: IndexedDB storage, status and tag filters, due dates, inline editing.

// --- Client-side database -------------------------------------------------
const DB_NAME = 'todo';
const DB_VERSION = 2; // v1 created the store; v2 adds due/tags fields (no migration needed)
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

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// --- State and UI -----------------------------------------------------------
const state = { status: 'all', tag: null, editing: null };

const form      = document.getElementById('add-form');
const addTitle  = document.getElementById('add-title');
const addDue    = document.getElementById('add-due');
const addTags   = document.getElementById('add-tags');
const statusBar = document.getElementById('status-filter');
const tagBar    = document.getElementById('tag-filter');
const list      = document.getElementById('list');
const empty     = document.getElementById('empty');
const count     = document.getElementById('count');

function matches(task) {
  if (state.status === 'active' && task.done) return false;
  if (state.status === 'done' && !task.done) return false;
  if (state.tag && !(task.tags || []).includes(state.tag)) return false;
  return true;
}

async function render() {
  const tasks = await db.all();
  renderTagFilter(tasks);

  const visible = tasks.filter(matches);
  list.replaceChildren(...visible.map(t => state.editing === t.id ? renderEditor(t) : renderTask(t)));
  empty.hidden = visible.length > 0;

  const open = tasks.filter(t => !t.done).length;
  const filtered = state.status !== 'all' || state.tag;
  count.textContent = tasks.length
    ? `${open} of ${tasks.length} remaining${filtered ? `, showing ${visible.length}` : ''}`
    : '';
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
    render();
  });

  const title = el('label', { className: 'title', htmlFor: box.id, textContent: task.title });
  const meta = el('div', { className: 'meta' });
  if (task.due) {
    meta.append(el('span', { className: 'due', textContent: (isOverdue(task) ? 'Overdue · ' : 'Due ') + formatDue(task.due) }));
  }
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

  const save = el('button', { type: 'button', textContent: 'Save' });
  save.addEventListener('click', async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    await db.update({ ...task, title: t, due: due.value || null, tags: parseTags(tags.value) });
    state.editing = null;
    render();
  });

  const cancel = el('button', { type: 'button', className: 'ghost', textContent: 'Cancel' });
  cancel.addEventListener('click', () => { state.editing = null; render(); });

  const editor = el('div', { className: 'editor' },
    title,
    el('div', { className: 'row' },
      el('label', {}, 'Due ', due),
      el('label', { className: 'grow' }, 'Tags ', tags)),
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
  await db.add({ title, due: addDue.value || null, tags: parseTags(addTags.value) });
  form.reset();
  addTitle.focus();
  render();
});

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
