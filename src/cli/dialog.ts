import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { RunState } from '../types.js';

interface Terminal {
  input: Readable;
  output: Writable;
}

const stdio: Terminal = { input: process.stdin, output: process.stdout };
export type ApprovalAnswer =
  { decision: 'accept' | 'pause' } | { decision: 'reject'; feedback?: string };

function readAnswer<T>(
  { input, output }: Terminal,
  question: string,
  parse: (answer: string) => T | undefined,
): Promise<T | undefined> {
  if (input.readableEnded || input.destroyed) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const reader = createInterface({ input, output });
    const interrupt = () => {
      output.write('\n');
      reader.close();
    };
    reader.once('SIGINT', interrupt);
    reader.once('close', () => resolve(undefined));

    const ask = (prompt: string) => {
      reader.question(prompt, (line) => {
        // Readline can emit a final unterminated line during EOF.
        if (input.readableEnded) {
          reader.close();
          return;
        }
        const answer = parse(line.trim());
        if (answer !== undefined) {
          resolve(answer);
          reader.close();
        } else {
          ask('Введите да или нет. Enter — отложить решение › ');
        }
      });
    };
    ask(question);
  });
}

export async function askTask(
  terminal = stdio,
  question = 'Что поручить агенту?',
): Promise<string | undefined> {
  const answer = await readAnswer(terminal, question + ' (Enter — выход)\n› ', (line) => line);
  return answer && !['q', '/exit'].includes(answer.toLowerCase()) ? answer : undefined;
}

function parseApproval(answer: string, forPlan: boolean): ApprovalAnswer | undefined {
  const value = answer.toLowerCase();
  if (!value || value === 'q' || value === '/exit') return { decision: 'pause' };
  if (['да', 'д', 'yes', 'y'].includes(value)) return { decision: 'accept' };

  const rejection = /^(нет|н|no|n)(?:\s+(.+))?$/iu.exec(answer);
  if (!rejection) return undefined;
  const feedback = rejection[2];
  if (!feedback) return { decision: 'reject' };
  if (forPlan) return { decision: 'reject', feedback };
  return undefined;
}

export async function askApproval(
  run: Pick<RunState, 'status'>,
  terminal = stdio,
): Promise<ApprovalAnswer> {
  if (run.status !== 'awaiting_plan' && run.status !== 'awaiting_action') {
    throw new Error('У запуска нет ожидающего решения.');
  }

  const forPlan = run.status === 'awaiting_plan';
  const question = forPlan
    ? 'Принять план? Для уточнения напишите, например, «нет проверь тесты».'
    : 'Разрешить это действие?';
  const answer = await readAnswer(terminal, `${question} [да / нет / Enter — позже] › `, (line) =>
    parseApproval(line, forPlan),
  );
  return answer ?? { decision: 'pause' };
}
