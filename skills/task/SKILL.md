---
name: task
description: Run one task from problem statement to pull request through ten stages, in its own workspace, with the design reviewed before any code is written. Starts a new task, or resumes the one in the current workspace.
disable-model-invocation: true
---

# task

One task, ten stages, one workspace. The stage is held by the harness, not by your
memory of it: call `advance_stage` to move on, and it will refuse unless the stage
actually produced something.

Three stages end with a dialog the user answers — 5, 6 and 10 — plus stage 9. You
do not write those dialogs and you do not answer them.

**Before stage 5 is approved, writing anything inside a repository is refused**,
except `docs/architecture.md`, `docs/product.md`, and `docs/adr/`. The task
document is at the workspace root, outside every repository, so it is always
writable. This is deliberate: while the design is unsettled, the only cheap thing
to do is work on the design.

## First, work out where you are

Run `get_status`. If it reports a task, you are resuming: continue from the stage
it names, and do not start a new one. If it reports no task, start at stage 1.

## Stage 1 — New task

Ask the user, as one open question, what problem this task solves. Do not narrow
their answer into a solution.

Propose a branch name: kebab-case, at most four words, naming the outcome
(`add-note-search`, not `fix-stuff`). Confirm it, then call `start_task` with the
branch and the user's description.

That creates the workspace directory, the ticket, and `task.md`. No worktrees yet.

## Stage 2 — Requirements interview

Do all of this before asking the user anything:

- Read `docs/product.md` and `docs/architecture.md`. They are short by design —
  read them in full. Look in the project root first, then in each repository.
- Call `find_adr` with what this task is about. Read the few records it returns
  that bear on the question; do not read the directory.
- Look at the code the task will probably touch, in the base workspace under
  `main/`. Note the house style, the existing tests, and the boundaries.
- If the task touches a third-party API, protocol, or model, consult the official
  documentation. Do not state behaviour, parameters, or pricing from memory, and
  label anything you could not verify.

Then interview the user. Batch the questions; do not trickle them. Ask about what
genuinely changes the work: scope boundaries, behaviour at the edges, what is
explicitly out of scope, how success is judged, and **which repositories this
touches**. Stop when the remaining unknowns would not change what gets built.

Write the requirement into the Requirement section of `task.md`.

Create a worktree for each repository involved:

```
git -C <project>/main/<repo> fetch origin
git -C <project>/main/<repo> worktree add <workspace>/<repo> -b <branch>
```

Then `advance_stage` with `repos: ["api", "web"]`.

## Stage 3 — Design

Write into `task.md`:

- **Design** — what changes, in which repository, and why. Name the files and
  modules. Say how it fits what already exists.
- **Test cases** — enumerated, each with its trigger and its expected outcome,
  including the failure and edge cases. These become the tests verbatim at stage 6.

As you make decisions, write them down as you go, not afterwards. One decision per
file in `docs/adr/` in the repository the decision concerns: context, decision,
reasoning. If a decision changes one already recorded, edit that record in place —
the project keeps the current answer, not a history of previous ones.

If this design changes what `docs/architecture.md` or `docs/product.md` says, edit
them now. That is part of this task, not a follow-up. Keep each under about 200
lines: they are read by every task, and a document too long to read stops being
read.

Then `advance_stage`.

## Stage 4 — Codex reviews the design

Skipped automatically when codex is off in project config.

Run the project's codex review against the design section of `task.md`, asking it
for: contradictions with the top-level documents or the decision records, missing
or vague test cases, and design decisions that will not survive contact with the
existing code.

Address every finding — fix the real ones, and for the ones you believe are wrong,
say why rather than dropping them silently. Then `advance_stage` with `evidence`:
the verdict and how each finding was resolved.

## Stage 5 — User reviews the design — DIALOG

Present the design to the user: what changes, why, and the test cases. Then call
`advance_stage`. The harness raises the dialog; the user accepts or declines.

Declining returns the task to stage 3. Revise and come back.

Accepting is what lifts the refusal.

## Stage 6 — Failing tests — DIALOG

Implement exactly the test cases in `task.md` and nothing else. No production code
in this stage. If the plan introduced a test framework, wiring it up belongs here.

Run them. They must fail, and fail for the intended reason — a test that passes
before the feature exists is testing nothing, and is a defect to fix rather than a
result to move past.

Show the user the failing output and the mapping from each test case in `task.md`
to the test you wrote. Then `advance_stage` with `evidence`: the command you ran
and its failure output.

## Stage 7 — Implementation

Write the code until the whole suite is green, including tests that already
existed, in every repository the task touches.

The contract:

- The code follows the design and the tests. Not the other way around.
- If the design or a test looks wrong, **stop and ask the user.** Never edit,
  weaken, skip, or delete a test to make the suite pass.
- Any change the user approves goes into the Notes section of `task.md`, with the
  reason, before implementation continues.

Everything written into a repository is in English — code, comments, commit
messages, identifiers, configuration.

Then `advance_stage` with `evidence`: the test command and its passing output.

## Stage 8 — Codex reviews the code

Skipped automatically when codex is off in project config.

Run the project's codex review against the diff, with `task.md` as the reference:
behaviour that contradicts the Design section, test cases that are missing or
weakened, code paths the tests do not cover, correctness and error-handling
defects.

Triage every finding in front of the user. Fix the real ones and re-run the suite.
For a finding you believe is wrong, say why rather than dismissing it silently. If
a fix would require changing the design or a test, stage 7's rule applies. Re-run
until it comes back clean, then `advance_stage` with `evidence`.

## Stage 9 — User acceptance — DIALOG

Start the feature with the project's run command and hand the user something they
can exercise themselves: the command, the URL, the input to try. Then
`advance_stage`.

If the user declines, ask them one question — is this a design problem or an
implementation problem? — then call `return_to_stage` with 3 or 7 and their reason.

## Stage 10 — Pull request — DIALOG

Call `advance_stage`. One dialog covers the whole stage; the user accepted the
feature at stage 9 and this stage sends it out.

Once it is authorised, in each repository the task touched: commit with a message
describing the change and why, push the branch, and open a pull request. Then call
`finish_task` with the pull request URLs.

Leave the workspace where it is. Do not delete it, and do not remove the worktrees.

## If the task is dropped

If the user decides at any point not to go on with the task, call `abandon_task`
with their reason. Nothing is deleted; only the ticket changes. Do not abandon a
task on your own initiative — ask.

## Rules that hold in every stage

1. Documentation is writable at every stage. Recording a decision is never
   something to ask permission for.
2. The main checkout under `main/` is not written to once a task has started.
3. Do not state third-party behaviour, parameters, model names, or pricing from
   memory. Consult the official documentation, and say so when a claim is
   unverified.
4. Everything committed to a repository is in English, whatever language the
   conversation is in.
