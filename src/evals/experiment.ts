import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpointDigest } from './checkpoint.js';
import { cases } from './cases.js';
import type { Kind } from './types.js';
import { atomicWrite } from './report.js';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export interface SuiteOptions {
  kind: Kind;
  outputDir: string;
  oldSkillDir?: string;
  newSkillDir?: string;
  onProgress?: (summary: import('./types.js').EvalSummary) => void;
}
export const sha = (s: Buffer | string) => createHash('sha256').update(s).digest('hex');

function loopback(raw: string): URL {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('Eval requires a local loopback model endpoint.');
  }
  return url;
}

async function modelIdentity() {
  const endpoint = loopback(process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:11434/v1');
  const name = process.env.OPENAI_MODEL;
  if (!name) throw new Error('Set OPENAI_MODEL to the local generation model.');
  let digest: string | null = null;
  try {
    const res = await fetch(new URL('/api/tags', endpoint), {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { models: { name: string; digest: string }[] };
    digest = body.models.find((m) => m.name === name)?.digest ?? null;
  } catch {
    /* Compatible local backends may not publish an Ollama digest. */
  }
  return { name, digest, endpoint: endpoint.origin, temperature: 0.2, max_tokens: 384 };
}

function pin(files: Map<string, Buffer>, key: string, path: string) {
  files.set(key, readFileSync(path));
}

export async function freezeExperiment(options: SuiteOptions): Promise<string> {
  const out = resolve(options.outputDir);
  const frozen = join(out, 'snapshot');
  const files = new Map<string, Buffer>();
  const fixtures = join(root, 'evals', 'fixtures');
  for (const name of readdirSync(fixtures).sort())
    pin(files, 'fixtures/' + name, join(fixtures, name));
  pin(files, 'policy.json', join(root, 'evals', 'policy.json'));
  pin(files, 'PROTOCOL.md', join(root, 'evals', 'PROTOCOL.md'));
  pin(files, 'package-lock.json', join(root, 'package-lock.json'));
  for (const name of ['open-tasks', 'owner-summary', 'release-notes']) {
    for (const version of ['old', 'new'] as const) {
      const override = version === 'new' ? options.newSkillDir : options.oldSkillDir;
      const pack =
        name === 'open-tasks'
          ? (override ?? join(root, 'market', version === 'new' ? 'v2' : 'v1', name))
          : join(root, 'skills', name);
      pin(files, `skills/${version}/${name}/SKILL.md`, join(pack, 'SKILL.md'));
    }
  }
  const router = loopback(process.env.LAYA_BASE_URL ?? 'http://127.0.0.1:18000');
  const manifest = {
    format: 1,
    kind: options.kind,
    model: await modelIdentity(),
    router: {
      model: 'multilingual',
      endpoint: router.origin,
      checkpoint_sha256: await checkpointDigest(router),
      kind: 'Laya System One; one forward pass for typed skill and MCP choice',
    },
    mode: 'auto',
    plan: false,
    attempts: 3,
    code: Object.fromEntries(
      ['cases', 'gate', 'trial'].map((n) => [
        n,
        sha(readFileSync(join(root, 'src', 'evals', n + '.ts'))),
      ]),
    ),
    files: Object.fromEntries([...files].map(([f, v]) => [f, sha(v)])),
    cases: cases.map(({ check, ...rest }) => ({ ...rest, check: check.name })),
    verification: { kind: 'file_changed', path: 'answer.json' },
    runtime: process.version,
  };
  const snapshot = JSON.stringify(manifest, null, 2) + '\n';
  const target = join(out, 'manifest.json');
  if (existsSync(target) && readFileSync(target, 'utf8') !== snapshot)
    throw new Error(
      'Контракт эксперимента изменился. Для нового эксперимента укажите другой --out.',
    );
  for (const [name, bytes] of files) {
    const path = join(frozen, name);
    if (existsSync(path)) {
      if (sha(readFileSync(path)) !== sha(bytes))
        throw new Error(`Изменён снимок ${relative(out, path)}`);
    } else {
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, bytes, { flag: 'wx' });
    }
  }
  atomicWrite(target, snapshot);
  return frozen;
}
