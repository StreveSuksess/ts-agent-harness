export const HELP = `TypeScript coding harness (Node >=22.13, Bash, Python 3)
Usage: npm run agent -- COMMAND [run_id] [options]
  start --task TEXT [--workspace workspace] [--policy policy.example.json] [--mode safe|auto] [--no-plan]
  resume RUN_ID
  approve-plan RUN_ID --decision approve|reject
  approve-action RUN_ID --decision allow|deny
  resolve RUN_ID --decision retry|fail|abort [--attribute yes|no]
  status RUN_ID
  tasks RUN_ID
  diff RUN_ID
  rollback RUN_ID
  resolve-rollback RUN_ID
  demo                         offline scripted model, real tools, fresh disposable workspace
Options: --db .agent/state.sqlite; --fault after_reservation|after_execute|after_rollback_write
Model: OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL (.env is loaded by npm run agent).
No automatic replay of uncertain calls. Plan approval does not approve safe-mode actions.`;

export function parseArguments(argv: string[]): {
  command: string;
  id: string | undefined;
  flags: Map<string, string>;
} {
  const command = argv.shift() ?? 'help';
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const allowed = new Set([
    '--task',
    '--workspace',
    '--policy',
    '--mode',
    '--db',
    '--fault',
    '--decision',
    '--attribute',
    '--no-plan',
  ]);

  for (let argumentIndex = 0; argumentIndex < argv.length; argumentIndex++) {
    const argument = argv[argumentIndex]!;

    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    if (!allowed.has(argument) || flags.has(argument)) {
      throw new Error(`Unknown/duplicate option: ${argument}`);
    }

    if (argument === '--no-plan') {
      flags.set(argument, 'true');
      continue;
    }

    const value = argv[++argumentIndex];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }

    flags.set(argument, value);
  }

  if (positional.length > 1) {
    throw new Error('Unexpected positional arguments');
  }

  return { command, id: positional[0], flags };
}
