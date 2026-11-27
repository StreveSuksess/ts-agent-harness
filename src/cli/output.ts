import type { RunState } from '../types.js';
import type { CliArguments } from './arguments.js';
import { formatRun, formatTasks } from './presentation.js';
import { formatTrace } from './trace.js';
import { oneLine } from './terminal-text.js';

export type OutputMode = 'human' | 'json' | 'legacy';

export function outputMode({ command, flags, id }: CliArguments): OutputMode {
  if (flags.has('json')) return 'json';
  if (process.stdout.isTTY || command === 'run' || command === 'runs' || command === 'trace') {
    return 'human';
  }
  return command === 'start' || id ? 'legacy' : 'human';
}

export function printState(run: RunState, mode: OutputMode, db?: string): void {
  if (mode === 'human') {
    console.log(formatRun(run, db));
    return;
  }

  const summary = {
    run_id: run.id,
    status: run.status,
    phase: run.phase,
    reason: run.reason,
    final: run.final,
    spent: run.spent,
    reservedSideEffects: run.reservedSideEffects,
    limits: run.limits,
    plan: run.plan,
    pending: run.pending[0]?.call,
    decisions: run.decisions,
    workspace: run.workspace,
    prompt: run.prompt,
    tasks: run.tasks,
    mode: run.mode,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (mode === 'legacy' && run.tasks.length) console.log(formatTasks(run));
}

/** Print each committed tool message once, including results from the last batch before a pause. */
export class LiveOutput {
  private messages: number | undefined;
  private requests = 0;
  private task: string | null = null;
  private names = new Map<string, string>();

  startAt(run: RunState): void {
    this.messages = run.messages.length;
    this.requests = run.spent.modelRequests;
    this.task = run.activeTaskId;
    for (const message of run.messages) {
      for (const call of message.tool_calls ?? []) this.names.set(call.id, call.function.name);
    }
  }

  saved(run: RunState): void {
    if (this.messages === undefined) return;
    const added = run.messages.slice(this.messages);
    this.messages = run.messages.length;
    // The terminal summary prints the full final answer.
    if (run.final !== undefined && added.at(-1)?.role === 'assistant') added.pop();
    for (const line of formatTrace(added, this.names)) console.log(line);

    if (run.activeTaskId !== this.task) {
      this.task = run.activeTaskId;
      const current = run.tasks.find((task) => task.id === this.task);
      if (current) console.log(`\nЗадача   ${oneLine(current.description)}`);
    }
    if (run.spent.modelRequests > this.requests) {
      this.requests = run.spent.modelRequests;
      console.log(`\nЗапрос к модели ${this.requests}/${run.limits.modelRequests}…`);
    }
  }
}
