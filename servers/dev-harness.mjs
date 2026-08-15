// The dev-harness MCP server.
//
// It owns the stage of every task. Claude can ask to advance; only this server
// advances, and for the stages that need the user it raises the dialog itself, so
// the wording is never something Claude wrote and the answer never passes through
// Claude on its way back.

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';

import { LAST_STAGE, describe, stage } from '../lib/stages.mjs';
import {
  ARCHIVE_DIR,
  BACKLOG_STAGE,
  BASE_WORKSPACE,
  STATUSES,
  TASK_DOC,
  allTickets,
  baseIsRepo,
  context,
  findProject,
  listRepos,
  moveTicket,
  newTicket,
  readConfig,
  readTicket,
  validBranch,
  writeTicket,
} from '../lib/store.mjs';

/** What to tell the caller about the repositories in a project. */
function reposLine(project) {
  const repos = listRepos(project);
  if (repos.length) return `Repositories available: ${repos.join(', ')}.`;
  if (baseIsRepo(project))
    return (
      `No repositories found. ${BASE_WORKSPACE}/ is itself a git checkout, but dev-harness expects it to be a ` +
      `container with one directory per repository — ${BASE_WORKSPACE}/<name>/ — so that a task workspace has the ` +
      `same shape and the task document can sit at its root, outside every repository. Move the checkout down one ` +
      `level and try again.`
    );
  return `No repositories found under ${BASE_WORKSPACE}/.`;
}

// ---------------------------------------------------------------- transport

// Workspaces with an advance_stage in flight. A stage that raises a dialog stays
// open until the user answers, so a second advance is turned away, not queued.
const advancing = new Set();

