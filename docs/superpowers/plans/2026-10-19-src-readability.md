# Readable TypeScript Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make src readable and separate runtime responsibilities without changing the public API, CLI, stored run format or assignment behavior.

**Architecture:** Keep Runtime as a small public facade backed by explicit internal functions for creation, the agent loop, batch admission, call execution, results, approvals, recovery and rollback. Keep atomic persistence boundaries visible in execution code. Split large schema/type definitions and Bash output handling into cohesive modules, retaining compatibility exports for existing callers.

**Tech Stack:** Existing TypeScript/Node/SQLite/Ajv stack plus Prettier as a development-only formatting tool.

**Spec:** docs/spec.md; the user's explicit request for readable code and a clearer src architecture on 2026-10-19.

## Global Constraints

- Preserve the user's three blank-line edits in runtime.ts through the new readable layout. Do not modify .idea or unrelated files.
- Preserve every public Runtime method and existing top-level imports used by tests.
- Preserve persisted JSON shape, budget reservations, approval behavior and started/result save boundaries.
- Preserve the existing 42 behavioral tests and unchanged Python control project.
- No agent framework, service container, inheritance hierarchy or new runtime dependency.
- One statement per line, expanded branches, descriptive local names and blank lines between logical steps.
- Keep modules focused, aiming for at most approximately 250 readable lines per source file rather than hiding complexity with compressed formatting.
- No PDF, memory-bank or continued model installation. The user cancelled the document and changed focus to source architecture.

Execution is in this chat. The referenced superpowers execution skills are not installed; follow the checklist directly under the user's authorization.

## Task 1: Formatting and baseline

**Files:** package.json, package-lock.json, .prettierrc.json, .prettierignore.

**Interfaces:** `npm run format` writes src/**/*.ts; `npm run format:check` checks the same files.

- [x] Run the unchanged test suite and save its result under .agent.
- [x] Install pinned development dependency prettier with system CA enabled.
- [x] Add configuration and scripts:
```json
{"singleQuote":true,"printWidth":100,"trailingComma":"all","tabWidth":2}
```
```json
{"format":"prettier --write src","format:check":"prettier --check src"}
```

## Task 2: Cohesive source modules

**Files:** src/runtime.ts; src/runtime/{context,create-run,agent-loop,tool-batch,call-execution,tool-results,administrative-tools,task-state,approvals,recovery,rollback,prompts}.ts; src/types/{protocol,run-state}.ts; src/schemas/{common,tools,plan,policy}.ts; src/tools/{bash,results}.ts; src/cli/{arguments,commands}.ts; existing top-level entry points.

**Interfaces:** Existing Runtime constructor and public methods remain intact. Internal `RuntimeContext` carries store, model and options; state-changing helpers receive context and RunState explicitly. File/Bash executors remain independent from agent decisions.

- [x] Extract methods with their existing logic and preserve explicit save positions:
```ts
record.status = 'started';
record.attempts.push(attempt);
context.store.save(run);
context.options.faults?.('after_reservation');
```
- [x] Keep the facade delegation explicit:
```ts
run(id: string): Promise<RunState> {
  return runAgent(this.context, id);
}
```
- [x] Split protocol types from durable state definitions; retain top-level type exports.
- [x] Separate tool, plan and policy schemas; retain the existing schema entry point.
- [x] Separate bounded Bash execution and result fitting from file operations.
- [x] Separate CLI parsing from command dispatch while preserving dist/src/cli.js.
- [x] Expand remaining dense source files with Prettier; manually replace ambiguous local names, multiple declarations and compressed branches.
- [x] Run `npm run check`, `npm test`, `npm run demo`, and `npm run format:check`. Use existing scenario tests for approvals, crashes, budgets and rollback rather than tests that mirror the new module layout.

## Task 3: Navigation and delivery

**Files:** README.md, .github/workflows/ci.yml, src/README.md.

**Interfaces:** Public imports and user commands match the current README; source navigation describes actual responsibility boundaries.

- [x] Document facade versus implementation modules, the main call path and persistence invariants.
- [x] Add the format check to CI:
```yaml
- run: npm run format:check
```
- [x] Review the final diff and source line counts, verify no unrelated user changes are staged, then commit and push the refactor to the existing repository.

## Self-review

The refactor changes organization and presentation only. The 42 existing tests cover observable behavior across all assignment requirements, and the offline demo verifies real Bash, files and SQLite end to end. Formatting is checked automatically. PDF creation has been cancelled; previous offline trace artifacts stay ignored under .agent.


## Validation results

- Baseline and refactored suite: 42 tests passed, no skipped tests.
- Final local checks: `npm run format:check`, `npm run check`, `npm test` and `npm run demo` passed.
- Compatibility: system prompt is byte-identical to the original; all tool schemas match the recorded original API request.
- Source size: 35 TypeScript files; largest file 182 lines, public Runtime facade 62 lines.
- Manual review: persistence ordering remains explicit in beginAttempt/finishAttempt; no new production dependencies.
