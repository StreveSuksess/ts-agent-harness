import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { cases } from './cases.js';
import { freezeExperiment, type SuiteOptions, root, sha } from './experiment.js';
import { writeSummary, variantsFor } from './report.js';
import { measureTrial } from './trial.js';
import { verifyEvidence } from './verify.js';
import type { EvalSummary, TrialRow } from './types.js';

export async function runSuite(options: SuiteOptions): Promise<EvalSummary> {
  const out = resolve(options.outputDir);
  mkdirSync(out, { recursive: true });
  const locks = join(root, '.agent', 'eval-locks');
  mkdirSync(locks, { recursive: true });
  const lock = new DatabaseSync(join(locks, sha(out) + '.sqlite'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    // A finished baseline is an observation; viewing it again needs no live model.
    // A gate decision, or any unfinished experiment, still checks the live contract.
    const archived = join(out, 'summary.json');
    if (options.kind === 'ab' && existsSync(archived)) {
      const prior = JSON.parse(readFileSync(archived, 'utf8')) as EvalSummary;
      if (prior.kind === 'ab' && prior.completed === 30) {
        verifyEvidence(out);
        const refreshed = writeSummary(out, 'ab', prior.rows);
        options.onProgress?.(refreshed);
        return refreshed;
      }
    }
    const frozen = await freezeExperiment(options);
    const rows: TrialRow[] = [];
    let summary: EvalSummary = {
      kind: options.kind,
      total: 30,
      completed: 0,
      groups: [],
      rows: [],
    };
    for (const c of cases)
      for (let trial = 1; trial <= 3; trial++)
        for (const variant of variantsFor(options.kind)) {
          const saved = join(out, 'trials', `${c.id}-${variant}${trial}`, 'result.json');
          if (existsSync(saved)) {
            const row = JSON.parse(readFileSync(saved, 'utf8')) as TrialRow;
            if (
              row.case_id !== c.id ||
              row.trial !== trial ||
              row.variant !== variant ||
              !existsSync(join(out, row.events_path))
            )
              throw new Error('Неполный результат ' + saved);
            rows.push(row);
          } else {
            const scratch = mkdtempSync(join(tmpdir(), 'harness-eval-'));
            try {
              rows.push(
                await measureTrial(
                  c,
                  variant,
                  trial,
                  out,
                  frozen,
                  join(scratch, 'workspace'),
                  join(scratch, 'state.sqlite'),
                ),
              );
            } finally {
              rmSync(scratch, { recursive: true, force: true });
            }
          }
          summary = writeSummary(out, options.kind, rows);
          options.onProgress?.(summary);
        }
    verifyEvidence(out);
    return summary;
  } finally {
    lock.close();
  }
}

export async function compareSkills(options: {
  oldSkillDir: string;
  newSkillDir: string;
  outputDir: string;
}) {
  const summary = await runSuite({ ...options, kind: 'update' });
  return { ...summary.decision!, report: join(resolve(options.outputDir), 'summary.json') };
}
