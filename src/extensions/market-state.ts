import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest, parseSkill, readSmallFile, validSkillName, type Skill } from './skills.js';

export type CatalogVersion = 'v1' | 'v2';
export interface MarketSettings {
  source: CatalogVersion;
  check: boolean;
  autoUpdate: boolean;
}
export interface MarketEntry {
  name: string;
  description: string;
  version: string;
  path: string;
  hash: string;
}
export interface MarketEvent {
  id: string;
  run_id: null;
  session_id: null;
  source: string;
  oldVersion?: string;
  newVersion?: string;
  time: string;
  type: string;
  name?: string;
  oldHash?: string;
  newHash?: string;
  detail: string;
}
export interface Decision {
  accept: boolean;
  reason: string;
  report: string;
}
export interface Candidate {
  name: string;
  oldHash: string;
  newHash: string;
}
export interface MarketState {
  settings: MarketSettings;
  installed: Skill[];
  available: MarketEntry[];
  events: MarketEvent[];
  candidate?: Candidate;
  lastDecision?: Decision;
  canRollback: boolean;
  checkedAt?: string;
}
export interface StoredMarket extends MarketState {
  cached: MarketEntry[];
  seen?: string[];
  inProgress?: { pid: number; token: string };
  staged?: Skill;
  previous?: Skill;
  reviewed?: string;
}
export function event(
  state: StoredMarket,
  type: string,
  detail: string,
  refs: Partial<Candidate & { oldVersion: string; newVersion: string }> = {},
) {
  state.events.push({
    id: randomUUID(),
    run_id: null,
    session_id: null,
    source: 'study-market/' + state.settings.source,
    time: new Date().toISOString(),
    type,
    detail,
    ...refs,
  });
}
function catalogDir(root: string, source: CatalogVersion): string {
  const path = resolve(realpathSync(root), source);
  if (realpathSync(path) !== path) throw new Error('Market source uses a symbolic link');
  return path;
}
export function sourceEntries(root: string, source: CatalogVersion): MarketEntry[] {
  const rows: unknown = JSON.parse(
    readSmallFile(resolve(catalogDir(root, source), 'catalog.json')),
  );
  if (!Array.isArray(rows) || rows.length > 150) throw new Error('Invalid market index');
  const seen = new Set<string>();
  for (const r of rows) {
    if (
      !validSkillName(r?.name) ||
      seen.has(r.name) ||
      typeof r.description !== 'string' ||
      !r.description.trim() ||
      r.description.length > 1024 ||
      typeof r.version !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/.test(r.version) ||
      r.path !== r.name + '/SKILL.md' ||
      !/^[0-9a-f]{64}$/.test(r.hash)
    )
      throw new Error('Invalid market entry');
    seen.add(r.name);
  }
  return rows;
}
export function readPackage(root: string, source: CatalogVersion, row: MarketEntry): Skill {
  const directory = catalogDir(root, source);
  const path = resolve(directory, row.path);
  if (realpathSync(path) !== path) throw new Error('Market package uses a symbolic link');
  const content = readSmallFile(path);
  if (digest(content) !== row.hash) throw new Error('Market package digest mismatch: ' + row.name);
  const pkg = parseSkill(content, row.name, 'study-market/' + source, row.version);
  if (pkg.description !== row.description) throw new Error('Market metadata mismatch');
  return pkg;
}
export class MarketStorage {
  constructor(
    private readonly directory: string,
    private readonly initial: () => StoredMarket,
  ) {}
  transaction<T>(action: (state: StoredMarket) => T): T {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = resolve(this.directory, 'market.sqlite');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const existing = lstatSync(path + suffix, { throwIfNoEntry: false });
      if (existing && (!existing.isFile() || existing.nlink !== 1))
        throw new Error('Invalid market database path');
    }
    const db = new DatabaseSync(path);
    try {
      db.exec(
        'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS market (id INTEGER PRIMARY KEY, state TEXT NOT NULL); BEGIN IMMEDIATE',
      );
      const old = db.prepare('SELECT state FROM market WHERE id=1').get()?.state as
        string | undefined;
      const state: StoredMarket = old ? JSON.parse(old) : this.initial();
      const result = action(state);
      const updated = JSON.stringify(state);
      if (old !== updated) db.prepare('INSERT OR REPLACE INTO market VALUES (1,?)').run(updated);
      db.exec('COMMIT');
      return result;
    } finally {
      db.close();
    }
  }
}
