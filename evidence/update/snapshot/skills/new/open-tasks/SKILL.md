---
name: open-tasks
description: Select open tracker tasks and produce a list of their IDs. Use for an open-task list, backlog or explicitly requested open items.
---
1. Read the requested task source and the actual status field.
2. Keep only records whose status is exactly open. Preserve the task IDs as strings.
3. Produce the requested artifact and format. Do not invent missing IDs.
4. Check the produced list against the source.
5. If the source is unavailable, state that the result could not be verified. An unavailable list does not establish that the backlog is empty.
