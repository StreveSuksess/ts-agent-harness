import type { Runtime } from '../runtime.js';
import type { CliArguments } from './arguments.js';

export function applyDecision(
  runtime: Runtime,
  id: string,
  { command, flags }: CliArguments,
): void {
  const decision = flags.get('decision');
  if (command === 'approve-plan') {
    const feedback = flags.get('feedback');
    runtime.approvePlan(id, decision === 'approve', feedback ? { feedback } : {});
  } else if (command === 'approve-action') {
    runtime.approveAction(id, decision === 'allow');
  } else if (command === 'resolve') {
    const choice = flags.get('attribute');
    runtime.resolve(
      id,
      decision as 'retry' | 'fail' | 'abort',
      choice === undefined ? undefined : choice === 'yes',
    );
  }
}
