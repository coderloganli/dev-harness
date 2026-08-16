// Test cases 49-52: the one refusal, driven the way Claude Code drives it — as a
// child process fed a PreToolUse event on stdin.
//
// The refusal is a path comparison, so its failure mode is not an error: a path it
// fails to recognise is classified `outside`, and `outside` is allowed. These cases
// spell one file every way a caller might and insist the answer never changes.
//
// What makes that safe today is that both sides of the comparison come from the same
// string: the guard hands `context()` the target's own directory, and compares the
// target against the workspace that call derived. Case, separators and dot segments
// therefore cannot disagree. Case 50 holds that property, which is a property of the
// call site rather than of `classify`, and so could be lost by a caller that passed a
// workspace from anywhere else.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { REPO, cleanup, makeProject } from './helpers.mjs';

const GUARD = join(REPO, 'scripts', 'guard-write.mjs');

after(cleanup);

/** A project with one active task at stage 3 — before the design is approved. */
function projectAtStage(stage) {
  const root = makeProject();
  const branch = 'add-note-search';
  mkdirSync(join(root, branch, 'api', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'tickets', `${branch}.json`),
    JSON.stringify({
      branch,
      description: 'a task',
      project: root,
      workspace: `${root}/${branch}`,
      repos: ['api'],
      session_id: null,
      stage,
      status: 'active',
      created_at: new Date().toISOString(),
      history: [],
    }),
  );
  return { root, workspace: `${root}/${branch}` };
}

/** Ask the guard about one write. Returns 'deny' or 'allow'. */
function ask(filePath) {
  const event = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } });
  const { stdout } = spawnSync(process.execPath, [GUARD], { input: event, encoding: 'utf8' });
  if (!stdout.trim()) return 'allow';
  return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? 'allow';
}

test('49 — a write inside a repository is refused before the design is approved', () => {
  const { workspace } = projectAtStage(3);
  assert.equal(ask(`${workspace}/api/src/search.ts`), 'deny');
});

test('50 — the refusal does not depend on how the path is spelled', () => {
  const { workspace } = projectAtStage(3);
  const target = `${workspace}/api/src/search.ts`;

  const spellings = [
    ['separators', target.split('/').join('\\')],
    ['dot segments', `${workspace}/api/../api/src/search.ts`],
    ['a trailing dot segment', `${workspace}/api/src/./search.ts`],
  ];

  // Windows paths are case-insensitive, so these name the same file. On a
  // case-sensitive file system they name different files and must not be folded.
  if (process.platform === 'win32') {
    spellings.push(
      ['a lower-case drive letter', target[0].toLowerCase() + target.slice(1)],
      ['an upper-cased segment', target.replace('/api/', '/API/')],
      ['an upper-cased workspace', target.replace(workspace, workspace.toUpperCase())],
    );
  }

  for (const [how, spelling] of spellings) {
    assert.equal(ask(spelling), 'deny', `a path written with ${how} reached the file unrefused`);
  }
});

test('51 — the documentation paths stay writable, however they are spelled', () => {
  const { workspace } = projectAtStage(3);
  const writable = [
    `${workspace}/task.md`,
    `${workspace}/api/docs/architecture.md`,
    `${workspace}/api/docs/product.md`,
    `${workspace}/api/docs/adr/0001-a-decision.md`,
  ];

  for (const path of writable) {
    assert.equal(ask(path), 'allow', `${path} must stay writable in every stage`);
    assert.equal(ask(path.split('/').join('\\')), 'allow', `${path} must stay writable in every stage`);
  }

  // After the design is approved nothing is refused at all.
  const approved = projectAtStage(6);
  assert.equal(ask(`${approved.workspace}/api/src/search.ts`), 'allow');
});

test('52 — a ticket the guard cannot read leaves the write unrefused', () => {
  // Asserted because it is the design, not because it is desirable: a guard that
  // cannot tell what stage a task is at allows the write rather than freezing the
  // project. The same is true of a crashed or timed-out hook, which Claude Code
  // treats as no decision. See docs/architecture.md §10 — this test exists so that
  // degradation is a stated property with a case behind it, rather than something a
  // reader has to infer from a `catch {}`.
  const { root, workspace } = projectAtStage(3);
  assert.equal(ask(`${workspace}/api/src/search.ts`), 'deny');

  writeFileSync(join(root, 'tickets', 'add-note-search.json'), '{ not json');
  assert.equal(ask(`${workspace}/api/src/search.ts`), 'allow');
});
