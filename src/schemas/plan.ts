import type { Plan } from '../types.js';
import { ajv, object, str, strings } from './common.js';

const verification = {
  oneOf: [
    object(
      {
        kind: { const: 'tool' },
        tool: { enum: ['read_file', 'list_files', 'write_file', 'delete_file', 'Bash'] },
      },
      ['kind', 'tool'],
    ),
    object({ kind: { const: 'file_changed' }, path: str }, ['kind', 'path']),
    object({ kind: { const: 'bash' }, command: str, exitCode: { type: 'integer' } }, [
      'kind',
      'command',
      'exitCode',
    ]),
  ],
};

export const planSchema = object(
  {
    goal: str,
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: object(
        {
          id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
          description: str,
          depends_on: strings,
          tools: {
            type: 'array',
            minItems: 1,
            items: { enum: ['read_file', 'list_files', 'write_file', 'delete_file', 'Bash'] },
          },
          verification,
        },
        ['id', 'description', 'depends_on', 'tools', 'verification'],
      ),
    },
    risks: strings,
    assumptions: strings,
    done_when: str,
  },
  ['goal', 'steps', 'risks', 'assumptions', 'done_when'],
);

export function validatePlan(value: unknown): Plan {
  const check = ajv.compile<Plan>(planSchema);

  if (!check(value)) {
    throw new Error(`Invalid plan: ${ajv.errorsText(check.errors)}`);
  }

  const plan = value as Plan;
  const ids = new Set(plan.steps.map((step) => step.id));

  if (ids.size !== plan.steps.length) {
    throw new Error('Task IDs must be unique');
  }

  const done = new Set<string>();

  while (done.size < ids.size) {
    const ready = plan.steps.filter(
      (step) => !done.has(step.id) && step.depends_on.every((id) => done.has(id)),
    );

    if (!ready.length) {
      throw new Error('Task dependencies contain a cycle or unknown ID');
    }

    for (const step of ready) {
      done.add(step.id);
    }
  }

  return plan;
}
