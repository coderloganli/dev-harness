// Locating a project, a workspace, and a ticket from a directory, and reading and
// writing tickets.
//
// Everything here is derived from the file system rather than told to us, so the
// hooks and the server can each work it out for themselves instead of trusting a
// path that came from the model.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { LAST_STAGE } from './stages.mjs';

export const TICKETS_DIR = 'tickets';
export const ARCHIVE_DIR = 'tickets/archive';
export const CONFIG_FILE = 'config.json';
export const BASE_WORKSPACE = 'main';
export const TASK_DOC = 'task.md';

/** The three answers to "is this work still live". Stage says how far it has got. */
export const STATUSES = ['active', 'done', 'abandoned'];

/** A ticket written down before the work begins is active, at no stage. */
export const BACKLOG_STAGE = 0;

/** Paths inside a repository that stay writable in every stage. */
export const DOC_PATHS = ['docs/architecture.md', 'docs/product.md', 'docs/adr/'];

function norm(p) {
  return resolve(p).split(sep).join('/');
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk up from `from` looking for a project root: a directory containing both
 * `tickets/` and `main/`.
 */
export function findProject(from) {
  let dir = resolve(from);
  for (;;) {
    if (isDir(join(dir, TICKETS_DIR)) && isDir(join(dir, BASE_WORKSPACE))) return norm(dir);
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Resolve where a call is coming from.
 *
 * Returns `{ project, workspace, ticket }`, any of which may be null. A null
 * project means this directory has nothing to do with dev-harness, and every
 * caller treats that as "do nothing".
 */
export function context(cwd) {
  const project = findProject(cwd);
  if (!project) return { project: null, workspace: null, ticket: null };

  // The workspace is the immediate child of the project that contains this cwd.
  const rel = norm(cwd).slice(project.length + 1);
  const first = rel.split('/')[0];
  const workspace = first ? `${project}/${first}` : null;

  if (!workspace || first === TICKETS_DIR || first === BASE_WORKSPACE) {
    return { project, workspace: null, ticket: null };
  }
  return { project, workspace, ticket: readTicket(project, basename(workspace)) };
}

/**
 * A branch name is also a directory name and a file name, so it is checked once,
 * here, by everything that takes one.
 *
 * `add_ticket` is why this has to exist: every other tool taking a branch also
 * creates a directory from it, and a directory creation refuses the names that would
 * escape. A backlog entry creates nothing, so only this stands between the name and
 * a path.
 */
export function validBranch(name) {
  return typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 100;
}

export function ticketPath(project, branch, { archived = false } = {}) {
  return `${project}/${archived ? ARCHIVE_DIR : TICKETS_DIR}/${branch}.json`;
}

export function readTicket(project, branch, opts) {
  const p = ticketPath(project, branch, opts);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write a ticket, refusing one no reader could classify.
 *
 * Status and stage are what every other part of the plugin branches on — the
 * refusal hook, the stage machine, the listing — so a value outside their range
 * would not fail here, where it is written, but somewhere else, later, as silence.
 */
export function writeTicket(ticket) {
  if (!validBranch(ticket.branch)) throw new Error(`Not a usable branch name: ${ticket.branch}`);
  if (!STATUSES.includes(ticket.status))
    throw new Error(`Not a ticket status: ${ticket.status}. One of ${STATUSES.join(', ')}.`);
  if (!Number.isInteger(ticket.stage) || ticket.stage < BACKLOG_STAGE || ticket.stage > LAST_STAGE)
    throw new Error(`Not a stage: ${ticket.stage}. ${BACKLOG_STAGE} (backlog) to ${LAST_STAGE}.`);

  const p = ticketPath(ticket.project, ticket.branch);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(ticket, null, 2) + '\n', 'utf8');
  return p;
}

/**
 * Move a ticket into the archive, or back out of it.
 *
 * A move, never a delete: the ticket is the only record of what a workspace on disk
 * was for. That the archive is a directory rather than a field is what makes the
 * ordinary listing free — `allTickets` reads one directory, and archived tickets are
 * simply not in it (ADR 0005).
 */
export function moveTicket(project, branch, { restore = false } = {}) {
  const from = ticketPath(project, branch, { archived: restore });
  const to = ticketPath(project, branch, { archived: !restore });
  if (!existsSync(from)) return null;
  // Never over one ticket with another. rename() overwrites silently on POSIX, so
  // without this a restore could destroy the very thing archiving promised to keep.
  if (existsSync(to)) throw new Error(`${to} already exists; the move would overwrite it.`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return to;
}

export function allTickets(project, { archived = false } = {}) {
  const dir = `${project}/${archived ? ARCHIVE_DIR : TICKETS_DIR}`;
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * A new ticket. With `stage: BACKLOG_STAGE` it is a backlog entry: active, because
 * it is unfinished work, with no workspace, because no work has begun (ADR 0004).
 */
export function newTicket({ project, branch, description, session_id = null, stage = 1 }) {
  return {
    branch,
    description,
    project,
    workspace: stage === BACKLOG_STAGE ? null : `${project}/${branch}`,
    repos: [],
    session_id: session_id || null,
    stage,
    status: 'active',
    created_at: new Date().toISOString(),
    history: [],
  };
}

export function readConfig(project) {
  const p = `${project}/${CONFIG_FILE}`;
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Repositories are whatever directories live inside the base workspace.
 *
 * `main/` is always a container, one directory per repository, even when there is
 * only one. A task workspace has the same shape, so the task document can sit at
 * its root, outside every repository.
 */
export function listRepos(project) {
  const dir = `${project}/${BASE_WORKSPACE}`;
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter((name) => isDir(join(dir, name, '.git')) || existsSync(join(dir, name, '.git')));
}

/**
 * True when `main/` is itself a checkout rather than a container of them. This is
 * the one layout mistake worth naming precisely, because it looks like a working
 * project right up until nothing can be found in it.
 */
export function baseIsRepo(project) {
  return existsSync(`${project}/${BASE_WORKSPACE}/.git`);
}

/**
 * Classify a path being written to, relative to a task workspace.
 *
 * Returns `outside` when the path is not in this workspace at all, `task` for
 * anything at the workspace root (the task document lives there and is outside
 * every repository), `doc` for the three conventional documentation paths, and
 * `repo` for everything else inside a repository.
 */
export function classify(workspace, filePath) {
  const ws = norm(workspace);
  const p = norm(filePath);
  if (!p.startsWith(ws + '/')) return 'outside';

  const rel = p.slice(ws.length + 1);
  const parts = rel.split('/');
  if (parts.length === 1) return 'task';

  const inRepo = parts.slice(1).join('/');
  for (const doc of DOC_PATHS) {
    if (doc.endsWith('/') ? inRepo.startsWith(doc) : inRepo === doc) return 'doc';
  }
  return 'repo';
}
