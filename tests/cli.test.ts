import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture, demoResponses } from './helpers.js';
import type { Message } from '../src/types.js';

test('CLI status/tasks/diff work without a model key after restart', t => {
  const f = fixture(t), r = f.start();
  for (const cmd of ['status', 'tasks', 'diff']) {
    const result = spawnSync(process.execPath, ['dist/src/cli.js', cmd, r.id, '--db', f.db], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
  }
});

test('full CLI/API workflow persists between start and plan approval and rolls back after restart', async t => {
  const f = fixture(t), responses = demoResponses();
  const protocolErrors: string[] = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      const request = JSON.parse(body) as { messages: Message[] };
      const messages = request.messages;
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i]!;
        if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
        const resultIds = messages.slice(i + 1, i + 1 + m.tool_calls.length).filter(x => x.role === 'tool').map(x => x.tool_call_id);
        if (JSON.stringify(resultIds) !== JSON.stringify(m.tool_calls.map(c => c.id))) protocolErrors.push('Tool result ordering mismatch');
      }
      const message = responses.shift();
      if (!message) { res.writeHead(500); res.end(); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  const invoke = (args: string[]) => new Promise<string>((done, reject) => {
    const child = spawn(process.execPath, ['dist/src/cli.js', ...args, '--db', f.db], { env: { PATH: process.env.PATH, OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OPENAI_API_KEY: 'local-test', OPENAI_MODEL: 'scripted-http' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); }); child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI test timed out')); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) done(stdout); else reject(new Error(stderr)); });
  });
  const original = readFileSync(resolve(f.workspace, 'order.py'));
  const started = await invoke(['start', '--workspace', f.workspace, '--policy', f.policyFile, '--mode', 'auto', '--task', 'Fix order; tests unchanged']);
  const id = /run_id=([a-z0-9-]+)/.exec(started)?.[1]; assert.ok(id); assert.match(started, /awaiting_plan/);
  const completed = await invoke(['approve-plan', id, '--decision', 'approve']); assert.match(completed, /"status": "completed"/);
  assert.equal(f.store.get(id).calls.tests?.result?.exitCode, 0); assert.deepEqual(protocolErrors, []); assert.equal(responses.length, 0);
  assert.match(await invoke(['diff', id]), /order.py/);
  await invoke(['rollback', id]); assert.deepEqual(readFileSync(resolve(f.workspace, 'order.py')), original);
});