const pending = new Map();
let nextRequestId = 1;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function elicit(message) {
  const id = `dh-${nextRequestId++}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // An empty schema means the dialog has no fields, so accepting is one action.
    send({
      jsonrpc: '2.0',
      id,
      method: 'elicitation/create',
      params: { message, requestedSchema: { type: 'object', properties: {} } },
    });
  });
}

const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

/**
 * A branch name is taken if any ticket holds it, archived or not. An archived ticket
 * is still a ticket — it can be restored, and restoring it must not find its name
 * used by something else.
 */
function takenBy(project, branch) {
  const live = readTicket(project, branch);
  if (live) return { ticket: live, archived: false };
  const archived = readTicket(project, branch, { archived: true });
  return archived ? { ticket: archived, archived: true } : null;
}

const inTheArchive = (branch) =>
  `${branch} is in the archive — archiving deletes nothing, so the name is still taken. ` +
  `Bring it back with archive_ticket restore: true, or pick another branch name.`;

const badBranch = (branch) =>
  `Not a usable branch name: ${JSON.stringify(branch)}. A branch name is also a directory name and a ` +
  `file name, so it is lower-case letters, digits and hyphens — no separators, no leading dot, no "..".`;

// ---------------------------------------------------------------- the listing

const DESCRIPTION_WIDTH = 60;

/** How far along a ticket is, in the width of a word rather than a sentence. */
function stageCell(t) {
  if (t.stage === BACKLOG_STAGE) return 'backlog';
  if (t.status === 'done') return 'done';
  return `${t.stage}/${LAST_STAGE}`;
}

/**
 * A table, one row per ticket.
 *
 * The description is last and truncated, so the one column whose width nothing
 * controls cannot push the columns before it out of line.
 */
function table(rows) {
  const cells = rows.map((t) => [
    t.branch,
    t.status,
    stageCell(t),
    t.session_id ? 'yes' : '—',
    t.description.replace(/\s+/g, ' ').trim(),
  ]);
  const header = ['branch', 'status', 'stage', 'session', 'description'];
  const widths = header
    .slice(0, -1)
    .map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));

  const line = (c) =>
    c
      .slice(0, -1)
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ') +
    '  ' +
    (c[4].length > DESCRIPTION_WIDTH ? c[4].slice(0, DESCRIPTION_WIDTH) + '…' : c[4]);

  return [line(header), ...cells.map(line)].join('\n');
}

/** Everything about one ticket, for someone trying to get back into it. */
function block(t) {
  return [
    `${t.branch} — ${t.status}, ${describe(t.stage)}`,
    `  ${t.description}`,
    `  workspace: ${t.workspace ?? '(not started)'}`,
    `  session: ${t.session_id ?? '(not recorded)'}`,
    t.repos?.length ? `  repositories: ${t.repos.join(', ')}` : '',
    t.pull_requests?.length ? `  pull requests: ${t.pull_requests.join(', ')}` : '',
    t.history?.length
      ? `  history:\n${t.history.map((h) => `    ${h.at} ${h.from} -> ${h.to}${h.note ? ` (${h.note})` : ''}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------- task document

function taskDoc(workspace) {
  const p = join(workspace, TASK_DOC);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** Return the body under a `## Heading`, or null when the heading is absent. */
function section(markdown, heading) {
  if (!markdown) return null;
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

function hasContent(markdown, heading) {
  const body = section(markdown, heading);
  return Boolean(body && body.length > 20);
}

// ---------------------------------------------------------------- stage checks

/**
 * Formality checks: did this stage produce anything. Never a judgement about
 * quality — that is what the codex stages and the user dialogs are for.
 */
function checkStage(n, { ticket, workspace, config, args }) {
  const doc = taskDoc(workspace);
  switch (stage(n)?.requires) {
    case 'taskDocExists':
      return doc ? null : `${TASK_DOC} does not exist yet at the workspace root.`;

    case 'requirementAndRepos': {
      if (!hasContent(doc, 'Requirement'))
        return `${TASK_DOC} has no Requirement section with anything in it.`;
      const repos = args.repos ?? ticket.repos;
      if (!repos?.length)
        return 'No repositories settled yet. Pass repos: ["api", "web"] once the interview has decided.';
      return null;
    }

    case 'designAndTestCases':
      if (!hasContent(doc, 'Design')) return `${TASK_DOC} has no Design section with anything in it.`;
      if (!hasContent(doc, 'Test cases')) return `${TASK_DOC} has no Test cases section with anything in it.`;
      return null;

    case 'codexDesignVerdict':
    case 'codexCodeVerdict':
      if (config.codex === false) return null; // skipped, not passed
      return args.evidence
        ? null
        : 'Pass evidence: the codex verdict, and how each finding was resolved.';

    case 'testsRanAndFailed':
      return args.evidence
        ? null
        : 'Pass evidence: the test command that was run and the failure output it produced.';

    case 'suiteGreen':
      return args.evidence ? null : 'Pass evidence: the test command and its passing output.';

    default:
      return null;
  }
}

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: 'start_task',
    description:
      'Create a task: its workspace directory, its ticket, and its task document. Call once, at stage 1.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'A directory inside the project.' },
        branch: { type: 'string', description: 'Branch name, kebab-case, names the outcome.' },
        description: { type: 'string', description: "The problem, in the user's own words." },
        session_id: {
          type: 'string',
          description:
            'The current Claude session id, so the ticket can offer a resume later. Read it from ' +
            'CLAUDE_CODE_SESSION_ID in a shell call — this server does not receive it.',
        },
      },
      required: ['branch', 'description'],
    },
  },
  {
    name: 'advance_stage',
    description:
      'Ask to move the current task to the next stage. The server checks the stage produced ' +
      'something and, for stages that need the user, asks them. Returns the new stage and what it calls for.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'A directory inside the task workspace.' },
        repos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Leaving stage 2: the repositories this task touches.',
        },
        evidence: {
          type: 'string',
          description: 'Stages that need it: the command that was run and its output.',
        },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Report the current task: stage, workspace, repositories, and what is refused.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } },
  },
  {
    name: 'find_adr',
    description:
      'Search decision records across this task\'s repositories. Returns titles, summaries, and paths; read the few that matter.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        query: { type: 'string', description: 'Words describing the decision you are looking for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_ticket',
    description:
      'Search tickets by what the task was about, or list them when no query is given. Unfinished ' +
      'work only unless asked otherwise. Returns a table, or the whole ticket when one matches.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        query: { type: 'string', description: 'Words from the task description. Omit to list everything.' },
        status: {
          type: 'string',
          enum: ['active', 'done', 'abandoned', 'all'],
          description: 'Defaults to active, which includes backlog entries. "all" is every unarchived ticket.',
        },
        archived: {
          type: 'boolean',
          description: 'Read the archive instead. Archived tickets appear in no other listing.',
        },
      },
    },
  },
  {
    name: 'add_ticket',
    description:
      'Write down a backlog entry: work not begun. A description and a proposed branch name, and ' +
      'nothing else — no workspace, no worktree, no branch, no task document. Starting it later is start_task.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'A directory inside the project.' },
        branch: { type: 'string', description: 'Proposed branch name, kebab-case, names the outcome.' },
        description: { type: 'string', description: "The work, in the user's own words." },
      },
      required: ['branch', 'description'],
    },
  },
  {
    name: 'set_ticket_status',
    description:
      'Move a ticket between active and abandoned, by branch, from anywhere in the project. Reopening ' +
      'is status: "active" on an abandoned or done ticket. It cannot set done — that is finish_task, ' +
      'after the user accepts at stage 9. The user is asked before anything is written.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        branch: { type: 'string', description: 'Which ticket.' },
        status: { type: 'string', enum: ['active', 'abandoned'] },
        reason: { type: 'string', description: "The user's words about why." },
      },
      required: ['branch', 'status'],
    },
  },
  {
    name: 'archive_ticket',
    description:
      'Move a ticket out of every listing, into tickets/archive/, or back out with restore. Nothing is ' +
      'deleted: the workspace, the worktree and the branch are untouched. The user is asked first.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        branch: { type: 'string', description: 'Which ticket.' },
        restore: { type: 'boolean', description: 'Bring it back out of the archive.' },
      },
      required: ['branch'],
    },
  },
  {
    name: 'return_to_stage',
    description:
      'Send the current task back to an earlier stage, with a reason. Used after the user declines ' +
      'at stage 9 and says whether it is a design problem or an implementation problem.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        stage: { type: 'number', description: 'The stage to return to. Must be earlier than the current one.' },
        reason: { type: 'string', description: "The user's words about what is wrong." },
      },
      required: ['stage', 'reason'],
    },
  },
  {
    name: 'finish_task',
    description:
      'Mark the task done once the pull requests are open. Call at the end of stage 10, which the user ' +
      'authorised by accepting at stage 9.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        pull_requests: { type: 'array', items: { type: 'string' }, description: 'One URL per repository.' },
      },
    },
  },
  {
    name: 'abandon_task',
    description:
      'Mark the task abandoned, with a reason. The workspace and its worktrees are left alone; ' +
      'only the ticket changes. Ask the user before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
];

