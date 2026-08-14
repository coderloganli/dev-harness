---
summary: a ticket written down before work starts is active at stage 0, so the status set stays at three
---

# A backlog ticket is a stage, not a fourth status

## Context

A ticket can now be written down before any work begins: a description and a
proposed branch name, with no workspace, no worktree, no branch and no task
document. It has to be representable in the ticket file, and it has to be visible in
the default listing, which shows unfinished work.

The obvious move is a fourth status, `backlog`, alongside `active`, `done` and
`abandoned`. Every reader of a ticket would then have to learn it: the refusal hook,
the session-start hook, `find_ticket`, `get_status`, and every future one.

## Decision

The status set stays exactly `active`, `done`, `abandoned`. A backlog entry is
`active` with `stage: 0` and `workspace: null`. `describe(0)` renders it as
`backlog`, and `stage(0)` returns null, because a backlog entry is not at a stage of
the procedure.

## Reasoning

Status and stage answer different questions. Status is whether the work is still
live; stage is how far along the procedure it is. A backlog entry is live work that
has not entered the procedure, so it is `active` at no stage — the two existing
fields already say it, and a fourth status would say it a second time in a way that
can disagree with the first.

The practical consequence is that nothing that reads status needs to change. The two
hooks already guard on `status === 'active'` and then resolve the ticket from the
working directory; a backlog ticket has no directory to be resolved from, so they
never see one. A `backlog` status would have needed a new case in both, and in
everything written afterwards.

The cost is that `stage: 0` has to mean something to a reader who expects 1..10, and
that is paid once in `describe`, where the numbering already lives.
