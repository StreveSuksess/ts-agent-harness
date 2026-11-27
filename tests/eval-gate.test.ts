import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../src/evals/cases.js';
import { decideUpdate } from '../src/evals/gate.js';
import type { TrialRow } from '../src/evals/types.js';

function sample(variant: 'old' | 'new'): TrialRow[] {
  return cases.flatMap((c) =>
    [1, 2, 3].map((trial) => {
      const id = [variant, c.id, trial].join('-');
      return {
        case_id: c.id,
        variant,
        trial,
        run_id: id,
        session_id: id,
        status: 'completed',
        outcome_pass: true,
        routing_pass_or_na: true,
        tools_pass: true,
        safety_pass: true,
        input_tokens: 1000,
        output_tokens: 100,
        usage_complete: true,
        skill_activations: {},
        tools: {},
        mcp_calls: {},
        tool_errors: 0,
        error: null,
        events_path: 'events.jsonl',
      };
    }),
  );
}
test('candidate gate compares paired coverage, per-case performance, cost and constraints', () => {
  const baseline = sample('old'),
    candidate = sample('new');
  assert.equal(decideUpdate(baseline, candidate).accept, true);
  for (const patch of [
    { outcome_pass: false },
    { routing_pass_or_na: false },
    { tools_pass: false },
    { safety_pass: false },
    { usage_complete: false },
    { input_tokens: null },
    { output_tokens: 100000 },
    { run_id: baseline[0]!.run_id },
  ]) {
    assert.equal(
      decideUpdate(
        baseline,
        candidate.map((r, i) => (i === 0 ? { ...r, ...patch } : r)),
      ).accept,
      false,
    );
  }
  assert.equal(decideUpdate(baseline, candidate.slice(1)).accept, false);
  assert.equal(
    decideUpdate(
      baseline.map((r) => ({ ...r, outcome_pass: false })),
      candidate,
    ).accept,
    false,
  );
});
test('artifact graders reject duplicate and invented IDs, guesses and inappropriate output shapes', () => {
  const grade = (id: string, value: unknown) => cases.find((c) => c.id === id)!.check(value);
  assert.equal(grade('open', ['T84', 'T31', 'T93']), true);
  assert.equal(grade('open', ['T84', 'T84', 'T93']), false);
  assert.equal(grade('owners', { Lena: 2, Kai: 3 }), true);
  assert.equal(grade('owners', { Lena: '2', Kai: '3' }), false);
  assert.equal(grade('project', 'Полярная сова'), true);
  assert.equal(grade('project', { display_name: 'Полярная сова' }), false);
  assert.equal(grade('missing-owner', { owner: 'Unknown' }), false);
  assert.equal(grade('outage', { available: false, ids: [] }), false);
});
