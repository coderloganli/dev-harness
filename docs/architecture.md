# Claude Code Harness — Architecture

Status: draft, pending review
Last updated: 2026-08-15

The harness is a Claude Code plugin that governs three things: the documents a
project keeps, the workspace a task runs in, and the stages a task passes through.

This document says what the system is and what rules bind it. Why a particular
decision was taken lives in `docs/adr/`, which is what that directory is for; this
document points rather than repeats, so that it stays short enough to be read by
every task.

---

## 1. What the system is

A plugin directory Claude Code loads when the plugin is enabled. Almost everything
happens inside events the harness already fires; the one exception is a small MCP
server, which exists because raising a dialog and receiving its answer is not
something a hook can do.

| Artifact | What it is |
| :-- | :-- |
| **Skills** | Markdown procedures Claude reads |
| **Server** | An MCP server: stage control, ADR search, ticket search |
| **Hooks** | One refusal, plus stage reminders |
| **Templates** | Skeletons for the documents `init` creates |
| **Project config** | A few facts about one project |

The repository is also its own marketplace: `.claude-plugin/marketplace.json` lists
one plugin whose source is the repository root. Its `version` is what tells an
installed copy that a newer one exists, so it moves with `plugin.json`'s.

The line that matters: **a skill is text Claude may or may not follow; the server
and the hooks are programs that run either way.** Every rule below is placed on one
side of that line on purpose.

---

## 2. How Claude is kept on the procedure

Three means, in increasing order of strength. Most of the method sits on the first
one, and that is not a defect to be engineered away — it is what a method is.

**Instruction.** The procedure is a skill loaded when the user starts a task, and the
only means that can express anything needing judgement: how far to read, when the
interview is done, whether a review finding is real. It decays over a long session,
which §3 addresses.

**Stage control.** The stage lives in the ticket, written by the server, not by
Claude. To move on, Claude calls `advance_stage`; the server checks the stage's output
exists, and for the three stages that need the user, raises a dialog and waits. Claude
can ask to advance. It cannot advance.

**One refusal.** A `PreToolUse` hook refuses writes inside a repository until the
design has been approved. That is the whole of hard enforcement, deliberately: a model
drifting under context pressure is stopped by the stage machine and the reminders, and
a model determined to circumvent them is not something this design tries to beat.

### What is refused, exactly

Until the user approves the design, nothing inside any repository is writable
except three paths:

```
docs/architecture.md
docs/product.md
docs/adr/**
```

Everything else in a repository is refused, with a message naming the stage and what
would open it. This needs no per-project configuration, because those three paths are
conventions the plugin establishes at `init` time, and no notion of "source file" —
the distinction that would have dragged in path patterns and rules protecting them.
The task document is outside every repository (§4), so it stays writable without
being an exception.

After the design is approved, nothing is refused for the rest of the task.

---

## 3. Keeping instruction alive

A long task compacts, resumes, and fills with unrelated output. A procedure stated at
turn 3 is not reliably present at turn 300. Two techniques, neither of which enforces
anything:

**Re-state the stage.** At session start and resume, and whenever a stage changes,
the current stage and what it calls for are injected as context. A refusal is the one
moment the model is guaranteed to be attending to the rule, so its message is written
as an instruction — "the design is not approved yet; present it and ask" — never as a
bare error.

**Make the correct path the cheapest one.** The task document template already has
its sections, so filling them in beats inventing a format. `find_adr` beats guessing
filenames. `advance_stage` beats deciding on its own whether it is done. A model
under context pressure takes the locally cheapest action; the design's job is to
arrange for that to be the intended one.

---

## 4. Layout

A project is a directory. Inside it: the main checkout of each repository, one
workspace per task, and the things that belong to the project but to no repository.

```
<PROJECT>/
  main/                   the base-branch workspace
    api/                  main checkout of repo "api"
    web/                  main checkout of repo "web"
  add-note-search/        a task workspace, named after the branch
    task.md               this task's document — outside every repo
    api/                  git worktree of "api" on branch add-note-search
    web/                  git worktree of "web" on branch add-note-search
  docs/product.md         product design — only when the project spans repos
  config.json             project config: codex on/off, and how to test and try
  tickets/                one file per task
```

`main/` is not a special case: it is the workspace for the base branch, with the same
shape as every task workspace, which is why repositories can be found by listing it
and nothing has to be recorded about where they are. **It is always a container, one
directory per repository, even when there is only one** — letting it be the checkout
itself would leave the task document nowhere to live except inside a repository,
which is exactly what it must never do.

Three consequences that do work later:

- **The task document is outside every repository.** Nothing has to be excluded, no
  ignore file is touched, and it can never appear in a diff.
