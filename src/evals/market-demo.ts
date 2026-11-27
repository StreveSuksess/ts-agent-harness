import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillMarket } from '../extensions/market.js';
import { atomicWrite } from './report.js';
import { runSuite } from './runner.js';
import type { EvalSummary } from './types.js';

/** Exercise the same market gate as the application using a disposable installation. */
export async function evaluateMarket(
  outputDir: string,
  onProgress: (s: EvalSummary) => void,
): Promise<void> {
  const installation = mkdtempSync(join(tmpdir(), 'eval-market-'));
  mkdirSync(outputDir, { recursive: true });
  try {
    const market = new SkillMarket(installation);
    market.check();
    market.install('handoff-note');
    const initial = market.status();
    market.configure({ source: 'v2', check: true, autoUpdate: true });
    const discovered = market.check();
    const reviewed = await market.review(async (files) => {
      const summary = await runSuite({ ...files, kind: 'update', onProgress });
      if (!summary.decision) throw new Error('Incomplete update comparison');
      return { ...summary.decision, report: 'summary.json' };
    }, outputDir);
    const final = reviewed.canRollback ? market.rollback() : reviewed;
    const active = (state: typeof final) =>
      state.installed.map(({ name, version, hash, source }) => ({ name, version, hash, source }));
    atomicWrite(
      join(outputDir, 'market-review.json'),
      JSON.stringify(
        {
          initial: active(initial),
          candidate: discovered.candidate,
          newSkills: discovered.available.map((s) => s.name),
          decision: reviewed.lastDecision,
          afterDecision: active(reviewed),
          canRollback: reviewed.canRollback,
          afterRollback: reviewed.canRollback ? active(final) : null,
          events: final.events,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    rmSync(installation, { force: true, recursive: true });
  }
}
