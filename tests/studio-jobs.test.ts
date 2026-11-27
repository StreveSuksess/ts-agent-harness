import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StudioJobs } from '../src/studio/jobs.js';

test('attached eval reports can be opened without a model; event reads are tied to recorded trials', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'studio-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidence = join(root, 'evidence'),
    out = join(evidence, 'ab');
  const logs = join(out, 'trials', 'case-A1');
  mkdirSync(logs, { recursive: true });
  const event = {
    id: 'e1',
    time: '2026-11-27T00:00:00Z',
    type: 'skill_loaded',
    session_id: 's1',
    run_id: 'r1',
    data: { name: 'open-tasks' },
  };
  writeFileSync(join(logs, 'events.jsonl'), JSON.stringify(event) + '\n');
  writeFileSync(join(root, 'events.jsonl'), JSON.stringify({ private: 'outside' }));
  writeFileSync(
    join(out, 'summary.json'),
    JSON.stringify({
      kind: 'ab',
      total: 30,
      completed: 2,
      groups: [],
      rows: [
        { run_id: 'r1', events_path: 'trials/case-A1/events.jsonl' },
        { run_id: 'r2', events_path: '../../events.jsonl' },
      ],
    }),
  );
  const jobs = new StudioJobs(join(root, 'jobs'), evidence);
  assert.equal(jobs.summaries()[0]?.source, 'Материалы сдачи');
  assert.deepEqual(jobs.events('ab', 'r1'), [event]);
  assert.throws(() => jobs.events('ab', 'r2'), /вне каталога/);
  assert.throws(() => jobs.events('update', 'r1'), /не найден/);
  assert.throws(() => jobs.events('ab', 'missing'), /не найден/);
});
