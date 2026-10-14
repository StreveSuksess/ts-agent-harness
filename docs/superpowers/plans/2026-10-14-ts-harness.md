# TypeScript Coding Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement and publish a console coding harness covering the assignment's ten-point level.

**Architecture:** A model adapter proposes tool calls; a separate policy and executor validate and execute them. A persistent state machine owns approvals, uncertain attempts, budgets, tasks and snapshots. Tools operate only in a disposable workspace.

**Tech Stack:** TypeScript, Node.js >=22.13, built-in node:sqlite, Ajv JSON Schema validation, node:test, Bash, Python 3 for the assignment fixture.

**Spec:** docs/spec.md

## Global Constraints

- Agent loop, policy, recovery, budgets and planning are implemented without agent frameworks.
- Deny overrides allow; everything not explicitly allowed is rejected.
- Plan approval is separate from safe-mode action approval.
- Every side effect, including Bash, is saved as started before execution.
- No completed call is reexecuted; uncertain calls require human resolution.
- A batch exceeding available call/action budget executes no calls.
- All phases share a run_id and durable budget; resume never resets it.
- Snapshot all project file paths and contents; no source/test exclusions.
- No secrets are committed or saved in state.

The referenced superpowers execution skills are not installed in this environment. Execution will therefore follow the checklist directly in this chat, as the user already authorized full implementation; no delegated agents are required.

## File responsibilities

src/types.ts: protocol and durable state; src/schema.ts: schemas; src/policy.ts: paths and command rules; src/tools.ts: bounded tool execution; src/store.ts: SQLite transactions and workspace lock; src/journal.ts: snapshots/diff/rollback; src/model.ts: Chat Completions adapter and scripted test adapter; src/runtime.ts: lifecycle; src/cli.ts: commands; src/demo.ts: labelled offline demo. tests/*.test.ts: deterministic boundary and end-to-end checks.

### Task 1: Policy and bounded tools

**Files:** package.json, tsconfig.json, policy.example.json, workspace/order.py, workspace/test_order.py, src/types.ts, src/schema.ts, src/policy.ts, src/tools.ts, tests/policy.test.ts.

**Interfaces:** `Policy.load(file, workspace): Policy`, `Policy.path(relative): string`, `Policy.command(command, cwd): string`; `executeTool(call, policy, maxBytes): Promise<ToolResult>`.

- [x] Add the unchanged assignment fixture and strict compiler settings.
- [x] Write and run rejection tests for path and command checking:
```ts
assert.throws(() => policy.path('../outside'));
assert.throws(() => policy.command('python3 -m unittest -v; pwd', '.'));
```
- [x] Implement canonical path checks, exact command validation and schema checks; Bash uses `spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], options)` with sanitized environment and bounded output.
- [x] Run `npm test` and `npm run check`; commit the tested deliverable.

### Task 2: Durable state and snapshots

**Files:** src/store.ts, src/journal.ts, tests/store.test.ts, tests/journal.test.ts.

**Interfaces:** `Store.get(id): RunState`, `Store.save(run): void`, `Store.close(): void`; `snapshot(policy): Tree`, `treeDiff(before, after): Change[]`.

- [x] Test reopening the database and detecting file creation, modification, deletion and symlinks.
- [x] Use `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK`, WAL and synchronous FULL. Persist run JSON and revision under one transaction.
- [x] Snapshot bytes as base64 with SHA-256 and file modes. Compare complete path sets and hashes before mutation.
- [x] Implement preflight rollback checking all touched hashes and policies before any restoration.
- [x] Run the focused tests and commit.

### Task 3: Model loop, approvals and crash recovery

**Files:** src/model.ts, src/runtime.ts, tests/runtime.test.ts.

**Interfaces:** `Model.complete(messages, tools): Promise<AssistantMessage>`; `Runtime.start(options): RunState`; `Runtime.run(id): Promise<RunState>`; `Runtime.approveAction(id, allow): void`; `Runtime.resolve(id, choice, attribute): void`.

- [x] Script a model response containing two calls; assert both matching tool messages are returned.
- [x] Save the whole assistant response and call batch before execution. Return validation failures as tool results.
- [x] Persist `awaiting_action` in safe mode; test denial followed by a model-selected alternative.
- [x] Add a fault hook immediately after tool execution and before saving its result.
```ts
const faults = (point: string) => { if (point === 'after_execute') throw new InjectedCrash(point); };
```
- [x] Reopen storage; assert completed calls return cached results, started calls become uncertain and require resolution. Test explicit repeat as another attempt and changed payload as protocol error.
- [x] Run tests and commit.

### Task 4: Plan, task evidence and budgets

**Files:** src/schema.ts, src/runtime.ts, tests/planning.test.ts, tests/budgets.test.ts.

**Interfaces:** `Runtime.approvePlan(id, allow): void`; plan submission and task completion are administrative tools. Evidence references successful project tool calls, optionally an expected file hash or Bash exit code.

- [x] Test planning rejection of write/delete/Bash, then a structured three-task dependency plan.
- [x] Validate unique IDs, dependencies, acyclicity and evidence requirements. Activate tasks in dependency order and reject completion without matching saved evidence.
- [x] Reserve an entire batch's calls and side effects in the same transaction as its queued state. Reserve model requests before sending. Debit output bytes with saved tool result; reserve output capacity with started actions to avoid a crash refund.
- [x] Test each limit separately, all-or-nothing batch admission, output truncation, unchanged counters after reopen and crash after reservation.
- [x] Run tests and commit.

### Task 5: CLI, demo, rollback and delivery

**Files:** src/cli.ts, src/demo.ts, tests/cli.test.ts, tests/journal.test.ts, README.md, .env.example, .gitignore, .github/workflows/ci.yml.

**Interfaces:** CLI commands `start`, `resume`, `approve-plan`, `approve-action`, `resolve`, `status`, `tasks`, `diff`, `rollback`, `demo` share the durable run ID.

- [x] Demonstrate real Bash test execution on a disposable fixture, asserting the test file's hash is unchanged.
- [x] Test diff and rollback after a database restart; external modifications cause zero rollback writes. Cover create/delete and uncertain mutation attribution.
- [x] Add a fetch-based compatible API adapter contract test; credentials come only from environment. Label scripted demo as offline, not a real-model run.
- [x] Document installation, policy, every CLI flow, resource limits, crash injection and the defense scenario. Add CI and lockfile.
- [x] Run `npm ci`, `npm run check`, `npm test`, `npm run demo`; inspect tracked files for secrets and push main.
- [x] Run a live-model test if credentials become available; otherwise explicitly record the unverified live-model boundary.

## Coverage review

Tasks 1–3 cover tools, policy, approvals and recovery; Task 4 covers Plan Mode and levels 8–9; Tasks 2 and 5 cover level 10. Tests cover the assignment's command/path prohibitions, multiple calls, denial, crash windows, duplicate IDs, plan side effects, all budgets, dependencies, diff and restart-safe rollback.

## Final verification

Implementation delivered in this repository. `npm ci` succeeded with the committed lockfile; strict TypeScript compilation and all 42 deterministic tests passed. The offline demo completed all three tasks, ran the real Bash unittest command with exit code 0, and preserved the test file hash. The HTTP/CLI integration test verified restart continuity and rollback. A live LLM run remains unverified because no configured API or installed/running Ollama is available; this limitation is disclosed in README. No memory-bank was created, per the user's explicit instruction.
