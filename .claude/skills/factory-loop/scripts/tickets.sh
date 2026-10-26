#!/usr/bin/env bash
# Print the open GitHub issues in the current repo that need action this tick,
# oldest first, one JSON object per line:
#   {"number", "title", "body", "phase", "reply"}
#
# phase: "new"      no 👀 from the current user yet
#        otherwise  the phase of the loop's latest marked comment
#                   (questions | plan | blocked) and the human has replied since
# reply: body of the latest human comment, or null for a new ticket
#
# The loop and the ticket author may share one GitHub login, so a loop comment
# is recognised by its hidden marker "<!-- factory:phase=NAME -->", never by
# author. A ticket whose latest comment carries a marker is waiting on a human
# and is not listed. Empty output means nothing to do.
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
        comments(last: 50) { nodes { body } }
      }
    }
  }
}' --jq '
  def marker: capture("<!-- factory:phase=(?<p>[a-z]+) -->") | .p;
  .data.repository.issues.nodes[]
  | . as $i
  | ([.reactionGroups[] | select(.content == "EYES" and .viewerHasReacted)] | length > 0) as $claimed
  | ([.comments.nodes[] | .body] ) as $bodies
  | ($bodies | if length == 0 then null else .[-1] end) as $last
  | ([$bodies[] | select(test("<!-- factory:phase=")) ] | if length == 0 then null else .[-1] | marker end) as $phase
  | if ($claimed | not) then
      {number, title, body, phase: "new", reply: null}
    elif ($last != null and ($last | test("<!-- factory:phase=") | not)) then
      {number, title, body, phase: ($phase // "new"), reply: $last}
    else empty end'
