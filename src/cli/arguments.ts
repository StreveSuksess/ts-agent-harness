import { cliCommand } from './paths.js';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

const startFlags = ['task', 'workspace', 'policy', 'mode', 'no-plan', 'fault'];
const commandFlags = {
  run: [...startFlags, 'no-input'],
  start: startFlags,
  resume: ['fault', 'no-input'],
  runs: [],
  status: [],
  tasks: [],
  diff: [],
  trace: [],
  rollback: ['fault'],
  'resolve-rollback': ['fault'],
  'approve-plan': ['decision', 'feedback', 'fault'],
  'approve-action': ['decision', 'fault'],
  resolve: ['decision', 'attribute', 'fault'],
  demo: [],
  help: [],
};
type Command = keyof typeof commandFlags;
type Flags = Map<string, string>;

export interface CliArguments {
  command: Command;
  flags: Flags;
  id?: string;
  task?: string;
}

function getFlags(args: string[], command: Command) {
  const shared = command === 'demo' || command === 'help' ? [] : ['db', 'json'];
  const allowed = [...commandFlags[command], ...shared];
  const options: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
  for (const name of allowed) {
    options[name] = { type: ['json', 'no-plan', 'no-input'].includes(name) ? 'boolean' : 'string' };
  }
  const parsed = parseArgs({ args, options, tokens: true, allowPositionals: true });
  const flags: Flags = new Map();

  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (flags.has(token.name)) throw new Error(`Параметр --${token.name} указан дважды.`);
    if (token.value === '') throw new Error(`Для --${token.name} нужно значение.`);
    flags.set(token.name, token.value ?? 'true');
  }
  return { flags, positionals: parsed.positionals };
}

function checkChoice(flags: Flags, name: string, choices: string[], required = false): void {
  const value = flags.get(name);
  if (value === undefined && !required) return;
  if (!value || !choices.includes(value)) {
    throw new Error(`Для --${name} укажите ${choices.join(' / ')}.`);
  }
}

export function parseArguments(argv: string[]): CliArguments {
  const [first, ...rest] = argv;
  if (['--help', '-h', 'help'].includes(first ?? '')) return { command: 'help', flags: new Map() };

  const implicit = !first || first.startsWith('-') || /\s/u.test(first);
  const name = implicit ? 'run' : first;
  if (!Object.hasOwn(commandFlags, name)) {
    throw new Error(
      `Неизвестная команда «${name}». Список команд — ${cliCommand} --help. Для задачи используйте ${cliCommand} run "Текст".`,
    );
  }
  const command = name as Command;
  const args = implicit ? argv : rest;

  const { flags, positionals } = getFlags(args, command);
  if (flags.has('help')) return { command: 'help', flags };
  if (positionals.length > 1)
    throw new Error('Заключите текст задачи в кавычки или укажите один ID.');
  const [value] = positionals;
  checkChoice(flags, 'mode', ['safe', 'auto']);
  checkChoice(flags, 'fault', ['after_reservation', 'after_execute', 'after_rollback_write']);

  if (command === 'start' || command === 'run') {
    if (value !== undefined && flags.has('task')) throw new Error('Текст задачи указан дважды.');
    const task = (value ?? flags.get('task'))?.trim();
    if (task) return { command, flags, task };
    if (command === 'start' || value !== undefined || flags.has('task')) {
      throw new Error(`Укажите текст задачи, например ${cliCommand} run "Исправь расчёт заказа".`);
    }
    return { command, flags };
  }

  if (command === 'approve-plan') {
    checkChoice(flags, 'decision', ['approve', 'reject'], true);
    if (flags.has('feedback') && flags.get('decision') !== 'reject') {
      throw new Error('--feedback доступен при отклонении плана.');
    }
  }
  if (command === 'approve-action') checkChoice(flags, 'decision', ['allow', 'deny'], true);
  if (command === 'resolve') {
    checkChoice(flags, 'decision', ['retry', 'fail', 'abort'], true);
    checkChoice(flags, 'attribute', ['yes', 'no']);
  }
  if (value && (command === 'demo' || command === 'runs')) {
    throw new Error(`Команда ${command} не принимает ID.`);
  }
  if (
    !value &&
    ['rollback', 'resolve-rollback', 'approve-plan', 'approve-action', 'resolve'].includes(command)
  ) {
    throw new Error(`Укажите ID конкретного запуска из ${cliCommand} runs.`);
  }
  return value ? { command, flags, id: value } : { command, flags };
}
