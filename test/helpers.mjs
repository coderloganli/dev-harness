// Test helpers: throwaway projects, and driving the server the way Claude Code
// does — as a child process speaking JSON-RPC over stdin and stdout.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = dirname(fileURLToPath(new URL('.', import.meta.url)));
export const SERVER = join(REPO, 'servers', 'dev-harness.mjs');

const made = [];

/** A project laid out the way dev-harness expects: main/<repo>/ and tickets/. */
export function makeProject({ repos = ['api'], config = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dh-test-')).split('\\').join('/');
  made.push(root);
  mkdirSync(join(root, 'tickets'), { recursive: true });
  for (const repo of repos) mkdirSync(join(root, 'main', repo, '.git'), { recursive: true });
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify({ test: 'node --test', try: 'run it and look', codex: false, ...config }),
  );
  return root;
}

export function cleanup() {
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a locked directory is not a test failure */
    }
  }
}

/**
 * Run one or more tool calls against a freshly spawned server and return the text
 * of each result, in order.
 *
 * `env` is merged into the child's environment and `unset` removes keys from it.
 * Note that the environment is NOT how the session id reaches the server — that
 * design failed acceptance; it is passed to `start_task` as an argument. The
 * environment is set here only to prove the argument wins over it.
 */
export function callTools(calls, { env = {}, unset = [], timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    for (const key of unset) delete childEnv[key];

    const child = spawn(process.execPath, [SERVER], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`server did not answer within ${timeoutMs}ms`)),
      timeoutMs,
    );
    // Without these, a server that dies on startup leaves the promise pending and
    // the test hangs until the runner kills it, reporting nothing useful.
    child.on('error', (err) => finish(reject, err));
    child.on('exit', (code) =>
      finish(reject, new Error(`server exited with code ${code} before answering`)),
    );

    let buffer = '';
    const results = new Map();
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) {
          finish(reject, new Error(`server returned an error: ${JSON.stringify(msg.error)}`));
          return;
        }
        if (msg.id !== undefined && msg.id !== 1 && !msg.result?.content) {
          finish(reject, new Error(`malformed result for id ${msg.id}: ${line}`));
          return;
        }
        // A tool that refuses answers with isError and a message. Treating that as a
        // normal result lets a broken fixture look like a working one: a setup call
        // that the server turned down would sail past and the real assertion would
        // fail somewhere unrelated.
        if (msg.result?.isError) {
          finish(reject, new Error(`tool call ${msg.id} refused: ${msg.result.content[0].text}`));
          return;
        }
        if (msg.result?.content) results.set(msg.id, msg.result.content[0].text);
        if (results.size === calls.length) {
          child.stdin.end();
          finish(resolve, calls.map((_, i) => results.get(i + 2)));
        }
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      }) + '\n',
    );
    calls.forEach((call, i) => {
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: call }) + '\n',
      );
    });
  });
}

export const callTool = (name, args, opts) =>
  callTools([{ name, arguments: args }], opts).then(([text]) => text);

/** The server's advertised tools, as Claude discovers them. */
export function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.result?.tools) {
          child.kill();
          resolve(msg.result.tools);
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }) + '\n',
    );
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  });
}

/**
 * Run a hook script the way Claude Code does: as a child process with the event
 * JSON on stdin. Resolves with whatever it printed to stdout.
 */
export function runHook(script, event) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO, 'scripts', script)], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify(event));
  });
}
