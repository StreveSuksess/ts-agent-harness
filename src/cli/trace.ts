import type { Message, ToolCall } from '../types.js';
import { indented, oneLine, terminalText } from './terminal-text.js';

function preview(input: string): string {
  const clean = terminalText(input);
  const lines = clean.slice(0, 600).split('\n');
  const shortened = clean.length > 600 || lines.length > 8;

  return lines.slice(0, 8).join('\n').trimEnd() + (shortened ? ' …' : '');
}

function readObject(input: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Show malformed proposals as written. The runtime owns protocol validation.
  }
  return undefined;
}

function proposal(call: ToolCall): string {
  const { name, arguments: raw } = call.function;
  const args = readObject(raw);
  let detail = raw;

  if (name === 'Bash' && typeof args?.command === 'string' && typeof args.cwd === 'string') {
    detail = `${args.command}   (каталог ${args.cwd})`;
  } else if (typeof args?.path === 'string') {
    detail = args.path;
    if (typeof args.content === 'string') detail += `   (${Buffer.byteLength(args.content)} Б)`;
  } else if (name === 'complete_task' && typeof args?.evidence_call_id === 'string') {
    detail = `подтверждение ${args.evidence_call_id}`;
  } else if (name === 'submit_plan' && args?.plan) {
    detail = 'отправить план на проверку';
  }
  return `→ ${preview(oneLine(name))}  ${preview(oneLine(detail))}  [${oneLine(call.id)}]`;
}

function resultLine(message: Message, name: string | undefined): string {
  const raw = message.content ?? '';
  const result = readObject(raw);
  const target = preview(oneLine(name ?? message.tool_call_id ?? 'инструмент'));
  if (!result || typeof result.ok !== 'boolean') {
    return `  ↳ ${target}\n${indented(preview(raw))}`;
  }

  const outcome = result.ok ? 'готово' : 'ошибка';
  const exit = Object.hasOwn(result, 'exitCode') ? ` · exit ${String(result.exitCode)}` : '';
  const lines = [`  ↳ ${target} · ${outcome}${oneLine(exit)}`];
  if (result.timedOut) lines.push('    Истекло время выполнения');
  if (typeof result.error === 'string') lines.push(indented(preview(result.error)));
  if (Array.isArray(result.files)) {
    const files = result.files
      .filter((file): file is string => typeof file === 'string')
      .map(oneLine);
    lines.push(indented(preview(files.join(', ') || '(пустой каталог)')));
  }
  for (const key of ['content', 'stdout', 'stderr']) {
    const value = result[key];
    if (typeof value === 'string' && value.length) {
      lines.push(indented((key === 'content' ? '' : key + '\n') + preview(value)));
    }
  }
  if (result.truncated) lines.push('    Инструмент вернул сокращённый результат');
  return lines.join('\n');
}

/** Format only model proposals and tool responses. A slice can start midway through a batch. */
export function formatTrace(
  messages: readonly Message[],
  names = new Map<string, string>(),
): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (message.content) lines.push('Модель\n' + indented(preview(message.content)));
      for (const call of message.tool_calls ?? []) {
        names.set(call.id, call.function.name);
        lines.push(proposal(call));
      }
    } else if (message.role === 'tool') {
      lines.push(resultLine(message, names.get(message.tool_call_id ?? '')));
    }
  }
  return lines;
}
