// The only refusal in dev-harness.
//
// Until the user has approved the design, nothing inside a repository is writable
// except the three conventional documentation paths. After that, this script
// refuses nothing for the rest of the task.

import { dirname } from 'node:path';
import { DOC_PATHS, classify, context } from '../lib/store.mjs';

const APPROVED_FROM = 6; // stage 5 ends with the user's approval

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let event;
try {
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

const target = event?.tool_input?.file_path ?? event?.tool_input?.notebook_path;
if (!target) process.exit(0);

const { workspace, ticket } = context(dirname(target));

// No task here: dev-harness is silent in projects that never adopted it.
if (!ticket || ticket.status !== 'active') process.exit(0);
if (ticket.stage >= APPROVED_FROM) process.exit(0);
if (classify(workspace, target) !== 'repo') process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `The design for ${ticket.branch} is not approved yet (stage ${ticket.stage} of 10).`,
        `Writing inside a repository is refused until the user approves it at stage 5.`,
        `Still writable: the task document, and ${DOC_PATHS.join(', ')} in any repository.`,
        `Present the design in task.md, then call advance_stage.`,
      ].join(' '),
    },
  }),
);
