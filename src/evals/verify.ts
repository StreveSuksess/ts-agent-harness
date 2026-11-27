import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cases } from './cases.js';
import { decideUpdate } from './gate.js';
import { verifyActions } from './verify-actions.js';
import { verifyMarket } from './verify-market.js';
import { aggregateGroup, variantsFor } from './report.js';
import { root, sha } from './experiment.js';
import { statistics } from '../studio/stats.js';
import type { AgentEvent } from '../studio/events.js';
import type { EvalSummary, Kind } from './types.js';

export function verifyEvidence(dir: string, requiredKind?: Kind): string {
  const read = (p: string) => readFileSync(join(dir, p), 'utf8');
  const verify = (condition: boolean, context: string) => {
    if (!condition) throw new Error('Неверные доказательства: ' + context);
  };
  const summary = JSON.parse(read('summary.json')) as EvalSummary;
  const manifest = JSON.parse(read('manifest.json')) as {
    kind: Kind;
    files: Record<string, string>;
    code: Record<string, string>;
  };
  verify(
    ['update', 'ab'].includes(summary.kind) &&
      summary.kind === manifest.kind &&
      (!requiredKind || summary.kind === requiredKind),
    'тип эксперимента',
  );
  for (const name of ['cases', 'gate', 'trial'])
    verify(
      sha(readFileSync(join(root, 'src', 'evals', name + '.ts'))) === manifest.code[name],
      'код оценивания ' + name,
    );
  for (const [file, hash] of Object.entries(manifest.files))
    verify(sha(read('snapshot/' + file)) === hash, file);
  const table = read('trials.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  verify(isDeepStrictEqual(table, summary.rows), 'trials.jsonl');
  const seenRuns = new Set<string>();
  const seenSessions = new Set<string>();
  for (const c of cases)
    for (const trial of [1, 2, 3])
      for (const variant of variantsFor(summary.kind)) {
        const key = `${c.id}-${variant}${trial}`;
        const row = summary.rows.find(
          (r) => r.trial === trial && r.case_id === c.id && r.variant === variant,
        );
        if (!row) throw new Error('Нет попытки ' + key);
        verify(
          isDeepStrictEqual(row, JSON.parse(read(`trials/${key}/result.json`))),
          key + ' result.json',
        );
        verify(
          !seenRuns.has(row.run_id) && !seenSessions.has(row.session_id),
          key + ' duplicate ID',
        );
        seenRuns.add(row.run_id);
        seenSessions.add(row.session_id);
        verify(row.events_path === `trials/${key}/events.jsonl`, key + ' journal location');
        const events = read(row.events_path)
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as AgentEvent);
        verify(
          events.every((e) => e.run_id === row.run_id && e.session_id === row.session_id) &&
            events.length > 0 &&
            new Set(events.map((e) => e.id)).size === events.length,
          key + ' journal IDs',
        );
        verify(
          events.find((e) => e.type === 'user_request')?.data.prompt === c.prompt,
          key + ' prompt',
        );
        const route = events.find((e) => e.type === 'laya_route')?.data ?? null;
        verify(isDeepStrictEqual(route, row.laya_route), key + ' actual Laya decision');
        const stats = statistics(events);
        verify(
          stats.usage.input === row.input_tokens &&
            stats.usage.output === row.output_tokens &&
            stats.usage.complete === row.usage_complete &&
            isDeepStrictEqual({ ...stats.tools }, row.tools) &&
            isDeepStrictEqual({ ...stats.skills }, row.skill_activations) &&
            isDeepStrictEqual({ ...stats.mcp }, row.mcp_calls),
          key + ' statistics',
        );
        const answer = `trials/${key}/answer.json`;
        const body = existsSync(join(dir, answer)) ? read(answer) : null;
        verifyActions(c, row, events, read, body);
        let outcome = false;
        if (body !== null) {
          try {
            outcome = c.check(JSON.parse(body));
          } catch {
            /* Invalid output fails the external check. */
          }
        }
        verify(outcome === row.outcome_pass, key + ' answer.json');
      }
  verify(
    summary.rows.length === 30 && summary.completed === 30 && summary.total === 30,
    '30 trials',
  );
  const variants = variantsFor(summary.kind);
  const groups = cases.flatMap((c) =>
    variants.map((v) =>
      aggregateGroup(
        summary.rows.filter((r) => r.case_id === c.id && r.variant === v),
        c.id,
        v,
      ),
    ),
  );
  const overall = variants.map((v) =>
    aggregateGroup(
      summary.rows.filter((r) => r.variant === v),
      'Всего',
      v,
    ),
  );
  verify(
    isDeepStrictEqual(summary.groups, groups) && isDeepStrictEqual(summary.overall, overall),
    'группы и итоговые показатели',
  );
  if (summary.kind === 'update') {
    const decision = decideUpdate(
      summary.rows.filter((r) => r.variant === 'old'),
      summary.rows.filter((r) => r.variant === 'new'),
    );
    verify(isDeepStrictEqual(decision, summary.decision), 'автоматическое решение');
    if (requiredKind === 'update' || existsSync(join(dir, 'market-review.json')))
      verifyMarket(read, decision);
  }
  return 'Проверены 30 независимых попыток, JSONL, токены, маршруты Laya, вызовы и источники, артефакты, ограничения и сводные показатели.';
}
