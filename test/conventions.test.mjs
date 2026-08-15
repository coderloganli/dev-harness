// Test cases 9-11 and 38: conventions the plugin states about itself, asserted against the
// repository so that a fix cannot look done while a stale copy survives somewhere.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { REPO } from './helpers.mjs';

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

/** Every file under `dir` with one of these extensions, recursively. */
function walk(dir, exts, found = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'test') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, found);
    else if (exts.some((e) => name.endsWith(e))) found.push(full);
  }
  return found;
}

test('9 — the ADR README template exists, and init names both it and where it goes', () => {
  assert.ok(
    existsSync(join(REPO, 'skills/init/templates/adr-readme.md')),
    'skills/init/templates/adr-readme.md must exist, or init still creates an empty directory',
  );
  const skill = read('skills/init/SKILL.md');
  assert.match(skill, /adr-readme\.md/, 'init must name the template');
  assert.match(skill, /docs\/adr\/README\.md/, 'init must name where the template goes');
});

test('10 — no stale run naming survives', () => {
  const files = [
    ...walk(join(REPO, 'skills'), ['.md']),
    ...walk(join(REPO, 'docs'), ['.md']),
    join(REPO, 'lib/stages.mjs'),
    join(REPO, 'README.md'),
  ];
  const offenders = files.filter((f) => {
    const text = readFileSync(f, 'utf8');
    return /"run"\s*:/.test(text) || /\brun command\b/i.test(text);
  });
  assert.deepEqual(
    offenders.map((f) => f.slice(REPO.length + 1).split('\\').join('/')),
    [],
    'the stage 9 config value is named try; nothing should still call it a run command',
  );
});

test('11 — one product document, under 200 lines', () => {
  assert.ok(!existsSync(join(REPO, 'docs/prd.md')), 'docs/prd.md should be gone');
  assert.ok(existsSync(join(REPO, 'docs/product.md')), 'docs/product.md should exist');

  const lines = read('docs/product.md').split(/\r?\n/).length;
  assert.ok(lines <= 200, `docs/product.md is ${lines} lines; the limit is about 200`);

  const linking = [...walk(join(REPO, 'docs'), ['.md']), join(REPO, 'README.md')].filter((f) =>
    /docs\/prd\.md/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(
    linking.map((f) => f.slice(REPO.length + 1).split('\\').join('/')),
    [],
    'nothing should still link to docs/prd.md',
  );
});

test('38 — one version, declared in three files, and an install line that reaches it', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  const pkg = JSON.parse(read('package.json'));

  // The marketplace version is what tells an installed copy a newer one exists. A
  // release that bumps plugin.json alone ships to nobody, and nothing at runtime
  // would say so.
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, `marketplace.json must list a plugin named ${plugin.name}`);
  assert.equal(entry.version, plugin.version, 'the marketplace entry must carry the plugin.json version');
  assert.equal(pkg.version, plugin.version, 'package.json must carry the plugin.json version');

  // README tells the user to type `/plugin install <plugin>@<marketplace>`.
  assert.match(
    read('README.md'),
    new RegExp(`/plugin install ${plugin.name}@${marketplace.name}\\b`),
    'the README install line must name the plugin and the marketplace as they are declared',
  );
});
