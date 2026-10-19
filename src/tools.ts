import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Policy } from './policy.js';
import { runBash } from './tools/bash.js';
import type { ToolCall, ToolResult } from './types.js';

export { fitResult } from './tools/results.js';

export const hash = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export async function executeTool(
  call: ToolCall,
  policy: Policy,
  maxBytes: number,
): Promise<ToolResult> {
  const args = policy.validate(call); // Revalidation immediately before execution.
  const path =
    args.path === undefined
      ? ''
      : policy.path(
          args.path as string,
          ['write_file', 'delete_file'].includes(call.function.name),
        );

  switch (call.function.name) {
    case 'list_files': {
      const files: string[] = [];
      let listedBytes = 0;
      let truncated = false;

      for (const name of readdirSync(path).sort()) {
        try {
          policy.path(join(args.path as string, name));
        } catch {
          continue;
        }

        const entryBytes = Buffer.byteLength(name) + 4;

        if (listedBytes + entryBytes > maxBytes) {
          truncated = true;
          break;
        }

        listedBytes += entryBytes;
        files.push(name + (lstatSync(join(path, name)).isDirectory() ? '/' : ''));
      }

      return { ok: true, files, truncated };
    }
    case 'read_file': {
      const fileDescriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

      try {
        const stats = fstatSync(fileDescriptor);

        if (!stats.isFile() || stats.nlink > 1) {
          throw new Error('Not a regular unlinked file');
        }

        if (stats.size > policy.config.maxFileBytes) {
          throw new Error('File exceeds policy maxFileBytes');
        }

        const data = Buffer.alloc(Math.min(stats.size, maxBytes));
        const bytesRead = readSync(fileDescriptor, data, 0, data.length, 0);
        const bytes = data.subarray(0, bytesRead);

        return {
          ok: true,
          content: bytes.toString('utf8'),
          truncated: bytesRead < stats.size,
          hash: hash(bytes),
        };
      } finally {
        closeSync(fileDescriptor);
      }
    }
    case 'write_file': {
      const content = args.content as string;
      const fileDescriptor = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
        0o644,
      );

      try {
        const stats = fstatSync(fileDescriptor);

        if (!stats.isFile() || stats.nlink > 1) {
          throw new Error('Not a regular unlinked file');
        }
        // Truncate only after validating the opened file descriptor.
        const { ftruncateSync, fsyncSync } = await import('node:fs');

        ftruncateSync(fileDescriptor, 0);

        const bytes = Buffer.from(content);
        let written = 0;

        while (written < bytes.length) {
          written += writeSync(fileDescriptor, bytes, written, bytes.length - written);
        }
        fsyncSync(fileDescriptor);
      } finally {
        closeSync(fileDescriptor);
      }

      return { ok: true, hash: hash(content) };
    }
    case 'delete_file':
      if (!lstatSync(path).isFile()) {
        throw new Error('Only regular files can be deleted');
      }
      unlinkSync(path);
      return { ok: true };
    case 'Bash':
      return runBash(
        args.command as string,
        policy.command(args.command as string, args.cwd as string),
        policy.config.timeoutMs,
        Math.min(maxBytes, policy.config.maxOutputBytes),
      );
    default:
      throw new Error('Administrative tools are executed by the runtime');
  }
}
