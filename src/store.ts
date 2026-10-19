import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inside } from './policy.js';
import type { RunState } from './types.js';

export class Store {
  readonly file: string;

  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.file = resolve(file);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL
      );
    `);
  }

  assertOutside(workspace: string): void {
    if (inside(realpathSync(workspace), realpathSync(this.file))) {
      throw new Error('State database must be outside workspace');
    }
  }

  get(id: string): RunState {
    const storedRow = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(id);

    if (!storedRow) {
      throw new Error(`Unknown run_id: ${id}`);
    }

    return JSON.parse(storedRow.state as string) as RunState;
  }

  save(run: RunState): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const storedRun = this.db.prepare('SELECT revision FROM runs WHERE id = ?').get(run.id);

      if (storedRun && storedRun.revision !== run.revision) {
        throw new Error('Concurrent run update detected');
      }

      const nextRevision = run.revision + 1;
      const serializedState = JSON.stringify({ ...run, revision: nextRevision });

      this.db
        .prepare(
          `
          INSERT INTO runs (id, revision, state) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            revision = excluded.revision,
            state = excluded.state
        `,
        )
        .run(run.id, nextRevision, serializedState);
      this.db.exec('COMMIT');
      run.revision = nextRevision;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async locked<T>(workspace: string, action: () => Promise<T>): Promise<T> {
    const { createHash } = await import('node:crypto');
    const workspaceHash = createHash('sha256').update(realpathSync(workspace)).digest('hex');
    const lockFile = resolve(dirname(this.file), `${workspaceHash}.lock`);
    const acquire = () => {
      const fileDescriptor = openSync(lockFile, 'wx', 0o600);

      try {
        writeFileSync(fileDescriptor, JSON.stringify({ pid: process.pid }));
      } finally {
        closeSync(fileDescriptor);
      }
    };

    try {
      acquire();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      const ownerPid = (JSON.parse(readFileSync(lockFile, 'utf8')) as { pid: number }).pid;

      if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
        throw new Error('Invalid workspace lock; inspect it manually');
      }

      let stale = false;

      try {
        process.kill(ownerPid, 0);
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
          stale = true;
        } else {
          throw new Error('Workspace is locked');
        }
      }

      if (!stale) {
        throw new Error('Workspace is already in use');
      }

      unlinkSync(lockFile);
      acquire();
    }

    try {
      return await action();
    } finally {
      unlinkSync(lockFile);
    }
  }

  close(): void {
    this.db.close();
  }
}
