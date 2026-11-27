import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { root } from './experiment.js';
import { verifyEvidence } from './verify.js';
import { runSuite } from './runner.js';
import { evaluateMarket } from './market-demo.js';
import type { EvalSummary } from './types.js';
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' } },
  });
  const verify = positionals[0] === 'verify';
  if (verify) positionals.shift();
  const kind = positionals[0] ?? 'ab';
  if (positionals.length > 1 || (kind !== 'ab' && kind !== 'update'))
    throw new Error('Usage: npm run eval -- [ab|update] [--out directory]');
  const outputDir = resolve(values.out ?? resolve(root, 'evidence', kind));
  if (verify) {
    console.log(verifyEvidence(outputDir, kind));
  } else {
    const progress = (s: EvalSummary) => {
      const row = s.rows.at(-1)!;
      console.log(
        `${s.completed}/${s.total} ${row.case_id} ${row.variant}${row.trial} ${row.run_id} · outcome=${row.outcome_pass} · ${row.status}`,
      );
    };
    if (kind === 'update') await evaluateMarket(outputDir, progress);
    else await runSuite({ kind, outputDir, onProgress: progress });
    console.log(resolve(outputDir, 'summary.md'));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
