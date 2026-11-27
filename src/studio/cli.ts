import { askTask, askApproval } from '../cli/dialog.js';
import { LiveOutput } from '../cli/output.js';
import { formatReview, formatRun } from '../cli/presentation.js';
import { terminalText } from '../cli/terminal-text.js';
import { createStudioApi, type StudioApi } from './api.js';
import { doctorReport } from './doctor.js';
import { formatStatistics, formatDoctor } from './terminal-reports.js';
import type { RunState } from '../types.js';

const commands = '/stats · /doctor · /sessions · /resume · /new · /rollback-update · /exit';

function liveReporter() {
  const live = new LiveOutput();
  let observed = '';
  let cursor = 0;

  return (run: RunState) => {
    if (run.id !== observed) {
      live.startAt(run);
      cursor = 0;
      observed = run.id;
    }
    live.saved(run);
    for (const event of (run.events ?? []).slice(cursor)) {
      if (event.type === 'laya_route') {
        const { skill, marketSkill, mcp } = event.data;
        console.log(
          terminalText(`[Laya] скилл: ${skill ?? marketSkill ?? '—'} · MCP: ${mcp ?? '—'}`),
        );
      }
      if (event.type === 'catalog_error')
        console.log(terminalText('Ошибка каталога · ' + event.data.error));
    }
    cursor = run.events?.length ?? 0;
  };
}

async function interact(api: StudioApi, id: string, sessionId: string) {
  for (;;) {
    const run = await api.wait(id);
    if (run.status !== 'awaiting_plan' && run.status !== 'awaiting_action') {
      console.log(formatRun(run, api.sessions.store.file));
      console.log('Сессия   ' + sessionId);
      return true;
    }

    console.log(formatReview(run));
    const answer = await askApproval(run);
    if (answer.decision === 'pause') {
      console.log(`Чтобы вернуться, введите agent tracker ${sessionId}, затем /resume`);
      return false;
    }
    await api.command('decision', {
      runId: id,
      sessionId,
      revision: run.revision,
      decision: answer.decision === 'accept' ? 'allow' : 'deny',
      ...(answer.decision === 'reject' && answer.feedback ? { feedback: answer.feedback } : {}),
    });
  }
}

export async function studioChat(sessionId?: string) {
  const api = await createStudioApi({ onSave: liveReporter() });
  try {
    console.log('Учебный трекер · Laya выбирает скиллы и MCP\n' + commands);
    if (sessionId && !api.sessions.all().has(sessionId)) throw new Error('Сессия не найдена');

    for (;;) {
      const prompt = await askTask(
        undefined,
        sessionId ? 'Следующий запрос' : 'Что поручить агенту?',
      );
      if (prompt === undefined) return;
      const runs = sessionId ? (api.sessions.all().get(sessionId) ?? []) : [];
      try {
        switch (prompt) {
          case '/help':
            console.log(commands);
            continue;
          case '/sessions':
            for (const s of api.sessions.list()) console.log(s.id + '  ' + terminalText(s.title));
            continue;
          case '/new':
            sessionId = undefined;
            continue;
          case '/stats':
            console.log(formatStatistics(runs));
            continue;
          case '/doctor':
            if (sessionId)
              console.log(formatDoctor(doctorReport(runs.flatMap((r) => r.events ?? []))));
            else console.log('Сначала введите запрос.');
            continue;
          case '/rollback-update':
            await api.command('market.rollback');
            console.log('Предыдущая версия скилла восстановлена.');
            continue;
          case '/resume': {
            const last = runs.at(-1);
            if (!last || !sessionId) {
              console.log('В этой сессии ещё нет запусков.');
              continue;
            }
            await api.command('resume', { runId: last.id });
            if (!(await interact(api, last.id, sessionId))) return;
            continue;
          }
        }
        if (prompt.startsWith('/')) {
          console.log(commands);
          continue;
        }
        const result = (await api.command('prompt', { prompt, sessionId })) as {
          runId: string;
          sessionId: string;
        };
        sessionId = result.sessionId;
        if (!(await interact(api, result.runId, sessionId))) return;
      } catch (error) {
        console.log(terminalText(error instanceof Error ? error.message : String(error)));
      }
    }
  } finally {
    api.close();
  }
}
