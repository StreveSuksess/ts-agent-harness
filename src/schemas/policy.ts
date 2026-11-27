import type { PolicyConfig } from '../types.js';
import { ajv, object, strings } from './common.js';

const budget = object(
  Object.fromEntries(
    ['modelRequests', 'toolCalls', 'sideEffects', 'resultBytes'].map((budgetName) => [
      budgetName,
      { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
    ]),
  ),
  ['modelRequests', 'toolCalls', 'sideEffects', 'resultBytes'],
);

const policySchema = object(
  {
    extensions: object({ allow: strings, deny: strings }, ['allow', 'deny']),
    commands: object({ allow: strings, deny: strings }, ['allow', 'deny']),
    directories: object({ allow: { ...strings, minItems: 1 }, deny: strings }, ['allow', 'deny']),
    readOnlyFiles: strings,
    timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
    maxOutputBytes: { type: 'integer', minimum: 128, maximum: 1048576 },
    maxFileBytes: { type: 'integer', minimum: 1, maximum: 16777216 },
    maxTreeBytes: { type: 'integer', minimum: 1, maximum: 67108864 },
    budgets: budget,
  },
  [
    'commands',
    'directories',
    'readOnlyFiles',
    'timeoutMs',
    'maxOutputBytes',
    'maxFileBytes',
    'maxTreeBytes',
    'budgets',
  ],
);

const checkPolicy = ajv.compile<PolicyConfig>(policySchema);

export function validatePolicy(value: unknown): PolicyConfig {
  if (!checkPolicy(value)) {
    throw new Error(`Invalid policy: ${ajv.errorsText(checkPolicy.errors)}`);
  }

  return value as PolicyConfig;
}
