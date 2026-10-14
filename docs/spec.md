# Coding agent harness specification

Source: the user's T-Education assignment, reviewed on 2026-10-14. Target: all ten-point requirements. The user chose TypeScript and explicitly declined a memory-bank. The GitHub repository was created and its URL delivered before implementation.

## Required behavior

- A model selects file tools and Bash, receives tool results with the original tool_call_id, handles errors, and decides when to return a final answer. Multiple calls per answer are supported.
- Tools: Bash(command, cwd), list_files(path), read_file(path), write_file(path, content), delete_file(path). Names and arguments use JSON Schema and are checked at execution time.
- Every project path is relative to workspace, canonically constrained to policy roots; traversal, absolute tool paths, symlinks and denied subdirectories are rejected.
- Exact simple Bash commands only. Deny overrides allow. Unknown commands are denied. Policy contains allowed/denied commands and directories and lives outside workspace. Bash has time and output limits and executes through Bash.
- safe: reads immediate, writes/Bash/deletes require approval. auto: validated reads/writes/Bash immediate; deletes require approval. Approval persists state and stops; resume handles approval or rejection on the same run.
- Persist run_id, messages, calls, attempts, results, user decisions and state. Persist started before every side effect, result after. Completed call IDs do not execute again; altered payloads on an existing ID are protocol errors.
- A crash between execution and result persistence is uncertain. Require an explicit retry (only a repeatable tool), failed-result continuation, or abort. Retry creates another attempt.
- Plan phase permits read tools only. Persist a structured goal, ordered steps, required tools, risks, assumptions and completion criteria. Explicit approval is required; it does not bypass action approvals.
- Run-wide budgets: model requests, tool calls, side effects, total tool-result bytes. Persist reservations and action state atomically; no refunds on crashes or reset on resume. Admit a model's call batch as a whole or execute none of it. Bound unknown output and mark incomplete results.
- Plans are dependency graphs with IDs, descriptions, states and verifiable outcomes. Execution calls have task_id; planning calls do not. Scheduler only activates tasks with successful dependencies. Runtime records actual evidence. At least three dependent tasks are tested and stdout is a checklist.
- Journal covers create/update/delete. Snapshot path lists, contents and hashes before mutation and after it. Stop on external tree changes. Bash is restricted to configured commands; snapshots still detect its changes. No generated-file exclusions by default.
- Diff and rollback work after restart. Rollback checks policy and all affected current hashes before writing any file; unrelated files remain untouched. Uncertain mutations require explicit user attribution before rollback.
- Deliver code, example policy, broken workspace/order.py, unchanged workspace/test_order.py, automated tests, dependency lockfile, environment example, README and reproducible defense demo. No API keys, no agent framework.

## Implementation boundaries

Sequential execution and a per-workspace process lock prevent competing runtime mutations. SQLite transactions persist each run as a validated internal JSON state with action/budget transitions together. The database is external to workspace. Model credentials stay in the process environment, never in run state. A fake model is used only for deterministic tests and the explicitly labelled offline demo.

The policy is an educational guard, not an OS sandbox. Whitelisted Python tests can execute arbitrary Python; use a disposable workspace without secrets. Reject all symlinks and hardlinked project files; do not follow them during snapshotting. External concurrent actors can still race filesystem checks; this limitation is documented rather than claimed solved.
