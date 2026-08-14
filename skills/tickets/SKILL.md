---
name: tickets
description: Manage this project's tickets — list the live ones, find an earlier task by what it was about and get back the workspace and the session, write down work not yet begun, reopen or abandon a task, and archive what is finished with.
disable-model-invocation: true
---

# tickets

A ticket is a task's record: what it was about, where its workspace is, and which
session it was worked in. This skill is how the user sees them and changes them.

## Listing and searching

Call `find_ticket` with whatever the user gave you — "the search ranking one", "the
thing about VAD" — as the query, or with nothing to list.

**The default listing is unfinished work only**: active tasks and backlog entries.
Finished, abandoned and archived tickets are still there and one argument away —
`status: "done"`, `"abandoned"`, `"all"`, or `archived: true`. When the user asks
where something went, say that before saying it is gone.

It answers with a table when several match, and with the whole ticket when exactly
one does.

**Print what came back and add nothing.** The table is already the answer: put it in
the reply verbatim, in a code block, with no row restated in prose, no summary of how
many there are, and no commentary on what they mean. If the user wants one of them,
they will say so.

## Getting back to one

For the task the user picks, give them both ways in:

- the workspace directory to change into, and
- the command to resume the session it was worked on in, when a session id was
  recorded: `claude --resume <session-id>`

Resuming brings back the conversation. Changing into the workspace is what makes the
task current — the stage, the refusals, and the task document all follow the
directory.

If the ticket has no session id, say so: the task can still be continued in a new
session from the workspace, starting with the `task` skill, which reads the stage
from the ticket and picks up there.

## Writing one down before starting it

`add_ticket` records work not begun: a description and a proposed branch name, and
nothing else. No workspace, no worktree, no branch, no task document — it is a note,
and it costs nothing to write. Propose the branch name the way the `task` skill does:
kebab-case, at most four words, naming the outcome.

Starting it later is the ordinary `task` skill. `start_task` with the same branch
adopts the ticket, keeping what it said and when it was written down.

## Reopening and abandoning

`set_ticket_status` moves a ticket between `active` and `abandoned`, by branch, from
anywhere in the project. Reopening a task that was dropped, or one that was finished
and turned out not to be, is `status: "active"`.

It cannot set `done`. A task becomes done by being finished: the user accepts it at
stage 9, authorises the pull request at stage 10, and `finish_task` records it.

The user is asked before anything is written, so pass their `reason` — it is what the
dialog shows them and what the history records. Nothing is deleted either way: the
workspace, the worktrees and the branch stay where they are.

## Archiving

`archive_ticket` moves a ticket out of every listing, into `tickets/archive/`.
Nothing is deleted — not the ticket file, not the workspace, not the branch — and
`restore: true` brings it back. This is the whole of cleanup; a workspace directory
is only ever removed by the user, by hand.
