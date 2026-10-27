---
name: persona-test
description: Use when a change to a web project must be tested by simulated users before review, when the factory-loop build flow reaches its persona-test step, or when asked to run persona agents, a user swarm, or shoal-style testing against a local app.
---

# Persona Test

Five personas from `<project>/personas.yaml` use the app and the result is a friction map: issues ranked by how many personas hit them. Two modes:

| Mode | How | Time | Use for |
|---|---|---|---|
| **fast** (default) | `runner/persona-run.mjs`: Jev picks each move in the persona's style, code detects the bugs (after [quicke2e](https://github.com/dmoka/quicke2e)) | seconds | every build tick |
| **deep** | 5 Claude subagents drive Chrome and narrate (section "Deep run") | minutes | when asked, or when fast finds nothing on a large UI change |

## Fast run

1. Serve the project once: `(cd <project> && python3 -m http.server 8771 --bind 127.0.0.1 >/dev/null 2>&1 &)` (check the port is free first; never kill another project's process). Each persona gets its own browser context, so storage is isolated on one port.
2. Run: `node .claude/skills/persona-test/runner/persona-run.mjs --personas <project>/personas.yaml --url http://127.0.0.1:8771/index.html --steps 20 --out docs/persona-runs/<ticket-or-date>`
   First time only: `(cd .claude/skills/persona-test/runner && npm install)`. `JEV_API_KEY` comes from the environment or the gitignored repo-root `.env`; never print it or commit it.
3. Regression replay (no model, deterministic): `--engine script --script runner/scenarios-todo.json`. Add a scenario whenever a confirmed bug is fixed.
4. The runner writes `report.md`, `results.json` and screenshots. Findings come from code oracles, so they are evidence, not opinions:
   console/page errors, injected payload executing or rendering as markup, horizontal overflow, `Invalid Date`/`NaN`/`undefined` rendered, focus lost (keyboard personas), one action adding several rows, stored IndexedDB records changing across a reload.
5. Stop the server you started.

Persona fields the fast runner uses: `goal`, `inputs.text|dates|numbers` (Jev never writes text; every typed value comes from here), `behaviour.mistap|double_click|keyboard_only`, `patience_steps`.

## Deep run

1. **Serve five isolated copies.** Each origin gets its own IndexedDB, so agents cannot corrupt each other's data:
   `for p in 8771 8772 8773 8774 8775; do lsof -iTCP:$p -sTCP:LISTEN -n -P >/dev/null || (cd <project> && python3 -m http.server $p --bind 127.0.0.1 >/dev/null 2>&1 &); done`
   If a port is taken by something else, stop and report it; never kill it.
2. **Dispatch five agents in one message**, one per persona, `subagent_type: general-purpose`, `model: sonnet`, `run_in_background` default. Prompt = `agent-brief.md` with `{{...}}` filled from the persona, `url` = `http://127.0.0.1:877N/index.html` (N = 1..5 in persona order), `change` = one line on what changed, `task` = what to try given the change.
3. **Wait for all five.** Do not report or predict results before each hand-back arrives. A malformed or failed agent counts as "no result", stated in the report.
4. **Verify before you trust.** For each high or medium finding, reproduce it yourself in your own tab on port 8771 (fresh reload). Mark it `confirmed` or `not reproduced`. Low findings are listed unverified.
5. **Cluster and rank.** Merge findings that describe the same issue. Rank by number of personas that hit it, then severity.
6. **Write the report** to `docs/persona-runs/<ticket-or-date>/report.md` and copy the screenshots referenced by confirmed findings next to it. Shape:
   - one line: personas run, completed count, confirmed issue count
   - friction map table: rank, issue, personas (emoji), severity, status
   - per confirmed issue: repro steps and screenshot
   - per persona: completed yes/no, one-line note
7. **Stop the servers:** `for p in 8771 8772 8773 8774 8775; do lsof -tiTCP:$p -sTCP:LISTEN | xargs -r kill; done` (only ports this run started).

## In a factory-loop build tick

Run the **fast** mode after the ticket's own Chrome verification and before committing. Then:
- A **confirmed high** issue caused by this ticket's change: fix it, re-verify that one issue, note the fix. Do not re-run the whole panel.
- Anything else, including issues that predate this ticket: do not fix. List it in the PR body under "Persona test" and leave it for a new ticket.
- Commit `docs/persona-runs/ticket-N/` with the ticket files. Put the friction map table in the PR body.

## Common mistakes

| Mistake | Fix |
|---|---|
| All agents on one port | Shared IndexedDB makes agents see each other's tasks; one port per persona |
| Reporting an agent's claim as a bug | Reproduce high/medium findings yourself first |
| Fixing every finding inside the ticket | Only confirmed highs caused by this change; the rest become new tickets |
| Using shoal subscription mode | Not allowed; subagents in this session are the subscription path |
| Committing `.env` or printing the Jev key | `.env` is gitignored and the Stop hook unstages it; keep it that way |
| Trusting a fast-mode finding without its repro | Each finding carries the exact moves; replay them before fixing |
| Agents sharing a tab | Each calls tabs_create_mcp and uses only its own tab id |
