import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { submittedExample } from './examples.js';
import { projectRoot } from '../cli/paths.js';

export interface StudioApi {
  snapshot(): unknown;
  command(action: string, input: Record<string, unknown>): unknown;
  close?(): void;
}

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ...[
    'app',
    'dom',
    'chat',
    'settings',
    'evaluations',
    'examples',
    'icons',
    'workspace',
    'inspection',
    'approval',
  ].map(
    (name) => ['/' + name + '.js', [name + '.js', 'application/javascript']] as [string, string[]],
  ),
  ...['studio', 'thread', 'panels', 'motion'].map((name) => [
    '/' + name + '.css',
    [name + '.css', 'text/css'],
  ]),
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
] as [string, string[]][]);

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readCommand(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('Слишком длинный запрос.');
    chunks.push(Buffer.from(chunk));
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString());
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Ожидается объект.');
  const { action, input = {} } = payload as { action?: unknown; input?: unknown };
  if (typeof action !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Укажите действие и его параметры.');
  }
  return { action, input: input as Record<string, unknown> };
}

export function studioServer(api: StudioApi) {
  const server = createServer(async (request, response) => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const host = request.headers.host;
    const suffix = port === 80 ? '' : ':' + port;
    const allowedHosts = ['127.0.0.1' + suffix, 'localhost' + suffix];
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (
      !host ||
      !allowedHosts.includes(host) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return json(response, 403, { error: 'Только локальные запросы.' });
    }
    try {
      const path = request.url?.split('?')[0] ?? '/';
      if (request.method === 'GET' && path === '/api/state')
        return json(response, 200, await api.snapshot());
      for (const kind of ['explicit', 'ambiguous'] as const) {
        if (request.method === 'GET' && path === '/api/examples/' + kind)
          return json(response, 200, await submittedExample(kind));
      }
      if (request.method === 'POST' && path === '/api/command') {
        if (
          request.headers.origin !== 'http://' + host ||
          request.headers['content-type']?.split(';')[0] !== 'application/json'
        ) {
          return json(response, 403, { error: 'Команды доступны из открытой локальной студии.' });
        }
        const { action, input } = await readCommand(request);
        const result = await api.command(action, input);
        return json(response, 200, result ?? {});
      }
      const asset = assets.get(path);
      if (request.method !== 'GET' || !asset)
        return json(response, 404, { error: 'Страница не найдена.' });
      const data = await readFile(resolve(projectRoot, 'web', asset[0]!));
      response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
      response.end(data);
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : 'Не удалось выполнить запрос.',
      });
    }
  });
  server.on('close', () => api.close?.());
  return server;
}
