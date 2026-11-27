import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { event, type Decision, type MarketStorage } from './market-state.js';
import { digest, readSmallFile, type Skill } from './skills.js';

export type Compare = (files: {
  oldSkillDir: string;
  newSkillDir: string;
  outputDir: string;
}) => Promise<Decision>;

function archive(directory: string, pkg: Skill): string {
  let path = realpathSync(directory);
  for (const segment of ['packages', pkg.hash, pkg.name]) {
    path = join(path, segment);
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!lstatSync(path).isDirectory()) throw new Error('Invalid market archive directory');
  }
  const file = join(path, 'SKILL.md');
  try {
    writeFileSync(file, pkg.content, { flag: 'wx', mode: 0o400 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (digest(readSmallFile(file)) !== pkg.hash) throw new Error('Archived skill hash mismatch');
  return path;
}

export async function reviewCandidate(
  storage: MarketStorage,
  directory: string,
  compare: Compare,
  outputDir: string,
): Promise<void> {
  const token = randomUUID();
  const { old, next, candidate } = storage.transaction((s) => {
    if (!s.candidate || !s.staged) throw new Error('No staged update');
    if (s.inProgress) {
      try {
        process.kill(s.inProgress.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') delete s.inProgress;
        else throw e;
      }
      if (s.inProgress) throw new Error('Market review already running');
    }
    const old = s.installed.find((p) => p.name === s.candidate!.name)!;
    s.inProgress = { pid: process.pid, token };
    return { old, next: s.staged, candidate: s.candidate };
  });
  try {
    const result = await compare({
      oldSkillDir: archive(directory, old),
      newSkillDir: archive(directory, next),
      outputDir,
    });
    storage.transaction((s) => {
      if (
        s.inProgress?.token !== token ||
        s.candidate?.newHash !== candidate.newHash ||
        !s.installed.some((p) => p.name === old.name && p.hash === old.hash)
      )
        throw new Error('Candidate changed during comparison');
      if (
        typeof result.accept !== 'boolean' ||
        typeof result.reason !== 'string' ||
        typeof result.report !== 'string' ||
        !result.report
      )
        throw new Error('Invalid gate response');
      s.lastDecision = { accept: result.accept, reason: result.reason, report: result.report };
      s.reviewed = next.hash;
      if (result.accept) {
        s.previous = old;
        s.canRollback = true;
        s.installed = s.installed.map((p) => (p.name === old.name ? next : p));
      }
      event(s, result.accept ? 'accepted' : 'rejected', result.reason, {
        ...candidate,
        oldVersion: old.version,
        newVersion: next.version,
      });
      delete s.staged;
      delete s.candidate;
      delete s.inProgress;
    });
  } catch (e) {
    storage.transaction((s) => {
      if (s.inProgress?.token === token) delete s.inProgress;
      event(s, 'review_error', (e as Error).message, candidate);
    });
    throw e;
  }
}
