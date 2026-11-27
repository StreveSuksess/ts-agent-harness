import { resolve } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { object, str } from '../schemas/common.js';
import { projectRoot } from '../cli/paths.js';
import { defaultExtensionState, SkillMarket } from './market.js';
import { discoverSkills, parseSkill, readSmallFile, type Skill } from './skills.js';
import { discoverMcp, type McpTool } from './mcp.js';
import { defaultMcpConfig, serverSpec } from './mcp-config.js';
import { extensionValidator } from './validation.js';
import { separateWorkspace } from './trust.js';
export { configuredServers } from './mcp-config.js';
export interface ExtensionOptions {
  workspace?: string;
  skills?: boolean;
  skillDir?: string;
  disabledSkills?: string[];
  skillOverrides?: Record<string, string>;
  stateDir?: string;
  market?: boolean;
  servers?: string[];
  trackerFixture?: string;
  configFile?: string;
}
export interface ExtensionSnapshot {
  skills: Skill[];
  definitions: ToolDefinition[];
  errors: string[];
  mcp: McpTool[];
  market: boolean;
  stateDir: string;
  configFile: string;
  trackerData?: string;
  trustedPaths?: string[];
  disabledSkills?: string[];
  marketOffers?: {
    name: string;
    description: string;
    version?: string;
    hash?: string;
    source?: string;
  }[];
}
function tool(name: string, description: string, key: string): ToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters: object({ [key]: str }, [key]) },
  };
}
export function assertExtensionWorkspace(snapshot: ExtensionSnapshot, workspace: string): void {
  separateWorkspace(workspace, snapshot.trustedPaths ?? [snapshot.configFile, snapshot.stateDir]);
}

export async function prepareExtensions(opts: ExtensionOptions = {}): Promise<ExtensionSnapshot> {
  const stateDir = opts.stateDir ?? defaultExtensionState;
  const market = opts.market ?? true;
  const configFile = opts.configFile ?? defaultMcpConfig;
  const skillDir = opts.skillDir ?? resolve(projectRoot, 'skills');
  const trackerFile = opts.trackerFixture ?? resolve(projectRoot, 'configs/tracker.json');
  const servers = [...new Set(opts.servers ?? ['tracker'])];
  const trusted = [
    ...(opts.skills === false ? [] : [skillDir]),
    ...(market ? [stateDir, resolve(projectRoot, 'market')] : []),
    ...(servers.length ? [configFile] : []),
    ...(servers.includes('tracker') ? [trackerFile] : []),
  ];
  if (opts.workspace) separateWorkspace(opts.workspace, trusted);
  const result: ExtensionSnapshot = {
    skills: [],
    definitions: [],
    errors: [],
    mcp: [],
    market,
    stateDir,
    configFile,
    trustedPaths: trusted,
    disabledSkills: [...new Set(opts.disabledSkills ?? [])],
    marketOffers: [],
  };
  if (opts.skills !== false) {
    const local = discoverSkills(skillDir);
    result.errors.push(...local.errors);
    const skills = new Map(local.skills.map((s) => [s.name, s]));
    if (market)
      try {
        const status = new SkillMarket(stateDir).status();
        for (const skill of status.installed) skills.set(skill.name, skill);
        result.marketOffers = status.available
          .filter((p) => !skills.has(p.name) && !opts.disabledSkills?.includes(p.name))
          .map(({ name, description, version, hash }) => ({
            name,
            description,
            version,
            hash,
            source: 'study-market/' + status.settings.source,
          }));
      } catch (error) {
        result.market = false;
        result.errors.push('market: ' + (error as Error).message);
      }
    for (const [name, raw] of Object.entries(opts.skillOverrides ?? {}))
      skills.set(name, parseSkill(raw, name, 'evaluation'));
    result.skills = [...skills.values()].filter((s) => !opts.disabledSkills?.includes(s.name));
    result.definitions.push(
      tool('load_skill', 'Load the full instructions of one relevant skill by name.', 'name'),
    );
    if (result.market)
      result.definitions.push(
        tool('market_search', 'Search the catalog for not yet installed skills.', 'query'),
        tool('market_install', 'Install a catalog skill for future runs.', 'name'),
      );
  }
  for (const server of servers) {
    let spec;
    try {
      spec = serverSpec(configFile, server);
    } catch (error) {
      result.errors.push(server + ': ' + (error as Error).message);
      continue;
    }
    const paths = [spec.entry, ...spec.allowRead];
    if (opts.workspace) separateWorkspace(opts.workspace, paths);
    trusted.push(...paths);
    try {
      if (server === 'tracker') result.trackerData = readSmallFile(trackerFile, 64 * 1024);
      const discovered = await discoverMcp(
        server,
        spec,
        server === 'tracker' ? result.trackerData : undefined,
      );
      for (const t of discovered) {
        try {
          extensionValidator(t.definition.function.parameters);
        } catch (error) {
          result.errors.push(t.definition.function.name + ': ' + (error as Error).message);
          continue;
        }
        result.mcp.push(t);
        result.definitions.push(t.definition);
      }
    } catch (e) {
      result.errors.push(server + ': ' + (e as Error).message);
    }
  }
  return result;
}
export { validateExtension, executeExtension } from './dispatch.js';
