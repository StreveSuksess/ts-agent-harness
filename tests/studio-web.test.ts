import assert from 'node:assert/strict';
import test from 'node:test';
import { get as request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { studioServer } from '../src/web/transport.js';

test('web studio serves its UI, forwards state and commands, rejects foreign pages and arbitrary paths', async (t) => {
  let calls = 0;
  const server = studioServer({
    snapshot: () => ({ sessions: [], skills: [] }),
    command: (action, input) => {
      calls++;
      return { action, input };
    },
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const get = (p: string, extra = {}) => fetch(origin + p, { headers: extra });
  const post = (
    headers: Record<string, string>,
    body = '{"action":"prompt","input":{"prompt":"read"}}',
  ) =>
    fetch(origin + '/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });

  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Инспектор сессии/);
  for (const asset of [
    'app.js',
    'chat.js',
    'studio.css',
    'settings.js',
    'evaluations.js',
    'examples.js',
    'dom.js',
  ]) {
    assert.equal((await get('/' + asset)).status, 200);
  }
  assert.deepEqual(await (await get('/api/state')).json(), { sessions: [], skills: [] });
  for (const kind of ['explicit', 'ambiguous']) {
    const example = await (await get('/api/examples/' + kind)).json();
    assert.equal(example.session.turns.length, 2);
    assert.equal(example.artifacts['count.txt'], kind === 'explicit' ? '2' : '0');
    assert.ok(example.events.some((event: { type: string }) => event.type === 'laya_route'));
  }
  for (const path of [
    '/.env',
    '/../.env',
    '/src/model.ts',
    '/does-not-exist',
    '/api/examples/other',
  ]) {
    assert.equal((await get(path)).status, 404);
  }
  const foreignHost = await new Promise<number | undefined>((done, reject) => {
    request(origin + '/api/state', { headers: { host: 'other.example' } }, (response) => {
      response.resume();
      done(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ Origin: 'https://other.example' })).status, 403);
  assert.equal((await post({ Origin: origin, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ Origin: origin, 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await post({ Origin: origin }, '[]')).status, 400);
  assert.equal(
    (
      await post(
        { Origin: origin },
        JSON.stringify({ action: 'prompt', input: { prompt: 'z'.repeat(33000) } }),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await (await post({ Origin: origin })).json(), {
    action: 'prompt',
    input: { prompt: 'read' },
  });
  assert.equal(calls, 1);
});
