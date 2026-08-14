---
summary: cleanup is a move into tickets/archive/, never a delete, and never touches the workspace
---

# Archiving moves the ticket file, and nothing is ever deleted

## Context

Tickets accumulate. This project alone carries three throwaway tickets from an
acceptance check, and they bury the one live task in every listing. The user asked
for cleanup.

Cleanup has three possible depths: delete the ticket file; delete the ticket and its
workspace, worktree and branch; or move the ticket out of every listing while
deleting nothing.

## Decision

Archiving moves `tickets/<branch>.json` to `tickets/archive/<branch>.json`. The
workspace, its worktrees and its branch are untouched, and no file is ever removed.
`archive_ticket` with `restore: true` moves it back. The listing reads the archive
only when explicitly asked.

## Reasoning

Deleting the workspace is the only version that actually reclaims disk, and it is
the one version that can destroy work: a worktree holds uncommitted changes, and
nothing in the plugin can judge whether they matter. The architecture already
promises that nothing is deleted on the plugin's initiative, and cleanup is a bad
reason to be the first exception.

Deleting only the ticket file is not much better. The ticket is the sole record of
what a workspace on disk was for; removing it leaves an unexplained directory and no
way back to the session that produced it.

Moving the file gets the whole benefit — the listing shows live work — at no risk,
and it is reversible with the same mechanism that performed it. That the archive is
a directory rather than a field in the file is what makes the default listing free:
`allTickets` reads one directory and archived tickets are simply not in it, so no
reader has to remember to filter them out.
