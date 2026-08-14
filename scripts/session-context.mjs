// Runs when a session starts or resumes.
//
// Two jobs.
//
// It records the session id in the ticket, for a task whose workspace this session
// started in — and only for that task. Resolving the ticket from the working
// directory is right here and wrong everywhere else: this session demonstrably is in
// that workspace. `start_task` gets the id passed to it instead, because a session
// creating a task is usually nowhere near the workspace it is about to create. See
// docs/adr/0002-session-id-from-the-environment.md.
//
// And it states the current stage, because a procedure described once at the start
// of a long session is not reliably present later on.

import { describe, stage } from '../lib/stages.mjs';
import { context, writeTicket } from '../lib/store.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let event;
try {
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

const { ticket } = context(event?.cwd ?? process.cwd());
if (!ticket || ticket.status !== 'active') process.exit(0);

// Only fills a gap. Overwriting would mean that opening the workspace later, just to
// look at something, replaces the session the task was actually worked in — and the
// resume would then lead to the wrong conversation.
if (event.session_id && !ticket.session_id) {
  ticket.session_id = event.session_id;
  writeTicket(ticket);
}

const s = stage(ticket.stage);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event.hook_event_name,
      additionalContext: [
        `dev-harness task "${ticket.branch}" is at ${describe(ticket.stage)}.`,
        `This stage: ${s?.intent ?? ''}`,
        `Repositories: ${ticket.repos.join(', ') || 'not settled yet'}.`,
        ticket.stage < 6
          ? 'Writing inside a repository is refused until the user approves the design at stage 5. The task document and docs/architecture.md, docs/product.md, docs/adr/ stay writable.'
          : 'Nothing is refused at this stage.',
        'Call advance_stage to move on; it will not advance unless the stage produced something.',
      ].join(' '),
    },
  }),
);
