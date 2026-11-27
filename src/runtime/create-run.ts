import { assertExtensionWorkspace, type ExtensionSnapshot } from '../extensions/index.js';
import { taskTools } from './extension-tools.js';
import type { Verification } from '../types.js';
import { randomUUID } from 'node:crypto';
import { Policy } from '../policy.js';
import { snapshot } from '../journal.js';
import { now } from '../types.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { RuntimeContext } from './context.js';
import type { CallRecord, Change, Limits, RunState } from '../types.js';
import { renderPhaseMessage } from './task-state.js';

export interface StartOptions {
  sessionId?: string;
  extensions?: ExtensionSnapshot;
  verification?: Verification;
  systemNote?: string;
  workspace: string;
  policyFile: string;
  prompt: string;
  conversationContext?: string;
  mode?: 'safe' | 'auto';
  plan?: boolean;
  limits?: Partial<Limits>;
}

export function createRun(context: RuntimeContext, options: StartOptions): RunState {
  const policy = Policy.load(options.policyFile, options.workspace);

  context.store.assertOutside(policy.workspace);
  if (options.extensions) assertExtensionWorkspace(options.extensions, policy.workspace);

  const initial = snapshot(policy);
  const limits = { ...policy.config.budgets, ...options.limits };

  for (const limit of Object.values(limits)) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('Invalid budget limit');
    }
  }

  const phase = options.plan === false ? 'execute' : 'plan';
  const run: RunState = {
    id: randomUUID(),
    revision: 0,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
    createdAt: now(),
    workspace: policy.workspace,
    policyFile: policy.file,
    mode: options.mode ?? 'safe',
    phase,
    status: 'running',
    prompt: options.prompt,
    messages: [
      { role: 'system', content: [SYSTEM_PROMPT, options.systemNote].filter(Boolean).join('\n') },
    ],
    pending: [],
    calls: Object.create(null) as Record<string, CallRecord>,
    tasks: [],
    activeTaskId: null,
    limits,
    spent: { modelRequests: 0, toolCalls: 0, sideEffects: 0, resultBytes: 0 },
    reservedSideEffects: 0,
    initial,
    expected: initial,
    journal: [],
    changes: Object.create(null) as Record<string, Change>,
    decisions: [],
  };

  if (options.conversationContext) {
    run.messages.push({ role: 'user', content: options.conversationContext });
  }
  run.messages.push({ role: 'user', content: options.prompt });

  if (phase === 'execute') {
    run.tasks = [
      {
        id: 'work',
        description: options.prompt,
        depends_on: [],
        tools: taskTools(run),
        verification: options.verification ?? {
          kind: 'bash',
          command: 'python3 -m unittest -v',
          exitCode: 0,
        },
        status: 'running',
      },
    ];
    run.activeTaskId = 'work';
  }

  const workspacePolicy = {
    allowedCommands: policy.config.commands.allow.filter(
      (command) => !policy.config.commands.deny.includes(command),
    ),
    directories: policy.config.directories,
    readOnlyFiles: policy.config.readOnlyFiles,
  };

  run.messages.push({
    role: 'user',
    content: 'Workspace policy: ' + JSON.stringify(workspacePolicy),
  });
  run.messages.push({ role: 'user', content: renderPhaseMessage(run) });
  context.store.save(run);

  return run;
}
