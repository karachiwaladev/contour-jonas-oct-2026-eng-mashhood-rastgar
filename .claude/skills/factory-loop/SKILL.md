---
name: factory-loop
description: Use when running as an autonomous worker over a repo's GitHub issues (tickets) on a /loop interval, or when asked to pick up, claim, process, build, or answer tickets that arrive as GitHub issues.
---

# Factory Loop

One tick handles every ticket that needs action in the current repo. Start it with `/loop 1m /factory-loop`.

The loop and the ticket author may share one GitHub login. Every comment the loop posts ends with a hidden marker `<!-- factory:phase=NAME -->` (questions, plan, review pr=M, blocked, done). A ticket whose latest comment has a marker is waiting on a human. A ticket is listed again when a human comments on it or on its PR, or when its PR is merged or closed.

## One tick

1. **List tickets:** `cd "$(git rev-parse --show-toplevel)" && git checkout -q main && bash .claude/skills/factory-loop/scripts/tickets.sh`
   If `git branch --show-current` is a `ticket-N` branch with a dirty tree (a previous build tick died), first commit that ticket's files to the branch as `wip (#N)`, then check out `main`.
   JSON lines: number, title, body, phase, pr, reply. No output: say "Queue empty" and stop.
2. **For each ticket, oldest first,** act by phase. Claim a `new` ticket first: `gh api -X POST 'repos/{owner}/{repo}/issues/N/reactions' -f content=eyes`
3. **Recap:** one line per ticket with its number, phase, and the action taken. Every tick starts and ends on `main`.

## Classify a new ticket

- **Answer ticket:** asks a question, needs no files. Reply with the answer and close: `gh issue close N --reason completed --comment "<answer> <!-- factory:phase=done -->"`
- **Build ticket:** asks for files, code, a project, or a feature in an existing project. Follow the build flow. Never build on the first tick.

## Build flow, one phase per tick

| phase | reply | Do this tick |
|---|---|---|
| `new` | - | Read the ticket and the target project. Post numbered clarifying questions about every assumption you would otherwise make (scope, data, UI, edge cases). End with "Reply here; the loop re-reads this ticket within a minute." Marker `questions`. Leave open. |
| `questions` | answers | Post the plan: files to create or change, behaviour, what will be verified in the browser. End with "Reply 'approved' or ask for changes." Marker `plan`. Leave open. |
| `plan` | asks for changes | Revise the plan and post it again. Marker `plan`. Leave open. |
| `plan` | approval | Branch: `git pull -q --ff-only origin main && git checkout -b ticket-N`. Build. Verify in Chrome with the extension tools; screenshot each verified behaviour with `save_to_disk: true`; copy the images (PNG or JPEG, as saved) to `docs/screenshots/ticket-N/`. Stage only the ticket's files (`git add <project> docs/screenshots/ticket-N`, never `-A`). Commit with `(#N)` in the message. `git push -u origin ticket-N`. Open the PR: `gh pr create --base main --head ticket-N --title "<summary> (#N)" --body "<result, commit SHA, screenshots as ![name](https://github.com/OWNER/REPO/blob/FULL_SHA/docs/screenshots/ticket-N/name.jpg?raw=true)> <!-- factory:phase=review -->"`. Comment on the ticket: "PR #M is ready for review: URL. Merge it to approve. For changes, comment here or in the PR conversation." Marker `review pr=M`. Leave open. `git checkout main`. |
| `review` | `merged` | `git pull -q --rebase origin main`. Close: `gh issue close N --reason completed --comment "<what merged, PR link> <!-- factory:phase=done -->"`. |
| `review` | change request | `git checkout ticket-N && git pull -q --ff-only origin ticket-N`. Make the change, re-verify, add screenshots, commit ticket files only, push. Comment what changed on the PR and on the ticket, both with marker `review pr=M`. Leave open. `git checkout main`. |
| `review` | "approved" or thanks, no merge | Comment "Press Merge on PR #M to approve; the loop never merges." Marker `review pr=M`. |
| `review` | `pr-closed` | Comment asking whether to reopen the PR or drop the ticket. Marker `blocked`. |
| `done` | comment after reopen | Treat as `questions`: read the reply, answer or post a revised plan. |
| any | - | Cannot proceed as written: comment the specific blocker or question. Marker `blocked`. Leave open. A reply lists it again with phase `blocked`; treat it as `questions`. |

Push before you comment or open the PR, or the image links return 404. Serve a static project with `python3 -m http.server PORT` from its folder and stop the server when done.

## Non-destructive, always

Do not delete existing files or folders, run `rm -rf`, force-push, rewrite history, delete branches, issues, or comments, merge a PR (`gh pr merge`), or close a ticket you did not complete. Edit and add only.

## Comment shape

Bold answer or outcome first. Then one to three bullets of evidence (facts, links, commit SHA, screenshots). Then the source. Then the marker on its own line.

## Common mistakes

| Mistake | Fix |
|---|---|
| Building a feature on the first tick | New build ticket gets questions only |
| Comment without a marker | The ticket is listed again next tick as if a human replied |
| `git add -A` on a ticket branch | Stages the prompt log and the PR stops being mergeable. Stage ticket files only |
| Ending a tick on the ticket branch | `git checkout main` is the last step of every build tick |
| Merging the PR yourself | The human merges; the loop only closes the ticket afterwards |
| `closes #N` in a commit, PR title, or PR body | GitHub auto-closes on merge, skipping your done comment. Write `(#N)` instead |
| Screenshot links on `blob/main` before merge | Use the full commit SHA in the link |
| Detecting a human reply by author login | Same login; detect by missing marker |
| Closing without `--reason completed` | Always pass `--reason completed` |
| Hardcoding owner/repo | Use `{owner}`/`{repo}` placeholders in `gh api`; `gh repo view --json nameWithOwner` for links |
