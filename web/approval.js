import { el, text, button, details, pretty } from './dom.js';

function planBody(plan, feedback, id) {
  return [
    text('h3', plan.goal ?? 'План работы'),
    el(
      'ol',
      { class: 'approval-steps' },
      (plan.steps ?? []).map((step) =>
        el(
          'li',
          {},
          text('strong', step.description),
          text('small', (step.tools ?? []).join(' · ')),
          details(
            'Критерий и зависимости',
            { verification: step.verification, depends_on: step.depends_on },
            id + step.id,
          ),
        ),
      ),
    ),
    plan.done_when ? text('p', plan.done_when) : null,
    plan.risks?.length || plan.assumptions?.length
      ? details(
          'Риски и допущения',
          { risks: plan.risks, assumptions: plan.assumptions },
          id + '-risks',
        )
      : null,
    feedback,
  ];
}

function operationBody(run) {
  const pending = run.pending?.call ?? run.pending;
  const tool = pending?.function?.name;
  const raw = pending?.function?.arguments;
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    args = raw;
  }

  const fileWrite =
    tool === 'write_file' && typeof args?.content === 'string' && typeof args?.path === 'string';
  const workspace = (run.workspace ?? '').split(/[\\/]/u).at(-1);
  return [
    text('h3', fileWrite ? 'Разрешить запись файла?' : 'Разрешить действие?'),
    el(
      'div',
      { class: 'operation-preview' },
      el(
        'div',
        { class: 'operation-label' },
        text('code', fileWrite ? args.path : (tool ?? 'Операция')),
        fileWrite ? text('small', tool) : null,
      ),
      el('pre', {}, fileWrite ? args.content : (pretty(args) ?? '—')),
    ),
    workspace ? text('small', 'Рабочая папка · ' + workspace) : null,
  ];
}

export function approval(run, ctx) {
  const plan = run.status === 'awaiting_plan';
  if (!plan && run.status !== 'awaiting_action') return null;
  const feedback = el('input', {
    type: 'text',
    maxlength: 1000,
    placeholder: 'Комментарий при отклонении плана',
    'aria-label': 'Комментарий к отклонению плана',
  });
  const decide = (decision) =>
    ctx.action('decision', {
      runId: run.id,
      sessionId: ctx.sessionId,
      revision: run.revision,
      decision,
      ...(plan && decision === 'deny' && feedback.value.trim()
        ? { feedback: feedback.value.trim() }
        : {}),
    });

  return el(
    'section',
    { class: 'approval-box', 'aria-label': plan ? 'Согласование плана' : 'Разрешение на действие' },
    el(
      'div',
      { class: 'approval-content' },
      plan ? planBody(run.plan ?? {}, feedback, run.id) : operationBody(run),
    ),
    el(
      'div',
      { class: 'approval-buttons' },
      button('Отклонить', () => decide('deny'), 'thread-button'),
      button(plan ? 'Принять план' : 'Разрешить', () => decide('allow'), 'thread-button confirm'),
    ),
  );
}
