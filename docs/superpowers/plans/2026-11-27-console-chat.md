# Console Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type `agent` in a terminal, enter multiple prompts, and review operations in that same session.

**Architecture:** The terminal owns the conversation. Each submitted prompt runs through the existing task runtime in the same workspace, with a bounded textual summary of previous turns. Existing one-shot commands keep their exit and approval behavior.

**Tech Stack:** TypeScript, Node.js readline, SQLite, shell launcher, node:test, Python PTY.

**Spec:** User's request for a terminal prompt loop and the approval/recovery contracts in [docs/spec.md](../../spec.md).

## Global Constraints

Keep explicit approvals, per-run limits, workspace isolation and noninteractive use. Installing the command must preserve any existing executable.

### Task 1 — Launch from the shell

- [x] Teach `agent` to resolve its checkout through a symlink; use the invoked command in CLI hints.
- [x] Install a symlink in the user's existing PATH and verify `agent --help` outside the checkout.

### Task 2 — Take the next prompt

- [x] Add a two-prompt PTY regression with a scripted local HTTP provider, explicit plan approval, shared files, preserved context, and `/exit`.
- [x] Implement the prompt loop in `src/cli/chat.ts`, dispatch from `commands.ts`, and add the exit command and follow-up question to `dialog.ts`.
- [x] Extend `startTask(runtime, args, prompt, followUp?)` with workspace reuse and bounded conversation context in `createRun`. Clear live-output cursors between runs.
- [x] Document the interaction in README. Run the suite, the format check, and a smoke test with the installed command in a fresh shell.