- **A task is identified by its workspace path.** Concurrency and resumption fall out
  for free: two workspaces do not know about each other, and a session started inside
  one is recognised as belonging to that task without being told.
- **All repositories in a task share one branch name**, which is also the workspace
  directory name.

---

## 5. Documents

Three kinds, with three lifetimes.

| | Where | Lifetime | Written by |
| :-- | :-- | :-- | :-- |
| **Top-level design** | `docs/architecture.md` in each repo; `docs/product.md` in the repo, or at the project root when the project spans repos | The project's life | Maintained continuously, including mid-task |
| **ADR** | `docs/adr/` in the repo the decision concerns | The project's life | Written during the design stage, as decisions are made |
| **Task document** | `task.md` at the workspace root | The task | Claude, throughout |

**Top-level design.** Two documents, each under about 200 lines. The limit is the
point: a document nobody can read in one sitting stops being read, and these two are
meant to be read by every task. When a task changes what they say, the change is part
of that task.

**ADR.** One decision per file: context, decision, reasoning. Written when the
decision is made, not reconstructed afterwards, and edited in place when a decision
changes — the project keeps the current answer, not an archaeology of previous ones.
Retrieval is a tool rather than a discipline: `find_adr(query)` scans every ADR's
front matter and returns the few that bear on the question, so no hand-maintained
index exists to drift.

**Task document.** One file, holding the requirement, the design, the test cases, and
the record of which stages have passed. Never committed, and it dies with the
workspace.

---

## 6. Tickets

One file per task under `<PROJECT>/tickets/`, written by the plugin and never by
hand. It holds the description, the branch, the workspace path, the repositories, the
Claude session id, the stage, and the status.

Its purpose is recovery. Days later the user remembers a task by what it was about,
not by its branch name, so `find_ticket(query)` matches on the description and returns
the workspace path and the session id to resume. Its default listing is unfinished
work — active and backlog, with `done`, `abandoned`, `all` and the archive one
argument away.

**The session id is passed in** to `start_task`, supplied by the task skill from
`CLAUDE_CODE_SESSION_ID`; with nothing available the ticket records null, and
`SessionStart` repairs it if a session later starts inside that ticket's own
workspace. Three other mechanisms failed first (ADR 0002).

**A ticket has a life of its own.** `add_ticket` records a description and a branch
and nothing else — a backlog entry, which is `active` at stage 0 rather than a fourth
status (ADR 0004). `set_ticket_status` moves a ticket between `active` and
`abandoned` in either direction, but cannot write `done`: that is what stage 10
produces after the user's acceptance, and a management tool able to write it would be
a way around that acceptance (ADR 0006). `archive_ticket` moves the file into
`tickets/archive/` and back — a move, never a delete, because the ticket is the only
record of what a directory on disk was for (ADR 0005).

Those three are addressed by branch name, since managing a ticket means acting on one
whose workspace you are not in. A branch name therefore reaches a file path with no
directory creation to stop it on the way, so it is validated where it enters:
lower-case letters, digits and hyphens, nothing that can traverse.

Workspaces are never deleted, whatever happens to their tickets. A worktree can hold
uncommitted work, and nothing in the plugin can judge whether it matters.

---

## 7. Stages

Ten stages. The stage lives in the ticket; the server owns it.

| # | Stage | Ends when |
| :-- | :-- | :-- |
| 1 | New task | Workspace directory, ticket, and task document exist |
| 2 | Requirements interview | The requirement is written in the task document; the repositories involved are settled and their worktrees created |
| 3 | Design | The design is in the task document; ADRs for decisions made are written |
| 4 | Codex reviews the design | Findings addressed; skipped when codex is off |
| 5 | **User reviews the design** | The user approves — **dialog** |
| 6 | **Failing tests** | The tests exist, run, and fail; the user has seen the failure — **dialog** |
| 7 | Implementation | The suite is green |
| 8 | Codex reviews the code | Findings addressed; skipped when codex is off |
| 9 | **User acceptance** | The user has run it, accepts, and thereby authorises the pull request — **dialog** |
| 10 | Pull request | The PR is open |

Three stages end in a dialog — 5, 6 and 9. The rest end when Claude calls
`advance_stage` and the server agrees the stage's output exists. That check is a
formality check, not a quality check: a program can see that a Design section exists,
not whether the design is any good. **The server checks that the work happened; the
user checks that it was worth happening.**

Worktrees are created at the end of stage 2, not stage 1, because which repositories
a task touches is an outcome of the interview. Stages 4 and 8 are switchable in
project config, and switched off they are skipped rather than passed.

