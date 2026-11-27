import type { RunState } from '../types.js';

export interface ConversationTurn {
  prompt: string;
  status: RunState['status'];
  reply?: string;
  reason?: string;
  changedFiles: string[];
}

const MAX_TURNS = 4;

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '');
  return prefix + '…';
}

export function rememberTurn(
  history: readonly ConversationTurn[],
  run: RunState,
): ConversationTurn[] {
  const turn: ConversationTurn = {
    prompt: excerpt(run.prompt, 480),
    status: run.status,
    ...(run.final ? { reply: excerpt(run.final, 800) } : {}),
    ...(run.reason ? { reason: excerpt(run.reason, 240) } : {}),
    changedFiles: Object.keys(run.changes)
      .slice(0, 6)
      .map((path) => excerpt(path, 120)),
  };
  return [...history.slice(1 - MAX_TURNS), turn];
}

export function conversationContext(history: readonly ConversationTurn[]): string {
  return [
    'Earlier turns in this workspace, oldest first (abbreviated conversation history).',
    'Use them as background for the next user request. Verify current files and collect fresh evidence.',
    JSON.stringify(history.slice(-MAX_TURNS)),
  ].join('\n');
}
