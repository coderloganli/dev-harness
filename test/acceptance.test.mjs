// Test cases 38-48: one acceptance, not two.
//
// Stage 9's dialog is the single point at which the user approves the work and
// authorises sending it out; stage 10 asks nothing. And because the terminal cannot
// be scrolled while a dialog is open, every dialog message carries what the decision
// needs. See docs/adr/0007-one-acceptance-authorises-the-pull-request.md and
// docs/adr/0008-a-dialog-says-what-accepting-does.md.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { STAGES, stage } from '../lib/stages.mjs';
import { newTicket } from '../lib/store.mjs';
import { REPO, callTool, cleanup, makeProject, seedTickets } from './helpers.mjs';

after(cleanup);

const read = (project, branch) => JSON.parse(readFileSync(`${project}/tickets/${branch}.json`, 'utf8'));

/** A ticket at whatever point in its life the test needs. */
function ticket(project, branch, fields = {}) {
  return { ...newTicket({ project, branch, description: branch }), ...fields };
}

/** A project holding one ticket, and the workspace directory to call from. */
function at(branch, fields) {
  const project = makeProject({ repos: ['dev-harness'] });
  seedTickets(project, [ticket(project, branch, fields)]);
  return { project, cwd: `${project}/${branch}` };
}

// ---------------------------------------------------------------- one acceptance

test('38 — accepting at stage 9 raises one dialog and authorises the pull request', async () => {
  const { project, cwd } = at('one-accept', { stage: 9, repos: ['dev-harness'] });
  const dialogs = [];

  await callTool('advance_stage', { cwd }, { answer: 'accept', dialogs });

  assert.equal(dialogs.length, 1, 'one acceptance is one dialog');
  const t = read(project, 'one-accept');
  assert.equal(t.stage, 10, 'accepting moves the task to stage 10');
  assert.ok(t.authorised_at, 'accepting at stage 9 is the authorisation to send it out');
});

test('39 — stage 10 asks nothing', async () => {
  const { cwd } = at('no-second-ask', {
    stage: 10,
    repos: ['dev-harness'],
    authorised_at: '2026-01-01T00:00:00.000Z',
  });
  const dialogs = [];

  // No `answer`: were a dialog raised, it would be cancelled, and the tool would
  // report a decline rather than the instruction asserted below.
  const text = await callTool('advance_stage', { cwd }, { dialogs });

  assert.deepEqual(dialogs, [], 'stage 10 must not ask a second time');
  assert.match(text, /commit/i, 'it tells Claude to commit');
  assert.match(text, /push/i, 'it tells Claude to push');
  assert.match(text, /pull request/i, 'it tells Claude to open the pull requests');
  assert.match(text, /finish_task/, 'it names the tool that closes the task');
});

test('39b — a ticket at stage 10 that was never accepted goes back to stage 9', async () => {
  // Stage 10 used to be where the authorisation was asked, so a ticket written before
  // this change can be sitting there unauthorised. Telling it "authorised" would send
  // Claude to open pull requests on work nobody accepted.
  const { project, cwd } = at('never-accepted', { stage: 10, repos: ['dev-harness'] });
  const dialogs = [];

  const text = await callTool('advance_stage', { cwd }, { dialogs });

  assert.deepEqual(dialogs, [], 'it recovers without asking anything');
  assert.match(text, /never accepted/i, 'it says why it went back');
  assert.doesNotMatch(text, /Authorised at stage 9/, 'it must not claim an acceptance that never happened');
  const t = read(project, 'never-accepted');
  assert.equal(t.stage, 9, 'stage 9 is the one stage that can authorise it');
  assert.ok(!t.authorised_at, 'going back authorises nothing by itself');
  assert.deepEqual(
    t.history.map((h) => [h.from, h.to]),
    [[10, 9]],
    'the rollback is recorded',
  );
});

