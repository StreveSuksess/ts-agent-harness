import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChatModel, parseAssistant } from '../src/model.js';
import { definitions } from '../src/schema.js';
import { call, reply } from './helpers.js';

test('compatible API adapter posts schemas/history and preserves all tool call IDs', async t => {
  let received: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer local-test');
    let body = ''; req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { received = JSON.parse(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: reply(call('a', 'read_file', { path: 'order.py' }), call('b', 'list_files', { path: '.' })) }] })); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  const model = new ChatModel({ baseUrl: `http://127.0.0.1:${address.port}/v1/`, apiKey: 'local-test', model: 'fake' });
  const result = await model.complete([{ role: 'user', content: 'hello' }], definitions);
  assert.deepEqual(result.tool_calls?.map(c => c.id), ['a', 'b']); assert.equal(received?.model, 'fake'); assert.ok(Array.isArray(received?.tools));
});
test('malformed response/prototype call IDs fail closed', () => {
  assert.throws(() => parseAssistant({ role: 'user', content: 'bad' }));
  assert.throws(() => parseAssistant(reply(call('__proto__', 'read_file', { path: 'order.py' }))));
});
