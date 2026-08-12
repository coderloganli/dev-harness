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
  BASE_WORKSPACE,
  TASK_DOC,
  allTickets,
  context,
  listRepos,
  newTicket,
  readConfig,
  writeTicket,
} from '../lib/store.mjs';

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
      'Search tickets by what the task was about, or list them all when no query is given. ' +
      'Returns the workspace to return to and the session id to resume.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        query: { type: 'string', description: 'Words from the task description. Omit to list everything.' },
        status: { type: 'string', enum: ['active', 'done', 'abandoned'] },
      },
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
    description: 'Mark the task done once the pull requests are open. Call at the end of stage 10.',
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
    const workspace = `${project}/${args.branch}`;
    if (existsSync(workspace)) return fail(`${workspace} already exists.`);

    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, TASK_DOC), TASK_TEMPLATE(args.description), 'utf8');
    const ticket = newTicket({ project, branch: args.branch, description: args.description });
    writeTicket(ticket);

    return ok(
      [
        `Workspace created: ${workspace}`,
        `Ticket: ${project}/tickets/${args.branch}.json`,
        `Task document: ${workspace}/${TASK_DOC}`,
        '',
        `Now at ${describe(1)}. Worktrees are not created yet — which repositories this`,
        `task touches is settled during stage 2. Repositories available: ${listRepos(project).join(', ') || '(none found)'}.`,
        '',
        `Refused until the design is approved: anything inside a repository except`,
        `docs/architecture.md, docs/product.md, docs/adr/.`,
      ].join('\n'),
    );
  }

  const { project, workspace, ticket } = context(cwd);
  if (name === 'find_ticket') {
    if (!project) return fail(`No dev-harness project found from ${cwd}.`);
    const words = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    let rows = allTickets(project).filter((t) => !args.status || t.status === args.status);

    if (words.length) {
      rows = rows
        .map((t) => ({ t, score: words.filter((w) => `${t.branch} ${t.description}`.toLowerCase().includes(w)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.t);
    } else {
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }

    if (!rows.length) return ok(words.length ? 'No ticket matched.' : 'No tickets yet.');
    return ok(
      rows
        .slice(0, 20)
        .map(
          (t) =>
            `${t.branch} — ${t.status}, ${describe(t.stage)}\n  ${t.description}\n  workspace: ${t.workspace}\n  session: ${t.session_id ?? '(not recorded)'}`,
        )
        .join('\n\n'),
    );
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
      for (const file of readdirSync(from).filter((f) => f.endsWith('.md'))) {
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
        'The user has not authorised the pull request yet. Call advance_stage at stage 10 first — that is the dialog that authorises it.',
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

async function advance({ project, workspace, ticket, args }) {
    const config = readConfig(project);
    const current = stage(ticket.stage);

    // Stage 10's dialog authorises sending the work out; the stage does not
    // advance past it. finish_task closes the task once the PRs exist.
    if (ticket.stage === LAST_STAGE) {
      if (ticket.authorised_at)
        return ok('Already authorised. Open the pull requests, then call finish_task.');
      const answer = await elicit(current.dialog(ticket));
      if (answer?.action !== 'accept') {
        ticket.history.push({ at: new Date().toISOString(), from: LAST_STAGE, to: 9, note: 'declined' });
        ticket.stage = 9;
        writeTicket(ticket);
        return ok(`Declined. Back to ${describe(9)}.`);
      }
      ticket.authorised_at = new Date().toISOString();
      writeTicket(ticket);
      return ok(
        'Authorised. In each repository: commit with a message describing the change and why, push the branch, ' +
          'and open a pull request. Then call finish_task with the pull request URLs.',
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