test('40 — accept to done takes one answer in total', async () => {
  const { project, cwd } = at('accept-to-done', { stage: 9, repos: ['dev-harness'] });
  const dialogs = [];

  await callTool('advance_stage', { cwd }, { answer: 'accept', dialogs });
  // A second invocation, not a second call in the same one: every call is written
  // to stdin at once and the server's line handler is async, so finish_task would
  // otherwise run while advance_stage was still waiting on the dialog.
  await callTool(
    'finish_task',
    { cwd, pull_requests: ['https://example.invalid/pr/7'] },
    { dialogs },
  );

  assert.equal(dialogs.length, 1, 'from acceptance to done, the user is asked once');
  const t = read(project, 'accept-to-done');
  assert.equal(t.status, 'done');
  assert.deepEqual(t.pull_requests, ['https://example.invalid/pr/7']);
});

// This one passes before the change as well as after, and that is not a defect in
// it: declining at stage 9 behaves identically under both designs, so there is no
// version of it that could fail today. It is here as a guard — accepting is what
// authorises, not merely arriving at stage 9 — and `authorised_at` is the field this
// change teaches the stage to write.
test('41 — declining at stage 9 authorises nothing', async () => {
  const { project, cwd } = at('declined', { stage: 9, repos: ['dev-harness'] });

  const text = await callTool('advance_stage', { cwd }, { answer: 'decline' });

  assert.match(text, /design problem or an implementation problem/, 'declining is ambiguous, so it asks');
  const t = read(project, 'declined');
  assert.equal(t.stage, 9, 'the task waits at stage 9 for the answer');
  assert.ok(!t.authorised_at, 'a declined task is not authorised');
});

// ---------------------------------------------------------------- what a dialog says

test('42 — the stage 9 dialog says what accepting does', async () => {
  const { cwd } = at('says-what', { stage: 9, repos: ['api', 'web'] });
  const dialogs = [];

  await callTool('advance_stage', { cwd }, { answer: 'accept', dialogs });

  const [message] = dialogs;
  assert.match(message, /says-what/, 'it names the branch');
  assert.match(message, /commits/, 'it says accepting commits');
  assert.match(message, /pushes/, 'it says accepting pushes');
  assert.match(message, /pull request/, 'it says accepting opens a pull request');
  assert.ok(
    message.includes('2 repositories (api, web)'),
    `it names the repositories by name; got: ${JSON.stringify(message)}`,
  );
});

test('43 — a dialog with no repositories settled reads properly', async () => {
  const { cwd } = at('no-repos-yet', { stage: 9 });
  const dialogs = [];

  await callTool('advance_stage', { cwd }, { answer: 'accept', dialogs });

  const [message] = dialogs;
  assert.match(message, /no-repos-yet/, 'it still names the branch');
  assert.ok(
    message.includes('the repositories this task touches'),
    `an unsettled repository list still reads as a sentence; got: ${JSON.stringify(message)}`,
  );
  assert.doesNotMatch(message, /undefined|NaN/, 'no absent value reaches the user');
});

test('44 — the stage 5 and stage 6 dialogs say what accepting does', async () => {
  const five = at('design-stage', { stage: 5, repos: ['dev-harness'] });
  const six = at('tests-stage', { stage: 6, repos: ['dev-harness'] });
  const atFive = [];
  const atSix = [];

  await callTool('advance_stage', { cwd: five.cwd }, { answer: 'accept', dialogs: atFive });
  await callTool(
    'advance_stage',
    { cwd: six.cwd, evidence: 'node --test — 3 failing' },
    { answer: 'accept', dialogs: atSix },
  );

  assert.match(atFive[0], /design-stage/, 'stage 5 names the branch');
  assert.ok(
    atFive[0].includes('unlocks writing code'),
    `stage 5 says what approving opens; got: ${JSON.stringify(atFive[0])}`,
  );
  assert.ok(
    atFive[0].includes('1 repository (dev-harness)'),
    `stage 5 names the repository; got: ${JSON.stringify(atFive[0])}`,
  );

  assert.match(atSix[0], /tests-stage/, 'stage 6 names the branch');
  assert.ok(
    atSix[0].includes('failed as intended'),
    `stage 6 says what was checked; got: ${JSON.stringify(atSix[0])}`,
  );
  assert.ok(
    atSix[0].includes('moves on to writing the code'),
    `stage 6 says what accepting causes; got: ${JSON.stringify(atSix[0])}`,
  );
});

