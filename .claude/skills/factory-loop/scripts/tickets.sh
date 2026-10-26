#!/usr/bin/env bash
# Print the open GitHub issues in the current repo that need action this tick,
# oldest first, one JSON object per line:
#   {"number", "title", "body", "phase", "pr", "reply"}
#
# phase: "new"      no 👀 from the current user yet
#        otherwise  the phase of the loop's latest marked comment
#                   (questions | plan | review | blocked | done)
# pr:    the pull request number from a "review" marker, else null
# reply: "merged" or "pr-closed" when the ticket's PR reached that state,
#        else the latest human comment on the ticket or on the PR conversation,
#        else null for a new ticket
#
# The loop and the ticket author may share one GitHub login, so a loop comment
# is recognised by its hidden marker "<!-- factory:phase=NAME [pr=M] -->",
# never by author. A ticket whose latest comment carries a marker and whose PR
# (if any) is still open with no new human comment is waiting on a human and is
# not listed. Empty output means nothing to do.
set -euo pipefail

gh api graphql -F owner='{owner}' -F repo='{repo}' -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(last: 50, states: [OPEN, MERGED, CLOSED]) {
      nodes { number state merged comments(last: 50) { nodes { body } } }
    }
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
  def marked: test("<!-- factory:phase=");
  def mark: capture("<!-- factory:phase=(?<p>[a-z]+)(?: pr=(?<pr>[0-9]+))? -->");
  .data.repository.pullRequests.nodes as $prs
  | .data.repository.issues.nodes[]
  | ([.reactionGroups[] | select(.content == "EYES" and .viewerHasReacted)] | length > 0) as $claimed
  | [.comments.nodes[].body] as $bodies
  | ($bodies | if length == 0 then null else .[-1] end) as $last
  | ([$bodies[] | select(marked)] | if length == 0 then null else (.[-1] | mark) end) as $m
  | ($m.p // null) as $phase
  | (if ($m.pr // null) != null then ($m.pr | tonumber) else null end) as $prnum
  | ($prs | map(select(.number == $prnum)) | .[0]) as $pr
  | (if $pr == null then null
     elif $pr.merged then "merged"
     elif $pr.state == "CLOSED" then "pr-closed"
     else ([$pr.comments.nodes[].body]
           | if length > 0 and (.[-1] | marked | not) then .[-1] else null end)
     end) as $prreply
  | if ($claimed | not) then
      {number, title, body, phase: "new", pr: null, reply: null}
    elif ($phase == "review" and ($prreply == "merged" or $prreply == "pr-closed")) then
      {number, title, body, phase: "review", pr: $prnum, reply: $prreply}
    elif ($last != null and ($last | marked | not)) then
      {number, title, body, phase: ($phase // "new"), pr: $prnum, reply: $last}
    elif ($phase == "review" and $prreply != null) then
      {number, title, body, phase: "review", pr: $prnum, reply: $prreply}
    else empty end'
