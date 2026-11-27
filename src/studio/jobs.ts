import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { projectRoot } from '../cli/paths.js';
import { compareSkills, runSuite } from '../evals/runner.js';
import type { EvalSummary, Kind } from '../evals/types.js';
import type { SkillMarket } from '../extensions/market.js';
import type { AgentEvent } from './events.js';

interface Job {
  dir: string;
  kind: Kind;
  attached: boolean;
}
interface Marker {
  started: string;
  error?: string;
}
function marker(dir: string): Marker | undefined {
  const path = join(dir, 'studio-job.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}
function saveMarker(dir: string, value: Marker) {
  const path = join(dir, 'studio-job.json');
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}
function readReport(job: Job): EvalSummary {
  const path = join(job.dir, 'summary.json');
  return existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { kind: job.kind, total: 30, completed: 0, groups: [], rows: [] };
}

/** Attached grading evidence is read-only. Browser-initiated experiments own separate resumable directories. */
export class StudioJobs {
  private readonly active = new Set<string>();
  constructor(
    private readonly dir = join(projectRoot, '.agent', 'studio', 'evaluations'),
    private readonly evidence = join(projectRoot, 'evidence'),
  ) {}
  private available(): Job[] {
    const jobs: Job[] = [];
    if (existsSync(this.dir))
      for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^(ab|update)-[a-z0-9-]+$/u.test(entry.name)) continue;
        jobs.push({
          kind: entry.name.startsWith('ab-') ? 'ab' : 'update',
          dir: join(this.dir, entry.name),
          attached: false,
        });
      }
    jobs.sort((a, b) => b.dir.localeCompare(a.dir));
    for (const kind of ['ab', 'update'] as const) {
      const dir = join(this.evidence, kind);
      if (existsSync(join(dir, 'summary.json'))) jobs.push({ kind, dir, attached: true });
    }
    return jobs;
  }
  summaries() {
    return this.available().map((job) => {
      const report = readReport(job),
        info = marker(job.dir);
      const status = this.active.has(job.dir)
        ? 'Выполняется'
        : info?.error
          ? 'Ошибка'
          : report.completed === report.total
            ? 'Завершено'
            : job.attached
              ? 'Сохранено на диске'
              : 'Приостановлено';
      return {
        ...report,
        id: job.attached ? 'evidence-' + job.kind : basename(job.dir),
        status,
        error: info?.error,
        started: info?.started,
        source: job.attached ? 'Материалы сдачи' : 'Локальный запуск',
      };
    });
  }
  private launch(dir: string, work: () => Promise<unknown>): void {
    if (this.active.has(dir)) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const started = new Date().toISOString();
    saveMarker(dir, { started });
    this.active.add(dir);
    void Promise.resolve()
      .then(work)
      .catch((error) => {
        saveMarker(dir, { started, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => this.active.delete(dir));
  }
  startAb(): void {
    const prior = this.available().find(
      (j) => !j.attached && j.kind === 'ab' && readReport(j).completed < 30,
    );
    const dir = prior?.dir ?? join(this.dir, 'ab-' + Date.now() + '-' + randomUUID().slice(0, 8));
    this.launch(dir, () => runSuite({ kind: 'ab', outputDir: dir }));
  }
  evaluate(market: SkillMarket): void {
    const candidate = market.status().candidate;
    if (!candidate) throw new Error('Нет кандидата для проверки.');
    if (![candidate.oldHash, candidate.newHash].every((s) => /^[a-f0-9]{64}$/u.test(s)))
      throw new Error('Некорректная ревизия скилла.');
    const dir = join(this.dir, `update-${candidate.oldHash}-${candidate.newHash}`);
    this.launch(dir, () => market.review(compareSkills, dir));
  }
  events(kind: unknown, runId: unknown): AgentEvent[] {
    if ((kind !== 'ab' && kind !== 'update') || typeof runId !== 'string' || runId.length > 128)
      throw new Error('Некорректный ID попытки.');
    for (const job of this.available().filter((j) => j.kind === kind)) {
      const row = readReport(job).rows.find((r) => r.run_id === runId);
      if (!row) continue;
      const path = realpathSync(resolve(job.dir, row.events_path));
      const rel = relative(realpathSync(job.dir), path);
      if (
        isAbsolute(rel) ||
        rel.startsWith('..' + sep) ||
        basename(path) !== 'events.jsonl' ||
        !statSync(path).isFile()
      )
        throw new Error('Журнал находится вне каталога эксперимента.');
      const file = readFileSync(path, 'utf8').trim();
      return file ? file.split('\n').map((line) => JSON.parse(line) as AgentEvent) : [];
    }
    throw new Error('Журнал попытки не найден.');
  }
}
