import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../src/cli/arguments.js';

test('run accepts a quoted task, including an explicit separator for leading dashes', () => {
  assert.equal(parseArguments(['проверь расчёт']).command, 'run');
  assert.equal(parseArguments(['проверь расчёт']).task, 'проверь расчёт');
  assert.equal(parseArguments(['run', '--', '-проверь']).task, '-проверь');
  assert.equal(parseArguments(['start', '--task', 'старый вызов']).task, 'старый вызов');
});
test('mistyped commands and conflicting or irrelevant flags are rejected before side effects', () => {
  for (const args of [
    ['staus'],
    ['run', 'двойной', '--task', 'запрос'],
    ['status', '--no-plan'],
    ['run', '--mode', 'unsafe'],
    ['run', '--db', '--json'],
    ['diff', 'a', 'b'],
    ['approve-plan', 'abc', '--decision', 'allow'],
    ['rollback'],
  ])
    assert.throws(() => parseArguments(args), args.join(' '));
});
test('help and no-argument entry can be dispatched without opening the database', () => {
  assert.equal(parseArguments([]).command, 'run');
  assert.equal(parseArguments(['run', '--help']).command, 'help');
  assert.equal(parseArguments(['run', 'задача', '--help']).command, 'help');
  assert.equal(parseArguments(['status']).id, undefined);
});
