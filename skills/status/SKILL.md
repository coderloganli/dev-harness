---
name: status
description: Report where the current dev-harness task stands — which stage, which repositories, what is refused, and what the stage calls for next.
disable-model-invocation: true
---

# status

Call `get_status`, then report it to the user in a few lines:

- the stage, as a number out of ten and its title
- the branch and the workspace directory
- the repositories the task touches
- what this stage calls for
- what is currently refused
- any returns recorded in the history, so a task that went around twice says so

If `get_status` reports no task, say so plainly and offer the two things that make
sense from here: start one with the `task` skill, or search for an earlier one with
the `tickets` skill.

Do not do any work in this skill. It reports and stops.
