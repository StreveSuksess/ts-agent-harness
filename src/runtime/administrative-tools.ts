import { Policy } from '../policy.js';
import { validateArguments, validatePlan } from '../schema.js';
import { assertTree, snapshot, treeDiff } from '../journal.js';
import { PROJECT_TOOLS, now } from '../types.js';
import type { Args, Pending, RunState, ToolResult } from '../types.js';
import { selectNextTask } from './task-state.js';

export function executeAdministrativeCall(
  run: RunState,
  pending: Pending,
  args: Args,
  policy: Policy,
): ToolResult {
  if (pending.call.function.name === 'submit_plan') {
    if (run.phase !== 'plan') {
      throw new Error('Plan submission is only available in Plan Mode');
    }

    const plan = validatePlan(args.plan);

    for (const step of plan.steps) {
      if (step.verification.kind === 'file_changed') {
        policy.path(step.verification.path);
      }
    }

    run.plan = plan;
    run.status = 'awaiting_plan';

    return { ok: true, content: 'Plan saved. Waiting for explicit approval.' };
  }

  if (pending.call.function.name === 'complete_task') {
    if (run.phase !== 'execute' || !run.activeTaskId) {
      throw new Error('No active execution task');
    }

    const task = run.tasks.find((candidateTask) => candidateTask.id === run.activeTaskId)!;
    const evidenceId = args.evidence_call_id as string;
    const evidence = Object.hasOwn(run.calls, evidenceId) ? run.calls[evidenceId] : undefined;

    if (
      !evidence ||
      evidence.status !== 'completed' ||
      evidence.taskId !== task.id ||
      evidence.phase !== 'execute' ||
      !evidence.result?.ok ||
      !PROJECT_TOOLS.has(evidence.call.function.name)
    ) {
      throw new Error('Evidence must be a successful project tool call from the current task');
    }

    const verification = task.verification;

    if (verification.kind === 'tool' && evidence.call.function.name !== verification.tool) {
      throw new Error('Evidence tool does not match verification');
    }

    if (verification.kind === 'bash') {
      const evidenceArguments = validateArguments(
        evidence.call.function.name,
        evidence.call.function.arguments,
      );

      if (
        evidence.call.function.name !== 'Bash' ||
        evidenceArguments.command !== verification.command ||
        evidence.result.exitCode !== verification.exitCode ||
        evidence.result.timedOut
      ) {
        throw new Error('Bash verification does not match saved command/exit code');
      }

      const current = snapshot(policy);

      assertTree(run.expected, current);

      const verifiedTree = evidence.attempts.at(-1)?.after;

      if (!verifiedTree) {
        throw new Error('Bash evidence has no saved workspace snapshot');
      }

      assertTree(verifiedTree, current);
    }

    if (verification.kind === 'file_changed') {
      policy.path(verification.path);

      const current = snapshot(policy);

      assertTree(run.expected, current);

      const change = evidence.attempts
        .flatMap((attempt) => (attempt.after ? treeDiff(attempt.before, attempt.after) : []))
        .find((change) => change.path === verification.path);

      if (!change || current[verification.path]?.hash !== change.after?.hash) {
        throw new Error('No verified file change for the requested path');
      }
    }

    task.status = 'completed';
    task.evidence = { callId: evidenceId, result: evidence.result, verifiedAt: now() };
    selectNextTask(run);

    return { ok: true, content: `Task ${task.id} completed with evidence ${evidenceId}` };
  }

  throw new Error('Unknown administrative tool');
}
