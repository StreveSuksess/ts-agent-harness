import {
  configuredServers,
  prepareExtensions,
  type ExtensionSnapshot,
} from '../extensions/index.js';
import { SkillMarket } from '../extensions/market.js';
import { SettingsStore } from './settings.js';
import type { StudioJobs } from './jobs.js';

export type CommandInput = Record<string, unknown>;
export function required(input: CommandInput, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error('Ожидается ' + key);
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Ожидается true/false');
  return value;
}
function setMember(items: string[], value: string, on: boolean) {
  return [...new Set([...items.filter((x) => x !== value), ...(on ? [value] : [])])];
}

export class StudioCatalog {
  readonly market = new SkillMarket();
  private catalog!: ExtensionSnapshot;
  constructor(
    readonly settings: SettingsStore,
    private jobs: StudioJobs,
  ) {}

  async discover() {
    this.catalog = await prepareExtensions({ servers: this.settings.read().servers });
  }

  check(force = false) {
    const state = this.market.check({ force });
    if (state.candidate && state.settings.check && state.settings.autoUpdate)
      this.jobs.evaluate(this.market);
  }

  snapshot() {
    const config = this.settings.read();
    const current = this.market.status();
    const skills = new Map([...this.catalog.skills, ...current.installed].map((p) => [p.name, p]));
    return {
      settings: config,
      errors: this.catalog.errors,
      market: { ...current, installed: current.installed.map(({ content: _content, ...p }) => p) },
      skills: [...skills.values()].map(({ content: _content, ...s }) => ({
        ...s,
        enabled: !config.disabledSkills.includes(s.name),
      })),
      mcp: configuredServers().map((name) => ({
        name,
        enabled: config.servers.includes(name),
        error: this.catalog.errors.find((e) => e.startsWith(name + ':')),
        tools: this.catalog.mcp
          .filter((t) => t.server === name)
          .map((t) => ({
            name: t.name,
            description: t.definition.function.description,
            inputSchema: t.definition.function.parameters,
          })),
      })),
    };
  }

  async command(action: string, input: CommandInput) {
    switch (action) {
      case 'settings': {
        const { mode, plan, ...marketSettings } = input;
        if (mode !== undefined && mode !== 'safe' && mode !== 'auto')
          throw new Error('Режим safe или auto');
        if (plan !== undefined) bool(plan);
        if (Object.keys(marketSettings).length) this.market.configure(marketSettings);
        this.settings.update((s) => {
          if (mode === 'safe' || mode === 'auto') s.mode = mode;
          if (plan !== undefined) s.plan = bool(plan);
        });
        this.check();
        return this.settings.read();
      }
      case 'skill.toggle': {
        const name = required(input, 'name');
        if (!this.snapshot().skills.some((s) => s.name === name))
          throw new Error('Скилл не найден');
        return this.settings.update((s) => {
          s.disabledSkills = setMember(s.disabledSkills, name, !bool(input.enabled));
        });
      }
      case 'skill.install': {
        const p = this.market.install(required(input, 'name'));
        await this.discover();
        return { name: p.name, hash: p.hash };
      }
      case 'mcp.connect':
      case 'mcp.toggle': {
        const name = required(input, 'name');
        if (!configuredServers().includes(name))
          throw new Error('Сервер отсутствует в доверенной конфигурации');
        this.settings.update((s) => {
          s.servers = setMember(s.servers, name, action === 'mcp.connect' || bool(input.enabled));
        });
        await this.discover();
        return this.snapshot().mcp;
      }
      case 'market.check':
        this.check(true);
        return this.snapshot().market;
      case 'market.rollback':
        this.market.rollback();
        await this.discover();
        return this.snapshot().market;
      case 'market.evaluate':
        this.jobs.evaluate(this.market);
        return { started: true };
      default:
        throw new Error('Неизвестная команда студии');
    }
  }
}
