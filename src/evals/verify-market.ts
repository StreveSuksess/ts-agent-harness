import { isDeepStrictEqual } from 'node:util';
import type { Candidate, MarketEvent } from '../extensions/market-state.js';
import type { GateDecision } from './types.js';
import { sha } from './experiment.js';

interface Installed {
  name: string;
  hash: string;
  version: string;
}
interface MarketEvidence {
  initial: Installed[];
  afterDecision: Installed[];
  afterRollback: Installed[] | null;
  candidate: Candidate;
  decision: GateDecision & { report: string };
  canRollback: boolean;
  events: MarketEvent[];
}

export function verifyMarket(read: (p: string) => string, decision: GateDecision): void {
  const m = JSON.parse(read('market-review.json')) as MarketEvidence;
  const oldHash = sha(read('snapshot/skills/old/open-tasks/SKILL.md'));
  const newHash = sha(read('snapshot/skills/new/open-tasks/SKILL.md'));
  const candidate = { name: 'open-tasks', oldHash, newHash };
  const installed = (items: Installed[]) => items.find((p) => p.name === candidate.name)?.hash;
  const log = m.events.filter((e) =>
    ['candidate', 'accepted', 'rejected', 'rollback'].includes(e.type),
  );
  const kinds = decision.accept ? ['candidate', 'accepted', 'rollback'] : ['candidate', 'rejected'];
  const ok =
    isDeepStrictEqual(m.candidate, candidate) &&
    isDeepStrictEqual(m.decision, { ...decision, report: 'summary.json' }) &&
    m.canRollback === decision.accept &&
    installed(m.initial) === oldHash &&
    installed(m.afterDecision) === (decision.accept ? newHash : oldHash) &&
    (decision.accept
      ? m.afterRollback && installed(m.afterRollback) === oldHash
      : m.afterRollback === null) &&
    isDeepStrictEqual(
      log.map((e) => e.type),
      kinds,
    ) &&
    log[1]?.detail === decision.reason &&
    log.every(
      (e) =>
        e.name === candidate.name &&
        e.oldHash === (e.type === 'rollback' ? newHash : oldHash) &&
        e.newHash === (e.type === 'rollback' ? oldHash : newHash),
    );
  if (!ok)
    throw new Error(
      'Решение, журнал или установленные хеши market-review.json расходятся с измерениями',
    );
}
