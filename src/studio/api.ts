import { doctorReport } from './doctor.js';
import { StudioJobs } from './jobs.js';
import { SettingsStore } from './settings.js';
import { StudioSessions, studioDir, generatorName } from './sessions.js';
import { StudioCatalog, required, type CommandInput } from './catalog.js';
import type { RunState } from '../types.js';

export async function createStudioApi(
  options: { dir?: string; onSave?: (run: RunState) => void } = {},
) {
  const sessions = new StudioSessions(options.dir ?? studioDir, options.onSave);
  const settings = new SettingsStore(sessions.dir);
  const jobs = new StudioJobs();
  const catalog = new StudioCatalog(settings, jobs);
  const busy = new Map<string, Promise<void>>();
  const failures: Record<string, string> = Object.create(null);
  await catalog.discover();
  catalog.check();

  function advance(id: string) {
    if (busy.has(id)) return;
    delete failures[id];
    const work = sessions.runtime
      .run(id)
      .then(() => {})
      .catch((e: Error) => {
        failures[id] = e.message;
      })
      .finally(() => {
        busy.delete(id);
      });
    busy.set(id, work);
  }

  async function wait(id: string) {
    await busy.get(id);
    if (failures[id]) throw new Error(failures[id]);
    return sessions.store.get(id);
  }

  function state() {
    const extensions = catalog.snapshot();
    return {
      ...extensions,
      model: generatorName(),
      router: 'Laya multilingual',
      sessions: sessions.list(),
      errors: [...extensions.errors, ...Object.values(failures)],
      evaluations: jobs.summaries(),
    };
  }

  async function command(action: string, input: CommandInput = {}) {
    switch (action) {
      case 'prompt': {
        catalog.check();
        const id = input.sessionId === undefined ? undefined : required(input, 'sessionId');
        const run = await sessions.start(required(input, 'prompt'), settings.read(), id);
        advance(run.id);
        return { sessionId: run.sessionId!, runId: run.id };
      }
      case 'decision': {
        const run = sessions.store.get(required(input, 'runId'));
        const choice = required(input, 'decision');
        if (input.sessionId !== undefined && input.sessionId !== run.sessionId)
          throw new Error('Запуск принадлежит другой сессии.');
        if (!['allow', 'deny'].includes(choice) || !Number.isInteger(input.revision))
          throw new Error('Укажите allow/deny и ревизию показанного состояния.');
        const revision = Number(input.revision);
        const allow = choice === 'allow';
        if (run.status === 'awaiting_plan')
          sessions.runtime.approvePlan(run.id, allow, {
            expectedRevision: revision,
            ...(input.feedback ? { feedback: required(input, 'feedback') } : {}),
          });
        else sessions.runtime.approveAction(run.id, allow, revision);
        advance(run.id);
        return { sessionId: run.sessionId, runId: run.id };
      }
      case 'resume': {
        const run = sessions.store.get(required(input, 'runId'));
        advance(run.id);
        return { sessionId: run.sessionId, runId: run.id };
      }
      case 'eval.start':
        if (input.kind === 'update') jobs.evaluate(catalog.market);
        else if (input.kind === 'ab') jobs.startAb();
        else throw new Error('Укажите ab или update');
        return { started: true };
      case 'eval.events': {
        const events = jobs.events(input.kind, input.runId);
        return { events, doctor: doctorReport(events) };
      }
      case 'doctor': {
        const runs = sessions.all().get(required(input, 'sessionId'));
        if (!runs) throw new Error('Сессия не найдена');
        return doctorReport(runs.flatMap((r) => r.events ?? []));
      }
      default:
        return catalog.command(action, input);
    }
  }
  return {
    snapshot: state,
    command,
    wait,
    sessions,
    close() {
      settings.close();
      sessions.store.close();
    },
  };
}
export type StudioApi = Awaited<ReturnType<typeof createStudioApi>>;
