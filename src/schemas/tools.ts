import type { Args, ToolDefinition } from '../types.js';
import { ajv, object, str } from './common.js';
import { planSchema } from './plan.js';

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List entries in a workspace-relative allowed directory. Symlinks and denied entries are hidden.',
      parameters: object({ path: str }, ['path']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file within allowed workspace directories.',
      parameters: object({ path: str }, ['path']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or replace a UTF-8 text file. Existing parent directory required. Test files may be protected by policy.',
      parameters: object({ path: str, content: { type: 'string', maxLength: 1048576 } }, [
        'path',
        'content',
      ]),
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete one file. Always requires explicit user approval.',
      parameters: object({ path: str }, ['path']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description:
        'Run an exact policy-approved simple Bash command, with workspace-relative cwd. Output and time are bounded.',
      parameters: object({ command: str, cwd: str }, ['command', 'cwd']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_plan',
      description:
        'Submit a structured plan for explicit user approval. No project changes. ' +
        'Tools may only be used for reading in the planning phase.',
      parameters: object({ plan: planSchema }, ['plan']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description:
        'Complete the current task using a saved successful project tool call as evidence. ' +
        'Runtime independently checks the plan verification condition.',
      parameters: object({ evidence_call_id: str }, ['evidence_call_id']),
    },
  },
];

const validators = new Map(
  definitions.map((definition) => [
    definition.function.name,
    ajv.compile(definition.function.parameters),
  ]),
);

export function validateArguments(name: string, raw: string): Args {
  const validate = validators.get(name);

  if (!validate) {
    throw new Error(`Unknown tool: ${name}`);
  }

  if (Buffer.byteLength(raw) > 2 * 1048576) {
    throw new Error('Arguments exceed 2 MiB');
  }

  let args: unknown;

  try {
    args = JSON.parse(raw);
  } catch {
    throw new Error('Arguments must be valid JSON');
  }

  if (!validate(args)) {
    throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors)}`);
  }

  return args as Args;
}
