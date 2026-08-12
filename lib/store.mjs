// Locating a project, a workspace, and a ticket from a directory, and reading and
// writing tickets.
//
// Everything here is derived from the file system rather than told to us, so the
// hooks and the server can each work it out for themselves instead of trusting a
// path that came from the model.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const TICKETS_DIR = 'tickets';
export const CONFIG_FILE = 'config.json';
export const BASE_WORKSPACE = 'main';
export const TASK_DOC = 'task.md';

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

export function ticketPath(project, branch) {
  return `${project}/${TICKETS_DIR}/${branch}.json`;
}

export function readTicket(project, branch) {
  const p = ticketPath(project, branch);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeTicket(ticket) {
  const p = ticketPath(ticket.project, ticket.branch);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(ticket, null, 2) + '\n', 'utf8');
  return p;
}

export function allTickets(project) {
  const dir = `${project}/${TICKETS_DIR}`;
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

export function newTicket({ project, branch, description }) {
  return {
    branch,
    description,
    project,
    workspace: `${project}/${branch}`,
    repos: [],
    session_id: null,
    stage: 1,
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
