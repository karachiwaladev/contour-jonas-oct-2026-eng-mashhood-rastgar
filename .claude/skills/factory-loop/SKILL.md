---
name: factory-loop
description: Use when running as an autonomous worker over a repo's GitHub issues (tickets) on a /loop interval, or when asked to pick up, claim, process, build, or answer tickets that arrive as GitHub issues.
---

# Factory Loop

One tick handles every ticket that needs action in the current repo. Start it with `/loop 1m /factory-loop`.

The loop and the ticket author may share one GitHub login. Every comment the loop posts ends with a hidden marker `<!-- factory:phase=NAME -->` (questions, plan, blocked, done). A ticket whose latest comment has a marker is waiting on a human. A ticket whose latest comment has no marker has been replied to and is listed again with that reply.

## One tick

1. **List tickets:** `cd "$(git rev-parse --show-toplevel)" && bash .claude/skills/factory-loop/scripts/tickets.sh`
   JSON lines: number, title, body, phase, reply. No output: say "Queue empty" and stop.
2. **For each ticket, oldest first,** act by phase. Claim a `new` ticket first: `gh api -X POST 'repos/{owner}/{repo}/issues/N/reactions' -f content=eyes`
3. **Recap:** one line per ticket with its number, phase, and the action taken.

## Classify a new ticket

- **Answer ticket:** asks a question, needs no files. Reply with the answer and close: `gh issue close N --reason completed --comment "<answer> <!-- factory:phase=done -->"`
- **Build ticket:** asks for files, code, a project, or a feature in an existing project. Follow the build flow. Never build on the first tick.

## Build flow, one phase per tick

| phase | reply | Do this tick |
|---|---|---|
| `new` | - | Read the ticket and the target project. Post numbered clarifying questions about every assumption you would otherwise make (scope, data, UI, edge cases). End with "Reply here; the loop re-reads this ticket within a minute." Marker `questions`. Leave open. |
| `questions` | answers | Post the plan: files to create or change, behaviour, what will be verified in the browser. End with "Reply 'approved' or ask for changes." Marker `plan`. Leave open. |
| `plan` | asks for changes | Revise the plan and post it again. Marker `plan`. Leave open. |
| `plan` | approval | Build. Verify in Chrome with the extension tools. Screenshot each verified behaviour with `save_to_disk: true`. Copy the images (PNG or JPEG, as saved) to `docs/screenshots/ticket-N/`. Commit and `git push origin main`. Then comment with the result, the commit SHA, and each screenshot as `![name](https://github.com/OWNER/REPO/blob/main/docs/screenshots/ticket-N/name.jpg?raw=true)`. Marker `done`. Close `--reason completed`. |
| `done` | comment after reopen | Treat as `questions`: read the reply, answer or post a revised plan. |
| any | - | Cannot proceed as written: comment the specific blocker or question. Marker `blocked`. Leave open. A reply lists it again with phase `blocked`; treat it as `questions`. |

Push before you comment, or the image links return 404. Serve a static project with `python3 -m http.server PORT` from its folder and stop the server when done.

## Non-destructive, always

Do not delete existing files or folders, run `rm -rf`, force-push, rewrite history, delete branches, issues, or comments, or close a ticket you did not complete. Edit and add only.

## Comment shape

Bold answer or outcome first. Then one to three bullets of evidence (facts, links, commit SHA, screenshots). Then the source. Then the marker on its own line.

## Common mistakes

| Mistake | Fix |
|---|---|
| Building a feature on the first tick | New build ticket gets questions only |
| Comment without a marker | The ticket is listed again next tick as if a human replied |
| Commenting screenshots before pushing | Push first; links point at `main` |
| Detecting a human reply by author login | Same login; detect by missing marker |
| Re-answering a ticket that already has your 👀 | `tickets.sh` lists it only when a human replied |
| Closing without `--reason completed` | Always pass `--reason completed` |
| Commit message says `closes #N` | GitHub auto-closes on push, skipping your comment and reason. Write `(#N)` instead |
| Hardcoding owner/repo | Use `{owner}`/`{repo}` placeholders in `gh api`; `gh repo view --json nameWithOwner` for links |
