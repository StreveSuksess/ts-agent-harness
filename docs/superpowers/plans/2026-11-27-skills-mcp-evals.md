# Skills, MCP and agent evaluation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extend the existing agent to cover all ten-point requirements of homework 2.

**Architecture:** The durable runtime executes the same policy-checked actions for CLI, UI and evals. Each run pins available extensions and atomically saves audit events. The eval runner verifies artifacts outside its five disposable fixtures; its report determines whether a staged skill revision may be promoted.

**Tech Stack:** TypeScript, Node.js, SQLite, JSON-RPC stdio MCP, local Laya, local Ollama, local browser UI.

**Spec:** [Homework 2](../../homework-2.md)

## Global constraints

The two graded series use a real LLM, fresh sessions and workspaces, no human corrections, fixed data and permissions, persisted journals for every attempt. No external service is necessary to inspect the submitted evidence.

- [x] Wire model-selected skill discovery, policy-checked MCP and an authenticated-by-configuration local market into the current agent loop. Test permissions, malformed packages, transport errors, and pinned revisions.
- [x] Persist session IDs, event IDs and model-reported token usage across resume. Verify partial and absent usage, event evidence for doctor findings and normal counterexamples.
- [x] Run five independent cases three times on each A/B side. Repeat with skills enabled on both sides and exactly one revision changed. Produce a machine-readable table, logs, paired analysis and update decision.
- [x] Connect local UI and CLI to the same runtime, stored sessions, diagnostics and update gate. Exercise a prompt, follow-up and decisions; capture screenshots.
- [x] Audit deliverables against the rubric, run typecheck, format, tests and the homework 1 demo, then prepare the submission link and instructions.
