import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import type { RunState } from '../src/types.js';
import { fixture } from './helpers.js';

const cli = resolve('dist/src/cli.js');
function invoke(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('one-shot JSON works from another cwd and shows setup errors for an isolated copy', (t) => {
  const f = fixture(t);
  const db = ['--db', 'state.sqlite'];
  const result = invoke(f.root, ['run', 'Проверь заказ', ...db, '--json']);
  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'blocked');
  assert.match(summary.reason, /OPENAI_BASE_URL/);

  const run = f.store.get(summary.run_id);
  assert.equal(dirname(run.workspace), resolve('.agent/workspaces'));
  t.after(() => rmSync(run.workspace, { recursive: true, force: true }));
  assert.deepEqual(
    readFileSync(join(run.workspace, 'order.py')),
    readFileSync('workspace/order.py'),
  );
  assert.equal(run.mode, 'safe');
  assert.equal(run.phase, 'plan');

  const status = invoke(f.root, ['status', ...db, '--json']);
  assert.equal(status.status, 0);
  assert.deepEqual(JSON.parse(status.stdout), summary);
  assert.deepEqual(
    JSON.parse(invoke(f.root, ['trace', run.id.slice(0, 8), ...db, '--json']).stdout),
    [],
  );
  assert.equal(JSON.parse(invoke(f.root, ['runs', ...db, '--json']).stdout)[0].id, run.id);
});

test('a missing task without a terminal exits without creating a run', (t) => {
  const f = fixture(t);
  assert.equal(invoke(f.root, ['run', '--db', f.db]).status, 1);
  assert.deepEqual(f.store.listRuns(), []);
});

test('user workspace and policy arguments resolve against the calling directory', (t) => {
  const f = fixture(t);
  const result = invoke(f.root, [
    'run',
    'Задача',
    '--db',
    'state.sqlite',
    '--workspace',
    'workspace',
    '--policy',
    'policy.json',
    '--json',
  ]);
  const run: RunState = f.store.get(JSON.parse(result.stdout).run_id);
  assert.equal(run.workspace, realpathSync(f.workspace));
  assert.equal(run.policyFile, realpathSync(f.policyFile));
});
