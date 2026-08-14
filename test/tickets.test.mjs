// Test cases 12-33: a ticket's life of its own — written down before the work,
// reopened after it, archived out of the way, and listed in a table that shows the
// live ones.
//
// The rule under most of these: the stage flow owns `done`, and management owns
// everything else. See docs/adr/0006-management-cannot-produce-done.md.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { describe as describeStage, stage } from '../lib/stages.mjs';
import { newTicket, writeTicket } from '../lib/store.mjs';
import { REPO, callTool, callTools, cleanup, listTools, makeProject, seedTickets } from './helpers.mjs';

after(cleanup);

const ticketFile = (project, branch) => `${project}/tickets/${branch}.json`;
const archiveFile = (project, branch) => `${project}/tickets/archive/${branch}.json`;
const read = (project, branch) => JSON.parse(readFileSync(ticketFile(project, branch), 'utf8'));

/** A ticket at whatever point in its life the test needs. */
function ticket(project, branch, fields = {}) {
  return { ...newTicket({ project, branch, description: branch }), ...fields };
}

// ---------------------------------------------------------------- backlog

test('12 — add_ticket writes a backlog entry and creates no workspace', async () => {
  const project = makeProject();
  await callTool('add_ticket', { cwd: project, branch: 'search-my-notes', description: 'notes are unfindable' });

  const t = read(project, 'search-my-notes');
  assert.equal(t.stage, 0, 'a backlog entry is at stage 0');
  assert.equal(t.status, 'active', 'a backlog entry is unfinished work');
  assert.equal(t.workspace, null);
  assert.deepEqual(t.repos, []);
  assert.equal(t.description, 'notes are unfindable');

  assert.ok(!existsSync(`${project}/search-my-notes`), 'no workspace directory');
  assert.ok(!existsSync(`${project}/search-my-notes/task.md`), 'no task document');
});

test('13 — add_ticket refuses a branch that already has a ticket', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'taken', { description: 'the original' })]);
  const before = readFileSync(ticketFile(project, 'taken'), 'utf8');

  await assert.rejects(
    callTool('add_ticket', { cwd: project, branch: 'taken', description: 'the impostor' }),
    /taken/,
  );
  assert.equal(readFileSync(ticketFile(project, 'taken'), 'utf8'), before, 'the existing ticket is untouched');
});

test('14 — stage 0 is backlog, and is not a stage of the procedure', () => {
  assert.equal(describeStage(0), 'backlog');
  assert.equal(stage(0), null, 'nothing in the stage machine should find a backlog entry by asking for stage 0');
});

test('15 — start_task adopts a backlog ticket of the same branch', async () => {
  const project = makeProject();
  const seeded = ticket(project, 'search-my-notes', {
    stage: 0,
    workspace: null,
    description: 'notes are unfindable',
    created_at: '2020-01-01T00:00:00.000Z',
  });
  seedTickets(project, [seeded]);

  // A different description on the way in: the backlog entry is what it was about.
  await callTool('start_task', {
    cwd: project,
    branch: 'search-my-notes',
    description: 'something else entirely',
    session_id: 'sess-adopted',
  });

  const t = read(project, 'search-my-notes');
  assert.equal(t.stage, 1, 'the adopted ticket is at stage 1');
  assert.equal(t.workspace, `${project}/search-my-notes`);
  assert.equal(t.created_at, '2020-01-01T00:00:00.000Z', 'the original created_at survives');
  assert.equal(t.description, 'notes are unfindable', 'the backlog description is the one of record');

  const doc = readFileSync(`${project}/search-my-notes/task.md`, 'utf8');
  assert.match(doc, /notes are unfindable/, 'the task document says the same thing as the ticket');
  assert.doesNotMatch(doc, /something else entirely/);
});

test('16 — start_task still refuses a branch whose task has already begun', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'under-way', { stage: 4 })]);
  const before = readFileSync(ticketFile(project, 'under-way'), 'utf8');

  await assert.rejects(
    callTool('start_task', { cwd: project, branch: 'under-way', description: 'again' }),
    /under-way/,
  );
  assert.equal(readFileSync(ticketFile(project, 'under-way'), 'utf8'), before);
});

// ---------------------------------------------------------------- status

