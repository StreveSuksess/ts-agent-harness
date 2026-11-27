import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { askApproval, askTask } from '../src/cli/dialog.js';

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let transcript = '';
  output.on('data', (chunk: Buffer) => {
    transcript += chunk.toString();
  });
  return { input, output, transcript: () => transcript };
}

test('the task prompt trims user input and can be dismissed before creating a run', async () => {
  for (const [typed, expected] of [
    ['  Исправь расчёт скидки  \n', 'Исправь расчёт скидки'],
    [' \n', undefined],
    ['Q\n', undefined],
    ['', undefined],
  ] as const) {
    const io = terminal();
    const task = askTask(io);
    io.input.end(typed);
    assert.equal(await task, expected);
  }
});

test('plan and action decisions require an explicit answer and retry unrecognized input', async () => {
  for (const [status, typed, result, prompt] of [
    ['awaiting_plan', '  Да \n', 'accept', /план/i],
    ['awaiting_plan', 'NO\n', 'reject', /план/i],
    ['awaiting_action', 'y\n', 'accept', /действие/i],
    ['awaiting_action', 'н\n', 'reject', /действие/i],
  ] as const) {
    const io = terminal();
    const decision = askApproval({ status }, io);
    io.input.end('maybe\n' + typed);
    assert.deepEqual(await decision, { decision: result });
    assert.match(io.transcript(), prompt);
    assert.match(io.transcript(), /Введите/);
  }
});

test('plan rejections carry the original feedback and require an explicit rejection', async () => {
  const io = terminal();
  const decision = askApproval({ status: 'awaiting_plan' }, io);
  io.input.end('добавь проверку\nНЕТ Запусти Test_Order.py\n');
  assert.deepEqual(await decision, { decision: 'reject', feedback: 'Запусти Test_Order.py' });
});

test('Enter, EOF and q leave a pending approval undecided', async () => {
  for (const answer of ['\n', '', 'q\n', 'не знаю\n', 'да', 'да, наверное\n', 'нет уточнение\n']) {
    const io = terminal();
    const decision = askApproval({ status: 'awaiting_action' }, io);
    io.input.end(answer);
    assert.deepEqual(await decision, { decision: 'pause' });
  }
});

test('Ctrl-C closes an interactive approval without approving the action', async () => {
  const io = terminal();
  Object.assign(io.output, { isTTY: true });
  const decision = askApproval({ status: 'awaiting_action' }, io);
  io.input.write('\x03');
  assert.deepEqual(await decision, { decision: 'pause' });
  assert.equal(io.input.isPaused(), true);
  io.input.end();
});
