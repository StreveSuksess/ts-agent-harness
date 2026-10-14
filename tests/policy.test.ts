import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Policy } from '../src/policy.js';
import { executeTool } from '../src/tools.js';
import { call, fixture } from './helpers.js';

test('deny overrides allow; unknown commands and full shell syntax are rejected', t => {
  const f = fixture(t), p = Policy.load(f.policyFile, f.workspace);
  assert.equal(p.command('python3 -m unittest -v', '.'), realpathSync(f.workspace));
  for (const command of ['pwd', 'rm -rf .', 'ls', 'python3 -m unittest -v; pwd', 'python3 -m unittest -v | cat', 'echo $(pwd)', 'python3 -m unittest -v > result']) assert.throws(() => p.command(command, '.'));
  assert.throws(() => p.command('python3 -m unittest -v', 'restricted'), /denied/);
});
test('policy rejects traversal, absolute paths, symlinks, hardlinks and denied subdirectories', t => {
  const f = fixture(t), p = Policy.load(f.policyFile, f.workspace);
  writeFileSync(resolve(f.root, 'outside'), 'secret');
  symlinkSync(resolve(f.root, 'outside'), resolve(f.workspace, 'link'));
  mkdirSync(resolve(f.workspace, 'denied-child'));
  symlinkSync(f.root, resolve(f.workspace, 'dir-link'));
  linkSync(resolve(f.root, 'outside'), resolve(f.workspace, 'hardlink'));
  for (const path of ['../outside', resolve(f.root, 'outside'), 'link', 'dir-link/outside', 'restricted/.gitkeep', 'hardlink']) assert.throws(() => p.path(path));
  assert.throws(() => p.path('test_order.py', true), /read-only/);
});
test('tool schemas reject unknown names, malformed JSON, wrong types and extra fields', t => {
  const f = fixture(t), p = Policy.load(f.policyFile, f.workspace);
  for (const c of [call('a', 'unknown', {}), call('b', 'read_file', { path: 10 }), call('c', 'read_file', { path: 'order.py', extra: true }), { ...call('d', 'read_file', {}), function: { name: 'read_file', arguments: '{' } }]) assert.throws(() => p.validate(c));
});
test('policy and state must be outside the editable workspace', t => {
  const f = fixture(t);
  const inner = resolve(f.workspace, 'policy.json'); writeFileSync(inner, JSON.stringify(f.config));
  assert.throws(() => Policy.load(inner, f.workspace), /outside/);
  f.config.directories.allow = ['../']; f.policy();
  assert.throws(() => Policy.load(f.policyFile, f.workspace), /traversal/);
});
test('Bash really runs Python tests and returns stdout/stderr/exit code', async t => {
  const f = fixture(t), p = Policy.load(f.policyFile, f.workspace);
  const result = await executeTool(call('tests', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' }), p, 8192);
  assert.equal(result.ok, false); assert.notEqual(result.exitCode, 0); assert.match(result.stderr!, /FAIL/); assert.equal(typeof result.stdout, 'string');
});
test('Bash has bounded output and kills a timed-out command', async t => {
  const f = fixture(t);
  f.config.commands.allow = ['yes', 'sleep 2']; f.config.commands.deny = []; f.config.timeoutMs = 80; f.config.maxOutputBytes = 128; f.policy();
  const p = Policy.load(f.policyFile, f.workspace);
  const noisy = await executeTool(call('yes', 'Bash', { command: 'yes', cwd: '.' }), p, 128);
  assert.equal(noisy.timedOut, true); assert.equal(noisy.truncated, true); assert.ok(Buffer.byteLength(noisy.stdout! + noisy.stderr!) <= 128);
  const sleep = await executeTool(call('sleep', 'Bash', { command: 'sleep 2', cwd: '.' }), p, 128);
  assert.equal(sleep.timedOut, true); assert.equal(sleep.ok, false);
});
