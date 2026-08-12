---
name: init
description: Adopt a project into dev-harness — create the tickets directory, write the missing document skeletons in each repository, and record the test command, the run command, and whether codex is available. Run once per project; safe to run again.
disable-model-invocation: true
---

# init

Adopt a project. This moves nothing, clones nothing, and reorganises nothing.

## What a project looks like

```
<PROJECT>/
  main/              the base-branch workspace: one directory per repository
    api/
    web/
  <branch>/          a task workspace, created by the task skill
  tickets/           one file per task
  config.json        test command, run command, codex on or off
  docs/product.md    only when the project spans several repositories
```

`main/` is not special. It is the workspace for the base branch, shaped like every
task workspace.

## Step 1 — Find the project

Resolve the project root from the current directory: the nearest ancestor
containing both `main/` and `tickets/`. If there is none, this project has not been
adopted yet, and the current directory — or its nearest ancestor containing `main/`
— is the candidate.

Report what you found and stop if it is ambiguous. Do not create a project layout
in a directory the user did not mean.

If `main/` does not exist but the current directory is itself a git repository,
say so and offer the two options: move the checkout into `main/<name>/`, or point
the user at a different directory. **Do not move anything without being told to.**

## Step 2 — List the repositories

Every directory inside `main/` that contains `.git` is a repository in this
project. Report the list. There is nothing to record: it is read again whenever it
is needed.

## Step 3 — Create `tickets/`

An empty directory at the project root, if it is not already there.

## Step 4 — Write the missing document skeletons

For each repository, if the file does not exist, copy from this skill's
`templates/` directory:

- `docs/architecture.md` — how this repository is built
- `docs/adr/` — an empty directory for decision records

And for the product design, exactly one copy:

- a single repository → `docs/product.md` in that repository
- several repositories → `docs/product.md` at the project root

Never overwrite a file that exists. Report which ones you created and which were
already there.

Both top-level documents are held to about 200 lines. Say so to the user: the limit
is the point, because they are read by every task.

## Step 5 — Ask for what cannot be discovered

Three things, and only these three. Write them to `config.json` at the project root:

```json
{
  "test": "npm test",
  "run": "npm run dev",
  "codex": true
}
```

- **test** — the command that runs the suite.
- **run** — the command that starts the thing locally, for stage 9.
- **codex** — whether the codex CLI is available. When false, the two review stages
  are skipped rather than passed, and the task document records that.

If a repository needs a different test or run command from its siblings, say so to
the user and record the one that covers the common case; per-repository commands
are not supported yet.

## Step 6 — Report

State the project root, the repositories found, the files created, and the three
configured values. Then tell the user to start their first task with the `task`
skill.

## Running it again

Safe. Report the current state and only ask about what is missing.
