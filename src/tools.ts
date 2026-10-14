import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Policy } from './policy.js';
import type { ToolCall, ToolResult } from './types.js';

export const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export function fitResult(result: ToolResult, limit: number): { result: ToolResult; text: string; bytes: number } {
  const full = JSON.stringify(result);
  if (Buffer.byteLength(full) <= limit) return { result, text: full, bytes: Buffer.byteLength(full) };
  const minimal: ToolResult = { ok: result.ok, truncated: true };
  let text = JSON.stringify(minimal);
  if (Buffer.byteLength(text) > limit) throw new Error('Result budget too small for truncation marker');
  let low = 0, high = full.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify({ ...minimal, content: full.slice(0, middle) })) <= limit) low = middle;
    else high = middle - 1;
  }
  const fitted = { ...minimal, ...(low ? { content: full.slice(0, low) } : {}) };
  text = JSON.stringify(fitted);
  return { result: fitted, text, bytes: Buffer.byteLength(text) };
}
export async function executeTool(call: ToolCall, policy: Policy, maxBytes: number): Promise<ToolResult> {
  const args = policy.validate(call); // Revalidation immediately before execution.
  const path = args.path === undefined ? '' : policy.path(args.path as string, ['write_file', 'delete_file'].includes(call.function.name));
  switch (call.function.name) {
    case 'list_files': {
      const files: string[] = [];
      let used = 0, truncated = false;
      for (const name of readdirSync(path).sort()) {
        try { policy.path(join(args.path as string, name)); } catch { continue; }
        const cost = Buffer.byteLength(name) + 4;
        if (used + cost > maxBytes) { truncated = true; break; }
        used += cost; files.push(name + (lstatSync(join(path, name)).isDirectory() ? '/' : ''));
      }
      return { ok: true, files, truncated };
    }
    case 'read_file': {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const st = fstatSync(fd);
        if (!st.isFile() || st.nlink > 1) throw new Error('Not a regular unlinked file');
        if (st.size > policy.config.maxFileBytes) throw new Error('File exceeds policy maxFileBytes');
        const data = Buffer.alloc(Math.min(st.size, maxBytes));
        const size = readSync(fd, data, 0, data.length, 0);
        const bytes = data.subarray(0, size);
        return { ok: true, content: bytes.toString('utf8'), truncated: size < st.size, hash: hash(bytes) };
      } finally { closeSync(fd); }
    }
    case 'write_file': {
      const content = args.content as string;
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
      try {
        const st = fstatSync(fd);
        if (!st.isFile() || st.nlink > 1) throw new Error('Not a regular unlinked file');
        // Truncate only after validating the opened file descriptor.
        const { ftruncateSync, fsyncSync } = await import('node:fs');
        ftruncateSync(fd, 0);
        const bytes = Buffer.from(content);
        let written = 0;
        while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      return { ok: true, hash: hash(content) };
    }
    case 'delete_file':
      if (!lstatSync(path).isFile()) throw new Error('Only regular files can be deleted');
      unlinkSync(path);
      return { ok: true };
    case 'Bash': return bash(args.command as string, policy.command(args.command as string, args.cwd as string), policy.config.timeoutMs, Math.min(maxBytes, policy.config.maxOutputBytes));
    default: throw new Error('Administrative tools are executed by the runtime');
  }
}
async function bash(command: string, cwd: string, timeoutMs: number, maxBytes: number): Promise<ToolResult> {
  return new Promise(resolve => {
    // No BASH_ENV, NODE_OPTIONS, PYTHONPATH or model credentials are inherited.
    const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' };
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const out: Buffer[] = [], err: Buffer[] = [];
    let used = 0, timedOut = false, truncated = false;
    const collect = (target: Buffer[], chunk: Buffer) => {
      const left = Math.max(0, maxBytes - used);
      if (left > 0) target.push(chunk.subarray(0, left));
      used += Math.min(left, chunk.length);
      if (chunk.length > left) truncated = true;
    };
    child.stdout.on('data', (chunk: Buffer) => collect(out, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(err, chunk));
    const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && code === 0, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), exitCode: code, timedOut, truncated });
    });
  });
}
