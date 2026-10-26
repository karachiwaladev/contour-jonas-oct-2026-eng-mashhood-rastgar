#!/usr/bin/env bash
# Stop hook: append the session's new user prompts to .claude/prompts.jsonl.
# Reads the hook payload on stdin (session_id, transcript_path, cwd), scans the
# session transcript for user prompts, and appends only entries whose uuid is
# not already in the log, so every stop adds just what is new.
#
# One JSON object per line:
#   {"session_id","uuid","timestamp","source","prompt"}
#   source: "user" (typed), "command" (slash command), "scheduled" (cron/loop)
# Skips local command output and subagent hand-back messages.
set -euo pipefail

input=$(cat)
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session=$(jq -r '.session_id // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

root=$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null || echo "${cwd:-.}")
out="${PROMPTS_LOG:-$root/.claude/prompts.jsonl}"
mkdir -p "$(dirname "$out")"
touch "$out"

seen=$(jq -s '[.[].uuid]' "$out" 2>/dev/null || echo '[]')

jq -c --arg session "$session" --argjson seen "$seen" '
  select(.type == "user" and (.message.content | type) == "string")
  | .uuid as $u | select(($seen | index($u)) == null)
  | . as $e
  | .message.content as $c
  | if ($c | startswith("<local-command")) then empty
    elif ($c | startswith("Another Claude session sent a message")) then empty
    elif ($c | test("<command-name>")) then
      { source: "command",
        prompt: ((([$c | capture("<command-name>(?<n>[^<]*)</command-name>")] | .[0].n) // "")
                 + " "
                 + (([$c | capture("<command-args>(?<a>[^<]*)</command-args>")] | .[0].a) // "")
                 | rtrimstr(" ")) }
    else
      { source: (if $e.isMeta == true then "scheduled" else "user" end), prompt: $c }
    end
  | { session_id: $session, uuid: $e.uuid, timestamp: $e.timestamp, source, prompt }
' "$transcript" >> "$out"