**Going backwards.** Declining at stage 5 returns the task to stage 3: the design was
wrong, so the design is what changes. Declining at stage 9 is ambiguous — acceptance
can fail because the implementation is wrong or because the design was — so Claude
asks which, and returns to stage 7 or stage 3 accordingly. The ticket records each
return, so a task that went around twice says so.

**What a dialog says.** The terminal cannot be scrolled while a dialog is open, so
each message carries its own context — what is being approved, and what accepting
causes — rather than pointing at a conversation the user cannot see (ADR 0008).

---

## 8. The server

One MCP server, eleven tools, in four groups: the task's life (`start_task`, `finish_task`,
`abandon_task`), the stage (`advance_stage`, `return_to_stage`, `get_status`),
retrieval (`find_adr`, `find_ticket`), and the ticket as an object in its own right
(`add_ticket`, `set_ticket_status`, `archive_ticket`). Each tool describes itself to
the client, so what each one takes is not restated here.

Stage 9's acceptance is also the authorisation to send the work out: accepting sets
`authorised_at` in the same write as the stage change, and stage 10 asks nothing
(ADR 0007). `finish_task` stays separate and still refuses without `authorised_at` —
a task is not done because permission was given, but because the work left the
machine. An advance waiting on a dialog holds the task: a second `advance_stage`
arriving meanwhile is turned away rather than queued, so one stage never raises two
dialogs.

`advance_stage` takes a stage name, not the wording of the dialog. The server holds
that text, so the question the user is asked is always the plugin's, and the answer
returns to the server without passing through Claude. MCP elicitation raises the
dialog, blocks until answered, and returns `accept` or `decline`; with an empty
requested schema the dialog has no fields, so approving is a single action.

The server holds no state in memory: one process per session, so anything held there
would be lost on restart and invisible to a second session working on another task in
the same project. Everything is in the ticket file.

---

## 9. Init

`init` adopts a project, once. It creates `tickets/`, writes the document skeletons
that are missing — `docs/architecture.md`, `docs/product.md`, and
`docs/adr/README.md` in each repository (ADR 0003) — and asks for the three facts it
cannot discover. It moves, clones and reorganises nothing: repositories are wherever
they already are inside `main/`, and finding them is a directory listing. Skeletons
are headings and a sentence about what belongs under each; the content is the user's.

The three config values are not the same kind of thing, and saying so prevents them
being treated alike. **`codex` is read by the server** and is the only value any
program reads: it decides whether stages 4 and 8 happen. **`test` and `try` are read
by Claude** — they exist so the question is asked once per project rather than once
per task, and their values are prose as much as commands. `try` is named for what
stage 9 needs, a way for the user to exercise the change themselves; a project with
nothing to launch answers it with a sentence.

Which repositories a task touches is a per-task answer and lives in that task's
ticket, so the config holds no inventory.

---

## 10. Degradation

**A project that never adopted the plugin.** The refusal hook looks for a ticket
covering the current directory. Finding none, it exits without a decision. Silence is
the default; enforcement is the exception.

**Codex not installed.** Stages 4 and 8 are skipped, and the task document records
that they were skipped rather than passed.

**A task abandoned mid-way.** The ticket is marked abandoned, the workspace is left
alone, and nothing is deleted on the plugin's initiative.

**The server not running.** Stages cannot advance and the refusal stays in force.
Failing closed is right here: a task that cannot proceed is recoverable, a task that
silently proceeds unsupervised is not.

**The refusal hook not working.** The other direction, stated because the sentence
above would otherwise be read as covering it. The hook fails open: if it crashes,
times out, emits invalid JSON, or cannot parse the ticket that would have told it the
stage, the write proceeds — Claude Code treats a crashed or timed-out `PreToolUse`
hook as no decision, and an unparseable ticket is indistinguishable to the hook from
a project that never adopted the harness.

That is intended, for the same reason the server's direction is the opposite: the
server failing closed stops a task, while the hook failing closed would stop a
project — one corrupt file in `tickets/` would make every repository in it unwritable,
including the documents the harness tells you to go and fix. The cost is worth naming
plainly. **A refusal that fails open is not a guarantee**, which is the claim §2 makes
about circumvention reached from the other side. Cases 49-52 hold the refusal, and 52
holds this degradation.

---

## 11. Deliberately not in the design

What the product will not do is in `product.md`, and is not repeated here. Three
exclusions are architectural rather than product decisions, and belong with the
design they shape:

- **No defence against deliberate circumvention** (§2), stated as a decision so it is
  not mistaken for an oversight.
- **No path classification.** No rules about what counts as a source file, and
  therefore no per-project path patterns to configure or protect (§2).
- **No model calls of its own.** The plugin never invokes a model; it shapes what
  Claude does.
