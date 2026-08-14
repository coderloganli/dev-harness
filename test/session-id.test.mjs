// Test cases 1-5: a ticket records the session it was created in, so find_ticket
// can offer a resume.
//
// The session id reaches start_task as an argument. Two earlier mechanisms failed —
// a hook that resolved the ticket from the working directory, and the server reading
// its own environment — and a third was designed and cut. See
// docs/adr/0002-session-id-from-the-environment.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';

import { newTicket } from '../lib/store.mjs';
import { callTool, callTools, cleanup, listTools, makeProject, runHook } from './helpers.mjs';

after(cleanup);

const readTicket = (project, branch) =>
  JSON.parse(readFileSync(`${project}/tickets/${branch}.json`, 'utf8'));

test('1 — newTicket records a session id', () => {
  const ticket = newTicket({
    project: 'C:/p',
    branch: 'b',
    description: 'd',
    session_id: 'sess-1234',
  });
  assert.equal(ticket.session_id, 'sess-1234');
});

test('2 — newTicket without a session id records null', () => {
  const ticket = newTicket({ project: 'C:/p', branch: 'b', description: 'd' });
  assert.equal(ticket.session_id, null, 'session_id must be null, not undefined or absent');
  assert.ok('session_id' in ticket);
});

test('3 — start_task advertises session_id and uses it over the environment', async () => {
  // The schema half matters on its own: a handler that reads args.session_id while
  // the schema omits it works in a test and is invisible to tool discovery, so
  // Claude never learns the argument exists.
  const tools = await listTools();
  const startTask = tools.find((t) => t.name === 'start_task');
  assert.ok(
    startTask.inputSchema.properties.session_id,
    'start_task must advertise session_id, not only accept it',
  );

  const project = makeProject();
  // Hostile on purpose: the environment holds a different value. The previous
  // version of this test set the environment and then agreed with itself, which is
  // how a design that does not work in production passed a full suite.
  await callTool(
    'start_task',
    { cwd: project, branch: 'add-search', description: 'cannot find anything', session_id: 'sess-arg' },
    { env: { CLAUDE_CODE_SESSION_ID: 'sess-env' } },
  );
  assert.equal(readTicket(project, 'add-search').session_id, 'sess-arg');
});

test('4 — start_task with nothing available records null', async () => {
  const project = makeProject();
  await callTools(
    [{ name: 'start_task', arguments: { cwd: project, branch: 'add-search', description: 'd' } }],
    { unset: ['CLAUDE_CODE_SESSION_ID'] },
  );
  const ticket = readTicket(project, 'add-search');
  assert.equal(ticket.branch, 'add-search');
  assert.equal(ticket.session_id, null, 'null is the honest answer; the design prefers it to a guess');
});

test('4b — SessionStart repairs a ticket when the session starts in its workspace', async () => {
  const project = makeProject();
  await callTools(
    [{ name: 'start_task', arguments: { cwd: project, branch: 'add-search', description: 'd' } }],
    { unset: ['CLAUDE_CODE_SESSION_ID'] },
  );
  assert.equal(readTicket(project, 'add-search').session_id, null);

  await runHook('session-context.mjs', {
    hook_event_name: 'SessionStart',
    session_id: 'sess-repaired',
    cwd: `${project}/add-search`,
  });
  assert.equal(readTicket(project, 'add-search').session_id, 'sess-repaired');
});

test('5 — find_ticket offers a resume', async () => {
  const project = makeProject();
  const [, found] = await callTools([
    {
      name: 'start_task',
      arguments: {
        cwd: project,
        branch: 'add-search',
        description: 'cannot find anything',
        session_id: 'sess-resume-me',
      },
    },
    { name: 'find_ticket', arguments: { cwd: project, query: 'cannot find' } },
  ]);
  assert.match(found, /sess-resume-me/);
  assert.doesNotMatch(found, /not recorded/);
});
