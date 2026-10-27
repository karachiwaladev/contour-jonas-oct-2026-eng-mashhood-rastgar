#!/usr/bin/env bash
# Stop hook: on main only, commit any working-tree changes, rebase onto the
# remote (a merged PR moves origin/main), and push. Never deletes, never forces.
# On a feature branch (a build tick in progress) it does nothing, so ticket
# branches never pick up the prompt log and stay mergeable.
set -uo pipefail

input=$(cat)
cwd=$(jq -r '.cwd // empty' <<<"$input")
root=$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root"
[ "$(git branch --show-current)" = "main" ] || exit 0

git add -A
# never commit secrets, even if a .gitignore is missing
git reset -q -- .env .env.* 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -q \
    -m "chore: auto-commit on stop ($(date -u +%Y-%m-%dT%H:%M:%SZ))" \
    -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
fi

if ! git pull -q --rebase origin main 2>/dev/null; then
  git rebase --abort 2>/dev/null || true
  exit 0
fi
git push -q origin main 2>/dev/null || true
