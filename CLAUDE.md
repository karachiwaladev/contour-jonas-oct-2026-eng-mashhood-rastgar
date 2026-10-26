# Software Factory

This repo is a **software factory**: tickets arrive as GitHub issues, an agent
loop picks them up, does the work, and reports back on the issue. We build and
improve the loop, not the features. Only what is pushed to `main` counts.

## Progressive disclosure

Keep this file short and abstract. It is an index, not a manual.

- This file stays **under 100 lines** at all times. Cut before you add.
- Details live next to the code they describe: a `CLAUDE.md` or `README.md`
  inside the project or skill folder. Reference them here with `@path`.
- Load detail only when working in that area. Do not inline it here.

## Layout

- Each project gets its own folder at the repo root: `<project-name>/`.
- Each project folder owns its `CLAUDE.md` with project-specific rules.
- Shared agent tooling lives in `.claude/` (skills, settings).
- Register every new project and skill in the index below in the same commit
  that creates it.

## Index

### Projects

| Folder | Purpose | Docs |
|--------|---------|------|
| `todo/` | Browser todo app on IndexedDB (create, complete, delete) | @todo/CLAUDE.md |

### Skills

| Skill | Use when | Docs |
|-------|----------|------|
| `factory-loop` | Processing GitHub issue tickets on a `/loop` interval | @.claude/skills/factory-loop/SKILL.md |

### Reference

| File | Purpose |
|------|---------|
| @README.md | Workshop brief: how tickets arrive, scoring, ground rules |

## Working rules

- Start the loop with `/loop 1m /factory-loop`.
- Claim a ticket with 👀 before working it. Close as completed with a comment.
- Commit messages reference tickets as `(#N)`, never `closes #N`.
- Push to `main` before closing any ticket that changed files.
