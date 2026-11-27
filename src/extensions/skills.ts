import { constants, closeSync, fstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

export interface Skill {
  name: string;
  description: string;
  version: string;
  hash: string;
  source: string;
  content: string;
}

// Laya reserves the exact choice key "none" for skipping a capability.
export function validSkillName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== 'none' &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function readSmallFile(path: string, limit = 64 * 1024): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || stat.nlink !== 1)
      throw new Error('Expected a bounded regular file');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (bytes === 0) break;
      count += bytes;
    }
    if (count !== stat.size) throw new Error('File changed during read');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, count),
    );
  } finally {
    closeSync(fd);
  }
}

export function parseSkill(content: string, name: string, source: string, version?: string): Skill {
  if (!validSkillName(name) || Buffer.byteLength(content) > 65536) {
    throw new Error('Invalid skill name or package size: ' + name);
  }
  const parts = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(content.replaceAll('\r\n', '\n'));
  if (!parts || !parts[2]!.trim()) throw new Error('Missing YAML frontmatter or skill steps');
  const document = parseDocument(parts[1]!, { schema: 'failsafe', prettyErrors: false });
  if (document.errors.length || document.warnings.length)
    throw new Error('Invalid YAML frontmatter');
  const metadata = document.toJS({ maxAliasCount: 0 });
  if (!metadata || typeof metadata !== 'object' || metadata.name !== name) {
    throw new Error('Skill name must match its folder: ' + name);
  }
  const description = metadata.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) {
    throw new Error('Invalid skill description: ' + name);
  }
  const hash = digest(content);
  return { name, description, content, source, version: version ?? hash.slice(0, 12), hash };
}

export function discoverSkills(directory: string): { skills: Skill[]; errors: string[] } {
  const skills: Skill[] = [];
  const errors: string[] = [];
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      try {
        skills.push(
          parseSkill(readSmallFile(join(directory, entry.name, 'SKILL.md')), entry.name, 'local'),
        );
      } catch (error) {
        errors.push(entry.name + ': ' + (error as Error).message);
      }
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  return { skills, errors };
}
