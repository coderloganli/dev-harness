# The session id is passed in to start_task

summary: start_task takes the session id as an argument; two other mechanisms were tried and one more was designed and cut

## Context

A ticket records the Claude session it was worked in, so `find_ticket` can offer a
resume. Getting that id to the ticket turned out to be the hard part, and three
mechanisms failed before this one. Each failed differently and each failure is worth
keeping.

**The hook writing into the ticket.** `scripts/session-context.mjs` had the id —
hook payloads carry `session_id`, which is measured fact — but it resolved *which
ticket to write to* from the event's `cwd`. A session whose working directory is the
project's parent, or anywhere outside a task workspace, resolves to no ticket, so
the script exited having written nothing. The id was never missing; tying its
storage to the working directory was the mistake.

**The server reading its own environment.** `CLAUDE_CODE_SESSION_ID` is present in
the environment of the Bash tool, and the assumption was that a bundled MCP server
inherits it too. It does not. This survived a full unit-test suite, because a test
that spawns the server with the variable set proves only that the code reads a
variable. Stage 9 caught it: a task created in a live session still recorded null.

**A shared session record.** Designed as the replacement: the hook writes
`{ session_id, at }` to the plugin's data directory, not keyed by working directory,
and `start_task` falls back to it. Cut during design review, for the reason under
Reasoning.

## Decision

`start_task` takes `session_id` as an argument, in the handler and in its advertised
schema. The task skill reads `CLAUDE_CODE_SESSION_ID` in a shell call at stage 1 and
passes it.

With no argument, the server tries its own environment. That is known not to work
today; it costs nothing, and it starts working by itself if a future version does
inherit the variable.

With neither, the ticket records null.

The `SessionStart` hook keeps repairing a ticket when a session starts inside that
ticket's own workspace. That is the one case where resolving from the working
directory is right rather than wrong: the session is demonstrably in that workspace.

## Reasoning

Claude can read the variable — measured, not assumed — so asking it to pass the value
depends on nothing the harness has not already demonstrated. The failure mode is a
null session id, which is what happens today, so a forgotten argument costs nothing
that is not already lost.

The shared record was cut because it could produce a *wrong* id rather than no id.
The file is plugin-global, so a session starting in a different project overwrites
it; and a record left by a session closed days ago is indistinguishable from a live
one. A missing id costs a "not recorded" line the user can see. A wrong one hands
them a resume command that silently goes nowhere.

Its only value was covering the case where Claude omits the argument — and covering
that case wrongly is worse than leaving it uncovered. Cutting it also removed
everything it dragged behind it: staleness rules, atomic writes, and isolating the
data directory in every test.

The general form, worth stating because it recurs: **when a fallback can be wrong
rather than absent, absent is the better answer.** A gap is visible; a plausible
wrong value is not.
