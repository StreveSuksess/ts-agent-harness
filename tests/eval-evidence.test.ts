import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { root } from '../src/evals/experiment.js';
import { verifyEvidence } from '../src/evals/verify.js';
import type { EvalSummary } from '../src/evals/types.js';

test('offline replay rejects coordinated edits of rows and artifacts as well as derived totals', (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'eval-evidence-test-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(root, 'evidence', 'ab'), copy, { recursive: true });
  const summaryPath = join(copy, 'summary.json');
  const summary: EvalSummary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const row = summary.rows.find((r) => r.case_id === 'open' && r.variant === 'B' && r.trial === 1)!;
  function save() {
    writeFileSync(summaryPath, JSON.stringify(summary));
    writeFileSync(
      join(copy, 'trials.jsonl'),
      summary.rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    writeFileSync(join(copy, 'trials/open-B1/result.json'), JSON.stringify(row));
  }
  assert.ok(verifyEvidence(copy, 'ab'));
  for (const field of ['routing_pass_or_na', 'tools_pass', 'safety_pass'] as const) {
    assert.equal(row[field], true);
    row[field] = false;
    save();
    assert.throws(() => verifyEvidence(copy, 'ab'), /оценка/);
    row[field] = true;
  }
  summary.groups[0]!.outcomes++;
  save();
  assert.throws(() => verifyEvidence(copy, 'ab'), /показатели/);
  summary.groups[0]!.outcomes--;
  save();
  writeFileSync(join(copy, 'trials/open-B1/answer.json'), '["T93","T31","T84"]');
  assert.throws(() => verifyEvidence(copy, 'ab'), /последняя запись/);
});

test('offline replay rejects a market decision that disagrees with the measured gate', (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'eval-market-test-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(root, 'evidence', 'update'), copy, { recursive: true });
  assert.ok(verifyEvidence(copy, 'update'));
  const path = join(copy, 'market-review.json');
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  receipt.decision.accept = true;
  writeFileSync(path, JSON.stringify(receipt));
  assert.throws(() => verifyEvidence(copy, 'update'), /market-review/);
});
