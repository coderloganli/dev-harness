// Test cases 6-8: the README that keeps the decision-record directory alive must
// not become the first result of every search.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';

import { callTools, cleanup, makeProject } from './helpers.mjs';

after(cleanup);

const README = `# Decision records

One decision per file: context, decision, reasoning. Search these rather than
browsing them. Records are edited in place when a decision changes.
`;

const RECORD = `# The cache is SQLite

summary: the cache is a single SQLite file rather than a running service

## Context

Every deployment already ships a writable directory.

## Decision

SQLite, one file.

## Reasoning

A running service would be one more thing to operate for a cache that fits on disk.
`;

/** A project with a decision-record directory holding a README and, optionally, one record. */
function projectWithAdr({ withRecord = true } = {}) {
  const project = makeProject();
  const adr = `${project}/main/api/docs/adr`;
  mkdirSync(adr, { recursive: true });
  writeFileSync(`${adr}/README.md`, README);
  if (withRecord) writeFileSync(`${adr}/0001-the-cache-is-sqlite.md`, RECORD);
  return project;
}

/**
 * Search from a task at stage 1. No stages are advanced: find_adr falls back to
 * every repository in the project when a ticket has not settled its own, and an
 * earlier version of this fixture pushed the task through stages it had produced
 * nothing for. The server refused those calls; the helper swallowed the refusals.
 */
async function searchAdr(project, query) {
  const [, found] = await callTools([
    { name: 'start_task', arguments: { cwd: project, branch: 'task', description: 'a task' } },
    { name: 'find_adr', arguments: { cwd: `${project}/task`, query } },
  ]);
  return found;
}

test('6 — find_adr skips the README', async () => {
  const project = projectWithAdr();
  // "decision" and "records" appear in the README as well as the record.
  const found = await searchAdr(project, 'decision records');
  assert.doesNotMatch(found, /README/);
});

test('7 — find_adr still finds decisions', async () => {
  const project = projectWithAdr();
  const found = await searchAdr(project, 'sqlite cache');
  assert.match(found, /0001-the-cache-is-sqlite\.md/);
  assert.match(found, /The cache is SQLite/);
  assert.match(found, /single SQLite file/);
});

test('8 — a directory holding only a README matches nothing', async () => {
  const project = projectWithAdr({ withRecord: false });
  const found = await searchAdr(project, 'decision records');
  assert.match(found, /No decision record matched/);
});
