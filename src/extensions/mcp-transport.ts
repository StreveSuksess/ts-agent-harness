import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerSpec } from './mcp-config.js';

interface Response {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}
export interface Peer {
  request(method: string, params: object): Promise<Record<string, unknown>>;
}

export async function withServer<T>(
  spec: ServerSpec,
  trackerData: string | undefined,
  action: (peer: Peer) => Promise<T>,
): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), 'harness-mcp-'));
  const child = spawn(
    process.execPath,
    [
      '--permission',
      '--disable-warning=ExperimentalWarning',
      ...[spec.entry, ...spec.allowRead].map((p) => '--allow-fs-read=' + p),
      '--',
      spec.entry,
      ...spec.args,
    ],
    {
      cwd,
      env: trackerData ? { TRACKER_DATA: trackerData } : {},
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  let id = 0;
  let buffer = '';
  let byteCount = 0;
  let resolveCall: ((result: Record<string, unknown>) => void) | undefined;
  let rejectCall: ((reason: Error) => void) | undefined;
  let failed: Error | undefined;
  function fail(error: Error) {
    failed = error;
    rejectCall?.(error);
    child.kill('SIGKILL');
  }
  const timer = setTimeout(() => fail(new Error('MCP timeout')), spec.timeoutMs);
  child.on('error', fail);
  child.on('close', () => {
    failed ??= new Error('MCP server closed the connection');
    rejectCall?.(failed);
  });
  child.stdin.on('error', fail);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    byteCount += Buffer.byteLength(chunk);
    if (byteCount > 512 * 1024) {
      fail(new Error('MCP response exceeds 512 KiB'));
      return;
    }
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      try {
        const response: Response = JSON.parse(line);
        if (response.jsonrpc !== '2.0') throw new Error('Invalid MCP JSON-RPC response');
        if (response.id === undefined) continue;
        if (response.id !== id) throw new Error('Unexpected MCP response id');
        if (response.error) throw new Error('MCP error: ' + response.error.message);
        if (!response.result || typeof response.result !== 'object')
          throw new Error('Invalid MCP result');
        resolveCall?.(response.result);
      } catch (e) {
        fail(e as Error);
      }
    }
  });
  const send = (value: object) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  const peer: Peer = {
    request(method, params) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        resolveCall = resolve;
        rejectCall = reject;
        send({ id: ++id, method, params });
      });
    },
  };
  try {
    const init = await peer.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'ts-agent-harness', version: '2' },
    });
    if (
      !['2025-03-26', '2024-11-05'].includes(String(init.protocolVersion)) ||
      !(init.capabilities as { tools?: object } | undefined)?.tools
    )
      throw new Error('Incompatible MCP version or missing tools capability');
    send({ method: 'notifications/initialized' });
    return await action(peer);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    child.kill('SIGKILL');
    rmSync(cwd, { recursive: true, force: true });
  }
}
