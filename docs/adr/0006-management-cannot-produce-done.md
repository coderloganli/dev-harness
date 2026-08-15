---
summary: set_ticket_status moves a ticket between active and abandoned only; done stays the exclusive result of finish_task
---

# Ticket management cannot set a ticket to done

## Context

Managing tickets means changing their status: reopening an abandoned task, dropping
one that will not be finished. The natural tool is a general one — give it a branch
and a status, and it writes it.

A general one can also write `done`. `done` is what stage 10 produces after the user
has accepted the feature at stage 9 — the acceptance that also authorises the pull
request — and `finish_task` refuses to produce it without that authorisation. A
management tool that writes it directly is a way around that dialog, available to a
model under context pressure looking for the cheapest action that looks like
finishing.

## Decision

`set_ticket_status` accepts `active` and `abandoned` only. `done` is refused, with a
message naming `finish_task` and the stage 9 authorisation. Every change it does
make raises the plugin's own dialog and is written only when the user accepts.

Reopening from `done` clears `finished_at` and `authorised_at`, returns the stage to
9, and keeps `pull_requests`. A ticket cannot be both live and already authorised:
those two fields are the record that the stage 9 dialog was answered, and a reopened
task has to answer it again before its work leaves the machine a second time. Stage
9 is where that dialog is — stage 10 has none — so leaving a reopened ticket at 10
would leave it unauthorisable and `finish_task` would refuse it forever. The pull
requests themselves stay, because they exist.

`abandon_task` is kept as it is. It belongs to the stage flow: it acts on the task
the working directory is in, and it is what the `task` skill calls when the user
drops the task in front of it. `set_ticket_status` belongs to management and works
on any ticket in the project by name.

## Reasoning

The product states that anything making a stage easier to skip is an anti-feature.
The stages exist to get an answer from the user — the feature works, and it may be
sent out — and `done` is the record that it was given. A second way to write it
would be a second, unwitnessed way to claim it.

Refusing one value is a smaller thing than it looks: nothing legitimate needs it. A
task that really is finished goes through stage 9, which is one dialog. A task that
will never be finished is `abandoned`, which the tool does allow.

The overlap with `abandon_task` is accepted rather than resolved by merging them.
They differ in what they resolve — a directory against a name — and merging would
mean the stage-flow tool taking a branch argument, which is exactly the shape that
lets a task other than the current one be changed by accident.
