# Todo app

Browser todo app, no build step, no dependencies. Open `index.html` or serve
the folder: `python3 -m http.server`.

- `index.html` markup, `app.js` IndexedDB layer and UI, `style.css` styles.
- Storage is IndexedDB (database `todo`, store `tasks`, version 4). Do not add a server.
- Task fields: `title`, `done`, `createdAt`, optional `due` (local datetime string), `tags` (lowercase array),
  `repeat` (`null` or `{ unit: day|week|month|year, every: N }`), `priority` (`none|low|medium|high`).
  Completing a repeating task adds the next occurrence, inheriting tags and priority.
- Bump `DB_VERSION` only when the store or indexes change; new fields need no migration.