test('17 — set_ticket_status reopens an abandoned ticket once the user accepts', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'dropped', { status: 'abandoned', stage: 3 })]);

  await callTool(
    'set_ticket_status',
    { cwd: project, branch: 'dropped', status: 'active', reason: 'the customer came back' },
    { answer: 'accept' },
  );

  const t = read(project, 'dropped');
  assert.equal(t.status, 'active');
  const last = t.history.at(-1);
  assert.ok(last, 'the change is recorded in history');
  assert.match(JSON.stringify(last), /the customer came back/, 'the reason is recorded');
});

test('18 — set_ticket_status cannot produce done', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'nearly', { stage: 9 })]);
  const before = readFileSync(ticketFile(project, 'nearly'), 'utf8');

  await assert.rejects(
    callTool(
      'set_ticket_status',
      { cwd: project, branch: 'nearly', status: 'done', reason: 'close enough' },
      { answer: 'accept' },
    ),
    /finish_task/,
    'the refusal names the tool that does produce done',
  );
  assert.equal(readFileSync(ticketFile(project, 'nearly'), 'utf8'), before);
});

test('19 — a declined status change leaves the ticket byte-identical', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'dropped', { status: 'abandoned', stage: 3 })]);
  const before = readFileSync(ticketFile(project, 'dropped'), 'utf8');

  await callTool(
    'set_ticket_status',
    { cwd: project, branch: 'dropped', status: 'active', reason: 'on second thoughts' },
    { answer: 'decline' },
  );

  assert.equal(readFileSync(ticketFile(project, 'dropped'), 'utf8'), before);
});

test('20 — set_ticket_status on a branch with no ticket is refused by name', async () => {
  const project = makeProject();
  await assert.rejects(
    callTool(
      'set_ticket_status',
      { cwd: project, branch: 'never-existed', status: 'abandoned', reason: 'x' },
      { answer: 'accept' },
    ),
    /never-existed/,
  );
});

test('21 — writeTicket refuses a status or stage no reader could classify', () => {
  const project = makeProject();

  assert.throws(() => writeTicket(ticket(project, 'bad-status', { status: 'paused' })), /paused|status/i);
  assert.ok(!existsSync(ticketFile(project, 'bad-status')), 'no file is written');

  assert.throws(() => writeTicket(ticket(project, 'bad-stage', { stage: 11 })), /stage/i);
  assert.ok(!existsSync(ticketFile(project, 'bad-stage')), 'no file is written');
});

test('21b — reopening a done ticket clears the marks of finishing', async () => {
  const project = makeProject();
  seedTickets(project, [
    ticket(project, 'shipped', {
      status: 'done',
      stage: 10,
      finished_at: '2026-01-01T00:00:00.000Z',
      authorised_at: '2026-01-01T00:00:00.000Z',
      pull_requests: ['https://example.invalid/pr/1'],
    }),
  ]);

  await callTool(
    'set_ticket_status',
    { cwd: project, branch: 'shipped', status: 'active', reason: 'review found a hole' },
    { answer: 'accept' },
  );

  const t = read(project, 'shipped');
  assert.equal(t.status, 'active');
  assert.equal(t.stage, 10, 'the work is back in hand at the stage it stopped at');
  assert.ok(!t.finished_at, 'finished_at is cleared');
  assert.ok(!t.authorised_at, 'sending it out again must go through the stage 10 dialog again');
  assert.deepEqual(t.pull_requests, ['https://example.invalid/pr/1'], 'those pull requests exist');
});

test('21c — a branch name that could escape the tickets directory is refused', async () => {
  const project = makeProject();
  const before = readdirSync(project).sort();

  for (const branch of ['../escape', 'sub/dir', '.hidden', 'dotted.name', 'Upper-Case']) {
    await assert.rejects(
      callTool('add_ticket', { cwd: project, branch, description: 'x' }),
      /branch/i,
      `add_ticket must refuse ${branch}`,
    );
    await assert.rejects(
      callTool('start_task', { cwd: project, branch, description: 'x' }),
      /branch/i,
      `start_task must refuse ${branch}`,
    );
  }

  assert.deepEqual(readdirSync(project).sort(), before, 'nothing appeared in the project');
  assert.deepEqual(readdirSync(`${project}/tickets`), [], 'no ticket file was written');
});

