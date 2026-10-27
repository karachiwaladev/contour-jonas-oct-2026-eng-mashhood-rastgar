---
name: persona-test
description: Use when a change to a web project must be tested by simulated users before review, when the factory-loop build flow reaches its persona-test step, or when asked to run persona agents, a user swarm, or shoal-style testing against a local app.
---

# Persona Test

Five persona agents use the app in parallel, each in its own Chrome tab and its own origin, and report findings. The result is a friction map: issues ranked by how many personas hit them.

Personas live in `<project>/personas.yaml` (shoal format, exactly 5). The agents are Claude Code subagents in this session, which is the supported way to use a Claude subscription. Do not use shoal's `--provider subscription`: it reads the Claude Code OAuth token from outside Claude Code.

## Run

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

Run after the ticket's own Chrome verification and before committing. Then:
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
| Agents sharing a tab | Each calls tabs_create_mcp and uses only its own tab id |
