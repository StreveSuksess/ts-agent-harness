# Local Model Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a genuine local-model run when the model's chat template omits transport-level tool call IDs.

**Architecture:** Render a bounded list of successful project call IDs for the current execution task in the phase message. Refresh this message after the pending batch drains and before the next model request. Preserve tool messages, persistence boundaries and independent evidence validation.

**Tech Stack:** Existing TypeScript, Node test runner, SQLite and local Ollama/Qwen3.

**Spec:** The user's request on 2026-10-20 to run locally; docs/spec.md requirements for evidence-backed task completion.

## Global Constraints

- Do not modify control tests, the original Python workspace, .idea or create memory-bank.
- Do not repeat uncertain actions automatically or relax evidence validation.
- Include only completed, successful project calls from the current execution task.
- Keep at most eight recent evidence candidates in each context message.
- Add context only between completed tool batches, preserving protocol ordering.
- Execute inline; the named superpowers execution skills are unavailable.

## Task 1: Evidence visible to the local model

**Files:** tests/evidence-context.test.ts; src/runtime/task-state.ts; src/runtime/agent-loop.ts; README.md.

**Interfaces:** `renderPhaseMessage(run: RunState): string` includes `{ evidence_call_id, tool }` candidates; `runAgent` persists refreshed context before calling `Model.complete`.

- [x] Add a regression model that sees only message role/content, completes a read task using the displayed opaque ID, and rejects planning/failed IDs as candidates.
```ts
const candidates = [...context.matchAll(/"evidence_call_id":"([^\"]+)"/g)];
assert.deepEqual(candidates.map(match => match[1]), [opaqueCallId]);
```
- [x] Build and run `node --test dist/tests/evidence-context.test.js`; verify the old runtime blocks because the ID is missing.
- [x] Render current-task successful project calls and keep the last eight:
```ts
const evidence = Object.values(run.calls)
  .filter(call => call.taskId === task.id && call.phase === 'execute' &&
    call.status === 'completed' && call.result?.ok && PROJECT_TOOLS.has(call.call.function.name))
  .slice(-8)
  .map(call => ({ evidence_call_id: call.call.id, tool: call.call.function.name }));
```
- [x] Before reserving the next execution-phase model request, append the phase message if it is not already the last user message. Keep the existing durable request reservation before HTTP.
- [x] Run format, format:check, check, the complete test suite and demo.
- [x] Resume or start an isolated live-model run and verify actual file changes, successful Bash evidence and unchanged test hashes.
- [x] Document the observed live result and any remaining model limitations; commit and push the tested fix.


## Observed validation

- Regression failed on the original implementation because the opaque call ID was absent from textual context.
- Format check, strict compilation, all 43 tests and offline demo pass after the fix.
- Real Ollama/Qwen3 4B CPU run a2837183-ac2a-48d2-9795-0176bed9a548 completed all three tasks. The actual Bash exit code was zero, both Python tests passed, and control test bytes were unchanged.
- Planning required corrective guidance; the accepted final task used successful Bash tool evidence. The run retained rejected plans, failed calls and spent budgets.
- Runtime resumed the same saved run successfully after the context fix; SQLite shape and evidence validation are unchanged.