test('21d — management tools are addressed by branch, from anywhere in the project', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'elsewhere', { status: 'abandoned', stage: 2 })]);

  // The project root is not any task's workspace: every stage tool refuses here.
  await callTool(
    'set_ticket_status',
    { cwd: project, branch: 'elsewhere', status: 'active', reason: 'picked it back up' },
    { answer: 'accept' },
  );
  assert.equal(read(project, 'elsewhere').status, 'active');

  await callTool('archive_ticket', { cwd: project, branch: 'elsewhere' }, { answer: 'accept' });
  assert.ok(existsSync(archiveFile(project, 'elsewhere')));
});

// ---------------------------------------------------------------- archive

test('22 — archive_ticket moves the file and touches nothing else', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'old-news', { status: 'abandoned', stage: 1 })]);
  const content = readFileSync(ticketFile(project, 'old-news'), 'utf8');
  writeFileSync(`${project}/old-news-workspace-marker`, 'still here', 'utf8');

  await callTool('archive_ticket', { cwd: project, branch: 'old-news' }, { answer: 'accept' });

  assert.ok(!existsSync(ticketFile(project, 'old-news')), 'the ticket has left the listing directory');
  assert.equal(readFileSync(archiveFile(project, 'old-news'), 'utf8'), content, 'the content is identical');
  assert.ok(existsSync(`${project}/old-news-workspace-marker`), 'nothing on disk was deleted');
});

test('23 — an archived ticket is in no listing, and is found when asked for', async () => {
  const project = makeProject();
  // Abandoned, because that is what cleanup is usually for: asking for the archive
  // is already asking for the finished-with, so no status filter may hide it.
  seedTickets(project, [ticket(project, 'shelved', { status: 'abandoned', stage: 2 })]);
  await callTool('archive_ticket', { cwd: project, branch: 'shelved' }, { answer: 'accept' });

  const [byDefault, all, archived] = await callTools([
    { name: 'find_ticket', arguments: { cwd: project } },
    { name: 'find_ticket', arguments: { cwd: project, status: 'all' } },
    { name: 'find_ticket', arguments: { cwd: project, archived: true } },
  ]);

  assert.doesNotMatch(byDefault, /shelved/);
  assert.doesNotMatch(all, /shelved/, 'even "all" means all the live ones');
  assert.match(archived, /shelved/);
});

test('24 — archive_ticket with restore brings it back', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'shelved', { status: 'active', stage: 2 })]);

  await callTool('archive_ticket', { cwd: project, branch: 'shelved' }, { answer: 'accept' });
  await callTool('archive_ticket', { cwd: project, branch: 'shelved', restore: true }, { answer: 'accept' });

  assert.ok(existsSync(ticketFile(project, 'shelved')));
  assert.ok(!existsSync(archiveFile(project, 'shelved')));
  assert.match(await callTool('find_ticket', { cwd: project }), /shelved/);
});

test('25 — a declined archive moves nothing', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'staying', { status: 'active', stage: 2 })]);

  await callTool('archive_ticket', { cwd: project, branch: 'staying' }, { answer: 'decline' });

  assert.ok(existsSync(ticketFile(project, 'staying')));
  assert.ok(!existsSync(archiveFile(project, 'staying')));
});

// ---------------------------------------------------------------- listing

/** The three kinds of ticket a listing has to tell apart. */
function seedThreeKinds(project) {
  return seedTickets(project, [
    ticket(project, 'live-one', { status: 'active', stage: 3, session_id: 'sess-live' }),
    ticket(project, 'backlog-one', { status: 'active', stage: 0, workspace: null, session_id: null }),
    ticket(project, 'done-one', { status: 'done', stage: 10 }),
    ticket(project, 'dropped-one', { status: 'abandoned', stage: 2 }),
  ]);
}

test('26 — the default listing is unfinished work only', async () => {
  const project = makeProject();
  seedThreeKinds(project);

  const listed = await callTool('find_ticket', { cwd: project });
  assert.match(listed, /live-one/);
  assert.match(listed, /backlog-one/, 'a backlog entry is unfinished work');
  assert.doesNotMatch(listed, /done-one/);
  assert.doesNotMatch(listed, /dropped-one/);
});

test('27 — status all returns every unarchived ticket', async () => {
  const project = makeProject();
  seedThreeKinds(project);

  const listed = await callTool('find_ticket', { cwd: project, status: 'all' });
  for (const branch of ['live-one', 'backlog-one', 'done-one', 'dropped-one']) {
    assert.match(listed, new RegExp(branch));
  }
});

