---
name: factory-loop
description: Use when running as an autonomous worker over a repo's GitHub issues (tickets) on a /loop interval, or when asked to pick up, claim, process, or answer tickets that arrive as GitHub issues.
---

# Factory Loop

One tick handles every open, unclaimed ticket in the current repo. Start it with `/loop 1m /factory-loop`.

Ticks never overlap (the session cron fires only while idle), so your own 👀 reaction is a permanent "handled" marker. There is no lock to expire and nothing to take over.

## One tick

1. **List unclaimed tickets:** `bash .claude/skills/factory-loop/scripts/tickets.sh`
   Prints open issues without your 👀 as JSON lines (number, title, body). No output: say "Queue empty" and stop.
2. **For each ticket, oldest first:**
   1. Claim: `gh api -X POST 'repos/{owner}/{repo}/issues/N/reactions' -f content=eyes`
   2. Read title and body. Do what it asks. If it needs repo changes: make them, commit, `git push origin main`. Only what is on GitHub counts.
   3. Report and close: `gh issue close N --reason completed --comment "<result>"`
   4. Cannot complete as written? `gh issue comment N --body "<specific blocker or question>"` and leave it open. It carries your 👀 so it will not be re-picked; a human re-triggers with a new ticket.
3. **Recap:** one line per ticket with its number and the action taken.

## Comment shape

Bold answer or outcome first. Then one to three bullets of evidence (facts, links, commit SHA). Then the source.

## Common mistakes

| Mistake | Fix |
|---|---|
| Re-answering a ticket that already has your 👀 | Step 1 filters on `viewerHasReacted`; trust it |
| Inventing stale-lock or takeover logic | Ticks do not overlap; skip anything with your 👀 |
| One reactions lookup per issue (N+1 calls) | One GraphQL call via `tickets.sh` |
| Closing without `--reason completed` | Always pass `--reason completed` |
| Changing files without pushing | Push to `main` before closing the ticket |
| Commit message says `closes #N` | GitHub auto-closes on push, skipping your comment and reason. Write `(#N)` instead |
| Hardcoding owner/repo | Use `{owner}`/`{repo}` placeholders; gh fills them from the remote |
