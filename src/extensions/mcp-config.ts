import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { projectRoot } from '../cli/paths.js';
import { digest, readSmallFile } from './skills.js';

export const defaultMcpConfig = resolve(projectRoot, 'configs/mcp.json');
export interface ServerSpec {
  entry: string;
  entryHash: string;
  args: string[];
  allowRead: string[];
  readOnlyTools: string[];
  timeoutMs: number;
}
const validServerName = /^[a-z][a-z0-9-]{0,25}$/;

function entries(configFile: string): Record<string, unknown> {
  const config = JSON.parse(readSmallFile(configFile));
  if (!config?.servers || Array.isArray(config.servers) || typeof config.servers !== 'object')
    throw new Error('Missing MCP servers object');
  return config.servers;
}

function stringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string' && !v.includes('\0'));
}

export function serverSpec(configFile: string, name: string): ServerSpec {
  const servers = entries(configFile);
  if (!validServerName.test(name) || !Object.hasOwn(servers, name))
    throw new Error('MCP server is not approved: ' + name);
  const spec = servers[name] as ServerSpec & { command: string };
  if (
    !spec ||
    spec.command !== 'node' ||
    typeof spec.entry !== 'string' ||
    !stringArray(spec.args) ||
    !stringArray(spec.allowRead) ||
    !stringArray(spec.readOnlyTools)
  )
    throw new Error('Invalid trusted server configuration: ' + name);
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 30000)
    throw new Error('Invalid MCP timeout');
  const absolute = (path: string) => realpathSync(resolve(dirname(configFile), path));
  const entry = absolute(spec.entry);
  return {
    entry,
    entryHash: digest(readSmallFile(entry, 1024 * 1024)),
    args: spec.args,
    allowRead: spec.allowRead.map(absolute),
    readOnlyTools: spec.readOnlyTools,
    timeoutMs: spec.timeoutMs,
  };
}

export function configuredServers(configFile = defaultMcpConfig): string[] {
  return Object.keys(entries(configFile)).filter((n) => validServerName.test(n));
}
