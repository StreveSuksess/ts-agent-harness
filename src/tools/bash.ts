import { spawn } from 'node:child_process';
import type { ToolResult } from '../types.js';

export async function runBash(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<ToolResult> {
  return new Promise((finish) => {
    // No BASH_ENV, NODE_OPTIONS, PYTHONPATH or model credentials are inherited.
    const environment = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      PYTHONDONTWRITEBYTECODE: '1',
    };
    const childProcess = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let timedOut = false;
    let truncated = false;
    const collectOutput = (target: Buffer[], chunk: Buffer) => {
      const remainingBytes = Math.max(0, maxBytes - capturedBytes);

      if (remainingBytes > 0) {
        target.push(chunk.subarray(0, remainingBytes));
      }

      capturedBytes += Math.min(remainingBytes, chunk.length);
      if (chunk.length > remainingBytes) {
        truncated = true;
      }
    };

    childProcess.stdout.on('data', (chunk: Buffer) => collectOutput(stdoutChunks, chunk));
    childProcess.stderr.on('data', (chunk: Buffer) => collectOutput(stderrChunks, chunk));

    const killProcessGroup = () => {
      try {
        if (childProcess.pid && process.platform !== 'win32') {
          process.kill(-childProcess.pid, 'SIGKILL');
        } else {
          childProcess.kill('SIGKILL');
        }
      } catch {
        /* already exited */
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup();
    }, timeoutMs);

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      finish({ ok: false, error: error.message });
    });
    childProcess.on('close', (exitCode) => {
      clearTimeout(timeout);
      finish({
        ok: !timedOut && exitCode === 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: exitCode,
        timedOut,
        truncated,
      });
    });
  });
}