test('28 — the listing is a table that tells the three kinds apart', async () => {
  const project = makeProject();
  seedThreeKinds(project);

  const listed = await callTool('find_ticket', { cwd: project, status: 'all' });
  const lines = listed.split('\n').filter((l) => l.trim());
  const header = lines[0];

  for (const column of ['branch', 'status', 'stage', 'session', 'description']) {
    assert.match(header, new RegExp(column), `the header names the ${column} column`);
  }

  const row = (branch) => lines.find((l) => l.startsWith(branch));
  assert.match(row('backlog-one'), /\bbacklog\b/, 'stage 0 reads backlog');
  assert.match(row('live-one'), /\b3\/10\b/, 'a task in progress reads n/10');
  assert.match(row('done-one'), /\bdone\b/);
  assert.match(row('live-one'), /\byes\b/, 'a recorded session shows as yes');
  assert.match(row('backlog-one'), /—/, 'a missing session shows as a dash');
});

test('29 — a query matching one ticket returns the whole block instead', async () => {
  const project = makeProject();
  seedTickets(project, [
    ticket(project, 'only-match', {
      description: 'the unmistakable one',
      stage: 3,
      session_id: 'sess-only',
    }),
    ticket(project, 'other', { description: 'something else entirely' }),
  ]);

  const [found, listed] = await callTools([
    { name: 'find_ticket', arguments: { cwd: project, query: 'unmistakable' } },
    { name: 'find_ticket', arguments: { cwd: project } },
  ]);

  assert.match(found, /sess-only/, 'the session to resume');
  assert.match(found, new RegExp(`${project}/only-match`.replace(/[/\\]/g, '.')), 'the workspace to return to');
  assert.doesNotMatch(listed, /sess-only/, 'a listing of several is a table, not a block each');
  assert.doesNotMatch(listed, /workspace:/, 'the table has no workspace column');
});

test('30 — a long description is truncated and the columns before it stay aligned', async () => {
  const project = makeProject();
  seedTickets(project, [
    ticket(project, 'a', { description: 'x'.repeat(200), stage: 1 }),
    ticket(project, 'a-much-longer-branch-name', { description: 'short', stage: 2 }),
  ]);

  const lines = (await callTool('find_ticket', { cwd: project })).split('\n').filter((l) => l.trim());
  const at = lines[0].indexOf('description');
  assert.ok(at > 0, 'the header has a description column');

  for (const line of lines.slice(1)) {
    assert.equal(
      line.slice(0, at),
      line.slice(0, at).padEnd(at),
      'every row reaches the description column at the same offset',
    );
    assert.ok(line.length - at <= 61, `the description is truncated, not ${line.length - at} characters`);
  }
  assert.ok(!lines.some((l) => l.includes('x'.repeat(80))), 'the 200-character description was cut');
});

// ------------------------------------------------- found by the stage 8 review

test('34 — a listing of one is still a table', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'the-only-one', { stage: 3, session_id: 'sess-x' })]);

  const listed = await callTool('find_ticket', { cwd: project });
  assert.match(listed, /branch\s+status/, 'the shape of the answer does not depend on how many tasks exist');
  assert.doesNotMatch(listed, /workspace:/);
});

test('35 — an archived branch name is still taken', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'put-away', { status: 'abandoned', stage: 2 })]);
  await callTool('archive_ticket', { cwd: project, branch: 'put-away' }, { answer: 'accept' });
  const archived = readFileSync(archiveFile(project, 'put-away'), 'utf8');

  await assert.rejects(
    callTool('add_ticket', { cwd: project, branch: 'put-away', description: 'a new one' }),
    /archive/i,
    'the refusal says where the name went',
  );
  await assert.rejects(
    callTool('start_task', { cwd: project, branch: 'put-away', description: 'a new one' }),
    /archive/i,
  );

  assert.equal(readFileSync(archiveFile(project, 'put-away'), 'utf8'), archived, 'the archived ticket is untouched');
  assert.ok(!existsSync(ticketFile(project, 'put-away')), 'and nothing took its place');
});

