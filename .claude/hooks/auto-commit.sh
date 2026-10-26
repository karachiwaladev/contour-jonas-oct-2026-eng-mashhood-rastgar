#!/usr/bin/env bash
# Stop hook: commit and push any working-tree changes in the current repo.
# Reads the hook payload on stdin for cwd. Never deletes, never force-pushes.
set -euo pipefail

input=$(cat)
cwd=$(jq -r '.cwd // empty' <<<"$input")
root=$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root"

git add -A
git diff --cached --quiet && exit 0

git commit -q \
  -m "chore: auto-commit on stop ($(date -u +%Y-%m-%dT%H:%M:%SZ))" \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -q origin HEAD 2>/dev/null || true
