import type { Args, ToolResult } from '../types.js';
import type { ExtensionSnapshot } from './index.js';
import { SkillMarket } from './market.js';
import { callMcp } from './mcp.js';
import { extensionValidator, validationError } from './validation.js';

export function validateExtension(snapshot: ExtensionSnapshot, name: string, raw: string): Args {
  const def = snapshot.definitions.find((t) => t.function.name === name);
  if (!def) throw new Error('Extension denied or unknown: ' + name);
  if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('Extension arguments too large');
  const args = JSON.parse(raw);
  const validate = extensionValidator(def.function.parameters);
  if (!validate(args)) throw new Error('Invalid extension arguments: ' + validationError(validate));
  return args as Args;
}
export async function executeExtension(
  s: ExtensionSnapshot,
  name: string,
  args: Args,
): Promise<ToolResult> {
  try {
    validateExtension(s, name, JSON.stringify(args));
    if (name === 'load_skill') {
      const skill = s.skills.find((p) => p.name === args.name);
      if (!skill) throw new Error('Skill unavailable for this run: ' + String(args.name));
      return {
        ok: true,
        content: skill.content,
        skill: skill.name,
        version: skill.version,
        hash: skill.hash,
      };
    }
    if (s.market && name === 'market_search') {
      const query = String(args.query).toLowerCase().trim();
      const offers = s.marketOffers ?? new SkillMarket(s.stateDir).status().available;
      const matches = offers.filter(
        (p) =>
          !s.disabledSkills?.includes(p.name) &&
          (p.name + ' ' + p.description).toLowerCase().includes(query),
      );
      return { ok: true, content: JSON.stringify(matches) };
    }
    if (s.market && name === 'market_install') {
      const name = String(args.name);
      if (
        s.disabledSkills?.includes(name) ||
        (s.marketOffers && !s.marketOffers.some((p) => p.name === name))
      ) {
        throw new Error('Skill is not an approved offer for this run: ' + name);
      }
      const expectedHash = s.marketOffers?.find((p) => p.name === name)?.hash;
      const installed = new SkillMarket(s.stateDir).install(name, expectedHash);
      return {
        ok: true,
        content: 'Installed for subsequent runs: ' + installed.name,
        hash: installed.hash,
        source: installed.source,
        version: installed.version,
      };
    }
    const mcp = s.mcp.find((p) => p.definition.function.name === name);
    if (!mcp) throw new Error('Tool not found in approved MCP catalog');
    return await callMcp(
      mcp,
      args,
      s.configFile,
      mcp.server === 'tracker' ? s.trackerData : undefined,
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
