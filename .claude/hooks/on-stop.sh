#!/usr/bin/env bash
# Stop hook entry point: runs each stop task in order with the same payload.
set -uo pipefail
payload=$(cat)
dir=$(cd "$(dirname "$0")" && pwd)
echo "$payload" | bash "$dir/log-prompts.sh"
echo "$payload" | bash "$dir/auto-commit.sh"