const TASK_TEMPLATE = (description) => `# Task

## Requirement

${description}

<!-- Filled in during stage 2: scope, what is explicitly out, how success is judged. -->

## Design

<!-- Stage 3: what changes, in which repository, and why. Name the files and modules.
     Decisions go into docs/adr/ in the repository they concern, as they are made. -->

## Test cases

<!-- Stage 3: one per line — the trigger, and the expected outcome. These become the
     tests verbatim in stage 6. -->

## Notes

<!-- Anything worth keeping that is not the above. -->
`;

async function callTool(name, args = {}) {
  const cwd = args.cwd ?? process.cwd();

  if (name === 'start_task') {
    const { project } = context(cwd);
    if (!project)
      return fail(
        `No dev-harness project found from ${cwd}. A project is a directory containing ${BASE_WORKSPACE}/ and tickets/. Run init first.`,
      );
    if (!validBranch(args.branch)) return fail(badBranch(args.branch));

    // The ticket is read before anything is created. A backlog entry has no
    // workspace directory to collide with, so checking the directory alone would
    // create it and then overwrite the record of why it exists.
    const held = takenBy(project, args.branch);
    if (held?.archived) return fail(inTheArchive(args.branch));
    const existing = held?.ticket ?? null;
    if (existing && existing.stage !== BACKLOG_STAGE)
      return fail(
        `${args.branch} already has a ticket at ${describe(existing.stage)} (${existing.status}). ` +
          `Pick another branch name, or continue that task from ${existing.workspace}.`,
      );

    const workspace = `${project}/${args.branch}`;
    if (existsSync(workspace)) return fail(`${workspace} already exists.`);

    // What a backlog entry said is the description of record. The task document is
    // written from it too, so the ticket and the document cannot disagree about what
    // the task is.
    const description = existing?.description ?? args.description;

    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, TASK_DOC), TASK_TEMPLATE(description), 'utf8');
    // The caller passes the session id, because this process does not receive it:
    // Claude Code does not put CLAUDE_CODE_SESSION_ID in a bundled MCP server's
    // environment. Reading it anyway costs nothing and starts working by itself if
    // that ever changes. With neither, the ticket records null — a missing id is
    // visible, a guessed one is not (ADR 0002).
    const fresh = newTicket({
      project,
      branch: args.branch,
      description,
      session_id: args.session_id || process.env.CLAUDE_CODE_SESSION_ID || null,
    });
    // Adopting a backlog entry rather than replacing it: what it was about, and when
    // it was first written down, are the two things worth keeping from it.
    const ticket = existing ? { ...existing, ...fresh, created_at: existing.created_at } : fresh;
    writeTicket(ticket);

    return ok(
      [
        existing ? `Backlog ticket ${args.branch} adopted, first written down ${existing.created_at}.` : '',
        `Workspace created: ${workspace}`,
        `Ticket: ${project}/tickets/${args.branch}.json`,
        `Task document: ${workspace}/${TASK_DOC}`,
        '',
        `Now at ${describe(1)}. Worktrees are not created yet — which repositories this`,
        `task touches is settled during stage 2. ${reposLine(project)}`,
        '',
        `Refused until the design is approved: anything inside a repository except`,
        `docs/architecture.md, docs/product.md, docs/adr/.`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const { project, workspace, ticket } = context(cwd);

  // Tickets are managed by name, from anywhere in the project — managing one means
  // acting on a ticket whose workspace you are not in. So these are dispatched
  // before the "no active task here" gate that the stage tools sit behind.
  if (name === 'find_ticket') {
    if (!project) return fail(`No dev-harness project found from ${cwd}.`);
    const words = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const archived = Boolean(args.archived);
    // Unfinished work is the default: everything ever started would otherwise bury
    // the one thing being worked on. The archive is the exception — asking for it is
    // already asking for the finished-with, so filtering it again by status would
    // hide almost everything in it.
    const wanted = args.status ?? (archived ? 'all' : 'active');
    if (!STATUSES.includes(wanted) && wanted !== 'all')
      return fail(`Not a status to filter by: ${wanted}. One of ${STATUSES.join(', ')}, or all.`);

    let rows = allTickets(project, { archived }).filter((t) => wanted === 'all' || t.status === wanted);

    if (words.length) {
      rows = rows
        .map((t) => ({ t, score: words.filter((w) => `${t.branch} ${t.description}`.toLowerCase().includes(w)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.t);
    } else {
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }

    if (!rows.length)
      return ok(
        words.length
          ? 'No ticket matched.'
          : archived
            ? 'The archive is empty.'
            : `No ${wanted === 'all' ? '' : `${wanted} `}tickets.`,
      );
    // A search that lands on one ticket is someone getting back into it. A listing
    // is a listing however few rows it has, or the shape of the answer would change
    // with the number of tasks in the project.
    if (words.length && rows.length === 1) return ok(block(rows[0]));

    const shown = rows.slice(0, 20);
    return ok(
      [
        table(shown),
        rows.length > shown.length ? `\n${rows.length - shown.length} more; narrow it with a query.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (name === 'add_ticket' || name === 'set_ticket_status' || name === 'archive_ticket') {
    // findProject rather than the resolved workspace: these work from anywhere,
    // including a project root, which is no task's workspace.
    const root = project ?? findProject(cwd);
    if (!root) return fail(`No dev-harness project found from ${cwd}.`);
    if (!validBranch(args.branch)) return fail(badBranch(args.branch));
    return await manage(name, root, args);
  }

  if (!ticket) return fail(`No active task found from ${cwd}. Nothing for dev-harness to do here.`);

  if (name === 'get_status') {
    const s = stage(ticket.stage);
    return ok(
      [
        `${describe(ticket.stage)} — ${ticket.status}`,
        `Branch: ${ticket.branch}`,
        `Workspace: ${ticket.workspace}`,
        `Repositories: ${ticket.repos.join(', ') || '(not settled yet)'}`,
        `This stage: ${s?.intent ?? ''}`,
        ticket.stage <= 5 && ticket.status === 'active'
          ? 'Refused: anything inside a repository except docs/architecture.md, docs/product.md, docs/adr/.'
          : 'Refused: nothing.',
        ticket.pull_requests?.length ? `Pull requests: ${ticket.pull_requests.join(', ')}` : '',
        ticket.history.length ? `\nHistory:\n${ticket.history.map((h) => `  ${h.at} ${h.from} -> ${h.to}${h.note ? ` (${h.note})` : ''}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (name === 'find_adr') {
    const repos = ticket.repos.length ? ticket.repos : listRepos(project);
    const words = args.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const repo of repos) {
      const dir = `${ticket.workspace}/${repo}/docs/adr`;
      const fallback = `${project}/${BASE_WORKSPACE}/${repo}/docs/adr`;
      const from = existsSync(dir) ? dir : existsSync(fallback) ? fallback : null;
      if (!from) continue;
      // README.md keeps the directory alive in git and describes what the directory
      // is for. It holds no decision, and it contains the words every search is made
      // of, so it would otherwise be the first result every time (ADR 0003).
      const records = readdirSync(from).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
      for (const file of records) {
        const text = readFileSync(join(from, file), 'utf8');
        const hay = text.toLowerCase();
        const score = words.filter((w) => hay.includes(w)).length;
        if (!score) continue;
        const title = (text.match(/^#\s+(.+)$/m) ?? [, file])[1];
        const summary = (text.match(/^summary:\s*(.+)$/im) ?? [, ''])[1];
        hits.push({ score, line: `${repo}/docs/adr/${file} — ${title}${summary ? `\n  ${summary}` : ''}` });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return ok(hits.length ? hits.slice(0, 10).map((h) => h.line).join('\n') : 'No decision record matched.');
  }

  if (name === 'return_to_stage') {
    const to = Number(args.stage);
    if (!stage(to)) return fail(`There is no stage ${args.stage}.`);
    if (to >= ticket.stage)
      return fail(`return_to_stage only goes backwards. The task is at ${describe(ticket.stage)}.`);
    ticket.history.push({ at: new Date().toISOString(), from: ticket.stage, to, note: args.reason });
    ticket.stage = to;
    writeTicket(ticket);
    return ok(`Back to ${describe(to)}. ${stage(to)?.intent ?? ''}\nRecorded: ${args.reason}`);
  }

  if (name === 'finish_task') {
    if (ticket.stage < LAST_STAGE)
      return fail(`The task is at ${describe(ticket.stage)}. Finish the stages before calling finish_task.`);
    if (!ticket.authorised_at)
      return fail(
        'The user has not accepted the work yet. Call advance_stage at stage 9 first — accepting there is what authorises the pull request.',
      );
    ticket.status = 'done';
    ticket.finished_at = new Date().toISOString();
    if (args.pull_requests?.length) ticket.pull_requests = args.pull_requests;
    writeTicket(ticket);
    return ok(
      `Task ${ticket.branch} is done.\nThe workspace at ${ticket.workspace} is left where it is; delete it when you no longer want it.`,
    );
  }

  if (name === 'abandon_task') {
    ticket.status = 'abandoned';
    ticket.history.push({ at: new Date().toISOString(), from: ticket.stage, to: ticket.stage, note: `abandoned: ${args.reason}` });
    writeTicket(ticket);
    return ok(
      `Task ${ticket.branch} is marked abandoned at ${describe(ticket.stage)}.\nNothing was deleted: the workspace, the worktrees, and the branch are all still there.`,
    );
  }

  if (name === 'advance_stage') {
    if (advancing.has(workspace))
      return fail('An advance is already in progress for this task; it is waiting on the user.');
    advancing.add(workspace);
    try {
      return await advance({ project, workspace, ticket, args });
    } finally {
      advancing.delete(workspace);
    }
  }

  return fail(`Unknown tool: ${name}`);
}

/**
 * The three tools that manage a ticket rather than move a task through its stages.
 *
 * The line between them: the stage flow owns `done`, management owns everything
 * else, and every change management makes is put to the user first (ADR 0006).
 */
async function manage(name, project, args) {
  if (name === 'add_ticket') {
    const held = takenBy(project, args.branch);
    if (held?.archived) return fail(inTheArchive(args.branch));
    if (held)
      return fail(
        `${args.branch} already has a ticket — ${held.ticket.status}, ${describe(held.ticket.stage)}. ` +
          `Pick another branch name.`,
      );
    writeTicket(newTicket({ project, branch: args.branch, description: args.description, stage: BACKLOG_STAGE }));
    return ok(
      [
        `Backlog ticket ${args.branch} written down.`,
        'Nothing else was created: no workspace, no worktree, no branch, no task document.',
        'Start it whenever you like with the task skill, which will adopt this ticket.',
      ].join('\n'),
    );
  }

  if (name === 'archive_ticket') {
    // Restoring reads the archive, archiving reads the listing: the same ticket is
    // only ever in one of the two places.
    const restore = Boolean(args.restore);
    const t = readTicket(project, args.branch, { archived: restore });
    if (!t)
      return fail(
        restore
          ? `${args.branch} is not in the archive.`
          : `No ticket for ${args.branch} in this project.`,
      );
    // Refused before the dialog, like an impossible status change: asking the user
    // to authorise something that cannot happen spends the one interruption the
    // plugin is allowed, and leaves them thinking it was done.
    if (readTicket(project, args.branch, { archived: !restore }))
      return fail(
        restore
          ? `${args.branch} is already in the listing; the restore would write over it. Nothing was moved.`
          : `${args.branch} is already in the archive. Nothing was moved.`,
      );

    const answer = await elicit(
      restore
        ? `Bring ${args.branch} back out of the archive?`
        : `Archive ${args.branch} (${t.status}, ${describe(t.stage)})? It leaves every listing; nothing is deleted.`,
    );
    if (answer?.action !== 'accept')
      return ok(`Declined. ${args.branch} stays where it is.`);

    moveTicket(project, args.branch, { restore });
    return ok(
      restore
        ? `${args.branch} is back in the listing.`
        : [
            `${args.branch} moved to ${ARCHIVE_DIR}/.`,
            'Nothing was deleted: the workspace, the worktree and the branch are where they were.',
            'Find it again with find_ticket archived: true, or bring it back with archive_ticket restore: true.',
          ].join('\n'),
    );
  }

  const ticket = readTicket(project, args.branch);
  if (!ticket) {
    const archived = readTicket(project, args.branch, { archived: true });
    return fail(
      archived
        ? `${args.branch} is in the archive. Bring it back with archive_ticket restore: true first.`
        : `No ticket for ${args.branch} in this project.`,
    );
  }

  {
    // Refused before the dialog: asking the user to authorise something that cannot
    // happen wastes the one interruption the plugin is allowed.
    if (args.status === 'done')
      return fail(
        'A ticket becomes done by finishing: the user accepts the feature at stage 9 — which is also the ' +
          'authorisation to open the pull request — and finish_task records it. set_ticket_status takes ' +
          'active or abandoned.',
      );
    if (!STATUSES.includes(args.status) || args.status === 'done')
      return fail(`Not a status this tool sets: ${args.status}. Use active or abandoned.`);
    if (ticket.status === args.status)
      return ok(`${args.branch} is already ${args.status}. Nothing to do.`);

    const reopening = args.status === 'active';
    const answer = await elicit(
      `${reopening ? 'Reopen' : 'Abandon'} ${args.branch} (${ticket.status}, ${describe(ticket.stage)})?` +
        (args.reason ? ` — ${args.reason}` : ''),
    );
    if (answer?.action !== 'accept') return ok(`Declined. ${args.branch} is unchanged.`);

    const was = ticket.status;
    // Read before the reopening below moves it, so the history records the rollback
    // that happened rather than the stage it landed on.
    const wasAt = ticket.stage;
    ticket.status = args.status;
    // A live task cannot also be one the user has already authorised sending out, and
    // stage 9 holds the only dialog that can authorise it again — left at stage 10 it
    // would be unauthorisable and finish_task would refuse it forever. The pull
    // requests themselves stay: they exist, and this is the record of it.
    if (reopening && was === 'done') {
      delete ticket.finished_at;
      delete ticket.authorised_at;
      ticket.stage = 9;
    }
    ticket.history.push({
      at: new Date().toISOString(),
      from: wasAt,
      to: ticket.stage,
      note: `${was} -> ${args.status}${args.reason ? `: ${args.reason}` : ''}`,
    });
    writeTicket(ticket);

    return ok(
      [
        `${args.branch} is ${args.status}, at ${describe(ticket.stage)}.`,
        reopening && was === 'done'
          ? 'finished_at and authorised_at are cleared and it is back at stage 9: sending it out again goes through the acceptance again.'
          : '',
        reopening ? `Continue it from ${ticket.workspace ?? 'its workspace'}.` : 'Nothing was deleted.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function advance({ project, workspace, ticket, args }) {
    const config = readConfig(project);
    const current = stage(ticket.stage);

    // Stage 10 asks nothing and advances nothing: it is the last stage, and being
    // here normally means stage 9 was accepted, which is the authorisation.
    // finish_task closes the task once the pull requests exist.
    if (ticket.stage === LAST_STAGE) {
      // Unless it was not. A ticket from before the acceptance and the authorisation
      // became one answer can be sitting at stage 10 having never been authorised —
      // stage 10 used to be where that was asked. Saying "authorised" to that ticket
      // would send Claude to open pull requests on work nobody accepted, and
      // finish_task would refuse it afterwards anyway. It goes back to the one stage
      // that can authorise it.
      if (!ticket.authorised_at) {
        ticket.history.push({
          at: new Date().toISOString(),
          from: LAST_STAGE,
          to: 9,
          note: 'never authorised: stage 10 no longer asks',
        });
        ticket.stage = 9;
        writeTicket(ticket);
        return ok(
          `This task is at stage 10 but was never accepted — it predates the acceptance and the ` +
            `authorisation becoming one answer. Back to ${describe(9)}. ${stage(9)?.intent ?? ''}`,
        );
      }
      return ok(
        'Authorised at stage 9. In each repository: commit with a message describing the change and why, ' +
          'push the branch, and open a pull request. Then call finish_task with the pull request URLs.',
      );
    }

    const problem = checkStage(ticket.stage, { ticket, workspace, config, args });
    if (problem) return fail(`Cannot leave ${describe(ticket.stage)} yet.\n${problem}`);

    if (current?.needsUser) {
      const answer = await elicit(current.dialog(ticket));
      if (answer?.action !== 'accept') {
        const to = current.declineTo === 'ask' ? null : current.declineTo;
        if (to === null) {
          return ok(
            'The user declined. Ask them one question: is this a design problem or an implementation problem? ' +
              'Then call return_to_stage with 3 for a design problem or 7 for an implementation problem, and their reason.',
          );
        }
        ticket.history.push({ at: new Date().toISOString(), from: ticket.stage, to, note: 'declined' });
        ticket.stage = to;
        writeTicket(ticket);
        return ok(`Declined. Back to ${describe(to)}. ${stage(to)?.intent ?? ''}`);
      }
      // Accepting a stage that authorises is also the authorisation to send the work
      // out. It is written in the same writeTicket as the stage change below, so a
      // ticket is never at stage 10 unauthorised.
      if (current.authorises) ticket.authorised_at = new Date().toISOString();
    }

    let next = ticket.stage + 1;
    if (config.codex === false) {
      while (stage(next)?.skippableWhenNoCodex) next += 1;
    }

    if (args.repos?.length) ticket.repos = args.repos;
    if (args.evidence) ticket.evidence = { ...(ticket.evidence ?? {}), [current.key]: args.evidence };
    ticket.history.push({ at: new Date().toISOString(), from: ticket.stage, to: next });
    ticket.stage = next;
    writeTicket(ticket);

    const s = stage(next);
    return ok(
      [
        `Now at ${describe(next)}.`,
        s?.intent ?? '',
        next === 6 ? 'The design is approved: nothing is refused for the rest of this task.' : '',
        next === 2
          ? `Create a worktree per repository once the interview settles them: git -C <project>/main/<repo> worktree add ${ticket.workspace}/<repo> -b ${ticket.branch}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
}

// ---------------------------------------------------------------- JSON-RPC loop

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.id !== undefined && msg.method === undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? { action: 'cancel' });
    pending.delete(msg.id);
    return;
  }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'dev-harness', version: '0.1.0' },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === 'tools/call') {
    let result;
    try {
      result = await callTool(msg.params?.name, msg.params?.arguments ?? {});
    } catch (err) {
      result = fail(`dev-harness error: ${err.message}`);
    }
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }
  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});
