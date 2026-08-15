---
summary: accepting at stage 9 also authorises the pull request; stage 10 raises no dialog
---

# One acceptance authorises the pull request

## Context

Stages 9 and 10 each raised a dialog. The user accepted the feature at stage 9, and
was immediately asked at stage 10 whether to commit, push and open the pull request.

The two questions were separated on the grounds that they are different decisions —
the work is good, and the work may leave the machine. In use they are not. Nothing
happens between them: the user answers the first and the second appears on the same
screen, about the same work, with nothing new to weigh. It reads as the harness
asking twice because it did not believe the first answer.

The cost is not only the extra keystroke. A confirmation that always follows another
confirmation stops being read, and an unread dialog is a gate that is not doing its
job. Two dialogs make the acceptance weaker than one, not stronger.

## Decision

Stage 9's dialog is the single point at which the user approves the work and
authorises sending it out. Accepting it sets `authorised_at` in the same write as
the stage change. Stage 10 raises no dialog: it commits, pushes, opens the pull
requests, and calls `finish_task`.

The stage carries the fact, as `authorises: true` in `lib/stages.mjs`, rather than
the server testing for stage 9 by number. Everything else the server knows about a
stage it reads from that table.

There are still ten stages, and `LAST_STAGE` is still 10. Merging stages 9 and 10
would renumber the procedure and invalidate the stage number in every existing
ticket, to save a table row.

`finish_task` still refuses without `authorised_at`, and still has to be called
separately. Authorisation and completion stay two facts: a task is not done because
permission was given, but because the work left the machine. Only the second
question to the user is gone, not the second record.

Reopening a `done` ticket returns it to stage 9. Reopening clears `authorised_at`,
and stage 10 no longer has a dialog that could set it again — a ticket left at stage
10 would be unauthorisable, and `finish_task` would refuse it forever. Stage 9 is
where the one dialog is, so that is where a reopened task goes.

## Reasoning

The product holds that anything making a stage easier to skip is an anti-feature.
This does not remove a gate; it removes a second gate guarding the same thing. Every
question the harness asked is still asked, once, and the answer is still the
plugin's own dialog answered by the user without passing through Claude.

The alternative considered was to keep both dialogs and offer a third answer at
stage 9 — accept the work but hold the pull request. It was rejected: it serves a
case the user can already handle by declining, or by saying so in the conversation,
and it would cost a wider dialog on every acceptance to serve the rare one. The same
reasoning already governs the two-button decline at stage 9, recorded in
`docs/architecture.md` §7.

What the change gives up is the ability to distinguish "the feature is good" from
"send it" in the ticket history. That distinction was never acted on anywhere, and a
record nobody reads is not worth a dialog everybody answers.