// ---------------------------------------------------------------- the records agree

test('45 — finish_task points at stage 9 as the dialog that authorises', async () => {
  const { cwd } = at('unauthorised', { stage: 10, repos: ['dev-harness'] });

  // finish_task refuses here, and callTool rejects on a refusal, so the message is
  // read off the rejection.
  const message = await callTool('finish_task', { cwd }).then(
    (text) => assert.fail(`finish_task should have refused an unauthorised task; it said: ${text}`),
    (err) => err.message,
  );

  assert.match(message, /stage 9/, 'it names stage 9 as the dialog that authorises');
  assert.doesNotMatch(message, /stage 10/, 'stage 10 no longer has a dialog to point at');
});

test('46 — reopening a finished ticket returns it to stage 9', async () => {
  const project = makeProject({ repos: ['dev-harness'] });
  seedTickets(project, [
    ticket(project, 'shipped-once', {
      stage: 10,
      status: 'done',
      repos: ['dev-harness'],
      finished_at: '2026-01-01T00:00:00.000Z',
      authorised_at: '2026-01-01T00:00:00.000Z',
      pull_requests: ['https://example.invalid/pr/1'],
    }),
  ]);

  await callTool(
    'set_ticket_status',
    { cwd: project, branch: 'shipped-once', status: 'active', reason: 'a hole turned up' },
    { answer: 'accept' },
  );

  const t = read(project, 'shipped-once');
  assert.equal(t.status, 'active');
  assert.equal(t.stage, 9, 'stage 9 holds the only dialog that can authorise it again');
  assert.ok(!t.finished_at, 'finished_at is cleared');
  assert.ok(!t.authorised_at, 'authorised_at is cleared');
  assert.deepEqual(t.pull_requests, ['https://example.invalid/pr/1'], 'those pull requests exist');
  assert.deepEqual(
    t.history.map((h) => [h.from, h.to]),
    [[10, 9]],
    'the history records the rollback, not 9 -> 9',
  );
});

test('47 — the stage table carries the design', () => {
  for (const n of [5, 6, 9]) {
    assert.ok(stage(n).needsUser, `stage ${n} ends in a dialog`);
    assert.equal(typeof stage(n).dialog, 'function', `stage ${n} holds its own wording`);
  }

  assert.ok(!stage(10).needsUser, 'stage 10 asks nothing');
  assert.equal(stage(10).dialog, undefined, 'stage 10 has no wording, because it has no question');

  assert.deepEqual(
    STAGES.filter((s) => s.authorises).map((s) => s.n),
    [9],
    'exactly one stage authorises sending the work out, and it is the one the user answers',
  );
});

test('48 — nothing still claims a dialog at stage 10', () => {
  // The phrases are literal rather than a pattern over "stage 10", because ADRs 0006
  // and 0007 have to mention stage 10 in order to say it has no dialog.
  const stale = [
    'four stages',
    'four ending in a dialog',
    'the stage 10 dialog',
    'stage 10 authorisation',
    'advance_stage at stage 10',
    'authorises the pull request at stage 10',
  ];

  // This is the only test that reaches the server's tool descriptions and result
  // messages; no behavioural test reads them.
  const walk = (dir, found = []) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'test') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (name.endsWith('.md') || name.endsWith('.mjs')) found.push(full);
    }
    return found;
  };

  const offenders = [];
  for (const file of walk(REPO)) {
    const text = readFileSync(file, 'utf8');
    for (const phrase of stale) {
      if (text.includes(phrase)) {
        offenders.push(`${file.slice(REPO.length + 1).split('\\').join('/')}: ${phrase}`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'these still describe the two-dialog procedure');
});
