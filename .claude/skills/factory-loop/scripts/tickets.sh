#!/usr/bin/env bash
# Print open GitHub issues in the current repo that do NOT yet carry the
# current user's 👀 (eyes) reaction, oldest first, one JSON object per line:
#   {"number": 2, "title": "...", "body": "..."}
# Empty output means the queue is empty. Uses gh's {owner}/{repo} placeholders,
# so it works in any attendee's repo without configuration.
set -euo pipefail

gh api graphql -F owner='{owner}' -F repo='{repo}' -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    issues(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        number
        title
        body
        reactionGroups { content viewerHasReacted }
      }
    }
  }
}' --jq '
  .data.repository.issues.nodes[]
  | select(([.reactionGroups[] | select(.content == "EYES" and .viewerHasReacted)] | length) == 0)
  | {number, title, body}'
