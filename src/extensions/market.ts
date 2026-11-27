import { resolve } from 'node:path';
import { reviewCandidate, type Compare } from './market-review.js';
import { projectRoot } from '../cli/paths.js';
import type { Skill } from './skills.js';
import { event, MarketStorage, readPackage, sourceEntries } from './market-state.js';
import type { MarketSettings, MarketState } from './market-state.js';
export type { MarketSettings, MarketState, Decision, MarketEntry } from './market-state.js';

export const defaultExtensionState = resolve(projectRoot, '.agent/extensions');
export class SkillMarket {
  private readonly storage: MarketStorage;
  constructor(
    private readonly stateDir = defaultExtensionState,
    private readonly registryRoot = resolve(projectRoot, 'market'),
  ) {
    this.storage = new MarketStorage(stateDir, () => {
      const state: import('./market-state.js').StoredMarket = {
        settings: { source: 'v1', check: true, autoUpdate: false },
        installed: [],
        available: [],
        events: [],
        cached: [],
        canRollback: false,
      };
      try {
        const bundled = resolve(projectRoot, 'market');
        const initial = sourceEntries(bundled, 'v1').find((row) => row.name === 'open-tasks');
        if (!initial) throw new Error('Bundled open-tasks is missing');
        state.installed.push(readPackage(bundled, 'v1', initial));
      } catch (error) {
        event(state, 'market_error', (error as Error).message);
      }
      return state;
    });
  }
  status(): MarketState {
    return this.storage.transaction(
      ({
        staged: _s,
        cached: _c,
        previous: _p,
        reviewed: _r,
        inProgress: _i,
        seen: _seen,
        ...state
      }) => state,
    );
  }
  configure(update: Partial<MarketSettings>): MarketState {
    if (
      Object.keys(update).some((key) => !['source', 'check', 'autoUpdate'].includes(key)) ||
      (update.source !== undefined && !['v1', 'v2'].includes(update.source)) ||
      (update.check !== undefined && typeof update.check !== 'boolean') ||
      (update.autoUpdate !== undefined && typeof update.autoUpdate !== 'boolean')
    )
      throw new Error('Invalid market settings');
    this.storage.transaction((state) => {
      if (update.source && update.source !== state.settings.source) {
        state.cached = [];
        state.available = [];
        delete state.candidate;
        delete state.staged;
      }
      Object.assign(state.settings, update);
    });
    return this.status();
  }
  check({ force = false } = {}): MarketState {
    this.storage.transaction((s) => {
      if (!force && !s.settings.check) return;
      s.checkedAt = new Date().toISOString();
      try {
        const rows = sourceEntries(this.registryRoot, s.settings.source);
        const installed = new Map(s.installed.map((p) => [p.name, p]));
        const available = rows.filter((row) => !installed.has(row.name));
        const changed = rows.find(
          (row) =>
            installed.has(row.name) &&
            installed.get(row.name)!.hash !== row.hash &&
            row.hash !== s.reviewed,
        );
        const staged = changed
          ? readPackage(this.registryRoot, s.settings.source, changed)
          : undefined;
        if (JSON.stringify(rows) !== JSON.stringify(s.cached)) {
          event(s, 'market_checked', 'Loaded catalog ' + s.settings.source);
          const seen = new Set(s.seen ?? s.cached.map((row) => row.name));
          for (const row of available.filter((row) => !seen.has(row.name)))
            event(s, 'new_skill', row.description, {
              name: row.name,
              newHash: row.hash,
              newVersion: row.version,
            });
        }
        s.seen = [...new Set([...(s.seen ?? []), ...rows.map((p) => p.name)])];
        s.cached = rows;
        s.available = available;
        if (staged && s.candidate?.newHash !== staged.hash) {
          s.candidate = {
            name: staged.name,
            oldHash: installed.get(staged.name)!.hash,
            newHash: staged.hash,
          };
          s.staged = staged;
          event(s, 'candidate', 'Update ready for evaluation', {
            ...s.candidate,
            oldVersion: installed.get(staged.name)!.version,
            newVersion: staged.version,
          });
        } else if (!staged) {
          delete s.candidate;
          delete s.staged;
        }
      } catch (e) {
        delete s.candidate;
        delete s.staged;
        s.cached = [];
        s.available = [];
        const message = (e as Error).message;
        const last = s.events.at(-1);
        if (last?.type !== 'market_error' || last.detail !== message)
          event(s, 'market_error', message);
      }
    });
    return this.status();
  }
  install(name: string, expectedHash?: string): Skill {
    let failure: Error | undefined;
    const installed = this.storage.transaction((s) => {
      try {
        const active = s.installed.find((p) => p.name === name);
        const entry = s.available.find((p) => p.name === name);
        if (expectedHash && expectedHash !== (active ?? entry)?.hash)
          throw new Error('Market offer changed since this run started: ' + name);
        if (active) return active;
        if (!entry) throw new Error('Skill is not in checked catalog: ' + name);
        const pkg = readPackage(this.registryRoot, s.settings.source, entry);
        s.installed.push(pkg);
        s.available = s.available.filter((p) => p.name !== name);
        event(s, 'installed', 'Available to subsequent runs', {
          name,
          newHash: pkg.hash,
          newVersion: pkg.version,
        });
        return pkg;
      } catch (e) {
        failure = e as Error;
        event(s, 'install_error', failure.message, { name });
      }
    });
    if (!installed) throw failure;
    return installed;
  }
  async review(compare: Compare, outputDir: string): Promise<MarketState> {
    await reviewCandidate(this.storage, this.stateDir, compare, outputDir);
    return this.status();
  }
  rollback(): MarketState {
    this.storage.transaction((s) => {
      if (!s.previous || !s.canRollback) throw new Error('No accepted update to roll back');
      const previous = s.previous;
      const current = s.installed.find((p) => p.name === previous.name)!;
      s.installed = s.installed.map((p) => (p.name === previous.name ? previous : p));
      s.canRollback = false;
      s.reviewed = current.hash;
      delete s.previous;
      delete s.staged;
      delete s.candidate;
      event(s, 'rollback', 'Restored previous version', {
        name: previous.name,
        oldHash: current.hash,
        newHash: previous.hash,
        oldVersion: current.version,
        newVersion: previous.version,
      });
    });
    return this.status();
  }
}
