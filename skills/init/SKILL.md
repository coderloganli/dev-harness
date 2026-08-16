---
name: init
description: Adopt a project into the harness — create the tickets directory, write the missing document skeletons in each repository, and record how the suite is run, how the user tries a change, and whether codex is available. Run once per project; safe to run again.
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
  config.json        test, try, codex
  docs/product.md    only when the project spans several repositories
```

`main/` is not special. It is the workspace for the base branch, shaped like every
task workspace.

## Step 1 — Find the project

Find the project the user means. A project is a directory holding `main/`; one that
has been adopted already also holds `tickets/`.

The directory the session started in is a hint, not an answer. Look around it — the
directory itself, what is above it, what is one level below it — because a session
is as likely to start in a project's parent as in the project. Use anything else
you know: what the user just said, which repository is being discussed.

Two rules bound the looking. **Report what you found**, so the user can correct you
before anything is written. And **when more than one directory could be the project,
ask** rather than picking; never create a project layout in a directory the user did
not name.

This is written as intent rather than as a procedure on purpose: an earlier version
prescribed walking up from the current directory, which failed the first time it was
used, on a project sitting one level below. See
`docs/adr/0001-two-project-resolvers.md` — the mechanical resolver the hooks and the
server use is a different thing, and it stays mechanical.

If `main/` does not exist but the current directory is itself a git repository,
say so and offer the two options: move the checkout into `main/<name>/`, or point
the user at a different directory. **Do not move anything without being told to.**

## Step 2 — List the repositories

Every directory inside `main/` that contains `.git` is a repository in this
project. Report the list. There is nothing to record: it is read again whenever it
is needed.

`main/` is always a container, even for a project with one repository — the
checkout goes at `main/<name>/`, never at `main/` itself. If `main/` is a checkout,
say so and offer to move it down one level; a task workspace has the same shape as
`main/`, and if it did not, `task.md` would have nowhere to sit except inside the
repository.

## Step 3 — Create `tickets/`

An empty directory at the project root, if it is not already there.

## Step 4 — Write the missing document skeletons

For each repository, if the file does not exist, copy from this skill's
`templates/` directory:

- `docs/architecture.md` — how this repository is built
- `docs/adr/README.md`, from `adr-readme.md` — what a decision record is here, and
  how to search rather than browse. The directory needs a file either way, because
  git does not track empty directories; making that file the README means the
  directory explains itself instead of holding a `.gitkeep`.

And for the product design, exactly one copy:

- a single repository → `docs/product.md` in that repository
- several repositories → `docs/product.md` at the project root

Never overwrite a file that exists. Report which ones you created and which were
already there.

The top-level documents are bounded: product design at about 200 lines, architecture
at about 350, because how a system is built carries reference material that prose
cannot replace. Say so to the user: the limit is the point, because they are read by
every task.

## Step 5 — Ask for what cannot be discovered

Three things, and only these three. Write them to `config.json` at the project root:

```json
{
  "test": "npm test",
  "try": "npm run dev, then open http://localhost:3000",
  "codex": true
}
```

- **test** — how the suite is run. Read by Claude at stages 6 and 7.
- **try** — how the user is given something to exercise at stage 9. Read by Claude.
  A command is the usual answer, but prose is a valid one: some projects have
  nothing to launch, and what stage 9 needs is a way for the user to try the change
  themselves, not a process.
- **codex** — whether the codex CLI is available. **This one is read by the
  server**, and it is the only value that is: when false, the two review stages are
  skipped rather than passed.

That split is worth stating to the user, because it says how exact the answers have
to be. `codex` is a switch a program reads. The other two are notes to Claude, so
that the question is asked once per project instead of once per task.

If a repository needs different answers from its siblings, say so and record the one
that covers the common case; per-repository values are not supported yet.

## Step 6 — Report

State the project root, the repositories found, the files created, and the three
configured values. Then tell the user to start their first task with the `task`
skill.

## Running it again

Safe. Report the current state and only ask about what is missing.
