---
name: tickets
description: Find an earlier harness task by what it was about, and get back the workspace to return to and the session to resume. Lists every task when given nothing to search for.
disable-model-invocation: true
---

# tickets

The user remembers a task by what it was about, not by its branch name. This skill
turns that memory back into a directory and a session.

## Searching

Call `find_ticket` with whatever the user gave you — "the search ranking one", "the
thing about VAD" — as the query. With no query at all, it lists every task, most
recent first. `status: "active"` narrows it to unfinished work.

Report each match as: branch, status and stage, the description, the workspace path,
and the session id.

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

## Abandoning one

If the user wants to drop a task, call `abandon_task` with their reason. Nothing is
deleted — the workspace, the worktrees, and the branch stay where they are, and only
the ticket changes. Say that plainly, and tell them the workspace is theirs to
delete whenever they want.