test('36 — a restore never writes over a ticket that is already there', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'twice', { status: 'abandoned', stage: 2 })]);
  await callTool('archive_ticket', { cwd: project, branch: 'twice' }, { answer: 'accept' });

  // Only reachable by hand, which is exactly when nothing may be lost.
  seedTickets(project, [ticket(project, 'twice', { description: 'the live one', stage: 4 })]);
  const live = readFileSync(ticketFile(project, 'twice'), 'utf8');
  const archived = readFileSync(archiveFile(project, 'twice'), 'utf8');

  // No `answer`: an unexpected dialog is cancelled, so the tool would report a
  // decline rather than a refusal. The user is not asked to authorise the
  // impossible.
  await assert.rejects(
    callTool('archive_ticket', { cwd: project, branch: 'twice', restore: true }),
    /write over it|already in the listing/i,
  );
  assert.equal(readFileSync(ticketFile(project, 'twice'), 'utf8'), live, 'both survive');
  assert.equal(readFileSync(archiveFile(project, 'twice'), 'utf8'), archived);
});

test('37 — find_ticket refuses a status it does not have', async () => {
  const project = makeProject();
  seedTickets(project, [ticket(project, 'live-one', { stage: 3 })]);

  await assert.rejects(
    callTool('find_ticket', { cwd: project, status: 'paused' }),
    /paused/,
    'a typo must not look like an empty project',
  );
});

// ---------------------------------------------------------------- surface

test('31 — the server advertises the three management tools with their arguments', async () => {
  const tools = await listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  assert.ok(byName.add_ticket, 'add_ticket is advertised');
  assert.ok(byName.add_ticket.inputSchema.properties.branch);
  assert.ok(byName.add_ticket.inputSchema.properties.description);

  assert.ok(byName.set_ticket_status, 'set_ticket_status is advertised');
  assert.ok(byName.set_ticket_status.inputSchema.properties.branch);
  assert.ok(byName.set_ticket_status.inputSchema.properties.status);
  assert.ok(byName.set_ticket_status.inputSchema.properties.reason);

  assert.ok(byName.archive_ticket, 'archive_ticket is advertised');
  assert.ok(byName.archive_ticket.inputSchema.properties.branch);
  assert.ok(byName.archive_ticket.inputSchema.properties.restore);

  assert.ok(byName.find_ticket.inputSchema.properties.archived, 'find_ticket can read the archive');

  // The schemas are how Claude learns what it may ask for, so the bounds the design
  // puts on the tools have to be in them, not only in the handlers.
  assert.equal(tools.length, 11, 'eight stage tools and three management ones');
  assert.deepEqual(
    byName.set_ticket_status.inputSchema.properties.status.enum,
    ['active', 'abandoned'],
    'done is not offered: it is what finish_task produces',
  );
  assert.deepEqual(byName.find_ticket.inputSchema.properties.status.enum, [
    'active',
    'done',
    'abandoned',
    'all',
  ]);
});

test('32 — the architecture document describes the lifecycle it now has', () => {
  const architecture = readFileSync(join(REPO, 'docs/architecture.md'), 'utf8');

  assert.doesNotMatch(
    architecture,
    /Managing them — listing, filtering by status, cleaning up finished\s+ones — is a later addition/,
  );
  assert.doesNotMatch(architecture, /No workspace or ticket lifecycle management in version one/);
  assert.match(architecture, /eleven tools/);
  for (const tool of ['add_ticket', 'set_ticket_status', 'archive_ticket']) {
    assert.match(architecture, new RegExp(`\`${tool}\``), `the tool table lists ${tool}`);
  }
  assert.match(architecture, /No deletion, of anything, ever/, 'it still promises nothing is deleted');

  const product = readFileSync(join(REPO, 'docs/product.md'), 'utf8').split(/\r?\n/).length;
  assert.ok(product <= 200, `docs/product.md is ${product} lines; the limit is about 200`);
});

test('33 — the tickets skill names the new tools and says to print the table as it came', () => {
  const skill = readFileSync(join(REPO, 'skills/tickets/SKILL.md'), 'utf8');

  for (const tool of ['add_ticket', 'set_ticket_status', 'archive_ticket']) {
    assert.match(skill, new RegExp(tool), `the skill must name ${tool}`);
  }
  assert.match(skill, /table/i, 'the skill must say the listing is a table');
  assert.match(
    skill,
    /add nothing|as it came|verbatim|do not restate/i,
    'the skill must tell Claude to print it rather than retell it',
  );
});
