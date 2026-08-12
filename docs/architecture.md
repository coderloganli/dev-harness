# dev-harness — Architecture

Status: draft, pending review
Last updated: 2026-08-10

dev-harness is a Claude Code plugin that governs three things: the documents a
project keeps, the workspace a task runs in, and the stages a task passes through.

This document says what the system is and how it gets Claude to follow the
procedure. It stays out of implementation detail.

---

## 1. What the system is

A plugin directory the harness loads when the plugin is enabled. Almost everything
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

The line that matters: **a skill is text Claude may or may not follow; the server
and the hooks are programs that run either way.** Every rule below is placed on one
side of that line on purpose.

---

## 2. How Claude is kept on the procedure

Three means, in increasing order of strength. Most of the method sits on the first
one, and that is not a defect to be engineered away — it is what a method is.

**Instruction.** The procedure is a skill loaded when the user starts a task. This
is the only means that can express anything needing judgement: how far to read, when
the interview is done, whether a review finding is real. It decays over a long
session, which §3 addresses.

**Stage control.** The current stage lives in the ticket, and the ticket is written
by the server, not by Claude. To move on, Claude calls `advance_stage`; the server
checks the stage's output exists before agreeing, and for the three stages that
need the user, raises a dialog and waits. Claude can ask to advance. It cannot
advance.

**One refusal.** A `PreToolUse` hook refuses writes inside a repository until the
design has been approved. That is the whole of hard enforcement.

There is deliberately no more. The user's instruction was to design for the happy
path and not against a model that is trying to get around the harness. A model
drifting under context pressure is stopped by the stage machine and the reminders;
a model determined to circumvent them is not something this design tries to beat,
and pretending otherwise would buy complexity with no safety.

### What is refused, exactly

Until the user approves the design, nothing inside any repository is writable
except three paths:

```
docs/architecture.md
docs/product.md
docs/adr/**
```

Everything else in a repository is refused, with a message naming the stage and
what would open it.

Two properties make this cheap. It needs no per-project configuration, because
those three paths are conventions the plugin establishes at `init` time rather than
facts it has to discover. And it needs no notion of "source file" or "test file" —
the distinction that would have dragged in path patterns, project config, and rules
about protecting that config. The task document is outside every repository (§4), so
it is writable throughout without being an exception.

After the design is approved, nothing is refused for the rest of the task.

---

## 3. Keeping instruction alive

A long task compacts, resumes, and fills with unrelated output. A procedure stated
at turn 3 is not reliably present at turn 300. Two techniques, neither of which
enforces anything:

**Re-state the stage.** At session start and resume, and whenever a stage changes,
the current stage and what it calls for are injected as context. On a refusal, the
message says what would open the gate. A refusal is the one moment the model is
guaranteed to be attending to the rule, so its message is written as an
instruction — "the design is not approved yet; present it and ask" — never as a
bare error.

**Make the correct path the cheapest one.** The task document template already has
its sections, so filling them in beats inventing a format. `find_adr` beats
guessing filenames. `advance_stage` beats deciding on its own whether it is done.
A model under context pressure takes the locally cheapest action; the design's job
is to arrange for that to be the intended one.

---

## 4. Layout

A project is a directory the plugin creates. Inside it: the main checkout of each
repository, one workspace per task, and the things that belong to the project but
to no repository.

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
  config.json             project config: codex on/off, test and run commands
  tickets/                one file per task
```

`main/` is not a special case: it is the workspace for the base branch, with the
same shape as every task workspace. Repositories are found by looking inside it,
which is why nothing has to be recorded about where they are.

Three consequences worth stating because they do work later:

**The task document is outside every repository.** Nothing has to be excluded, no
ignore file is touched, and it can never appear in a diff. This is why `task.md`
sits at the workspace root rather than inside a worktree.

**A task is identified by its workspace path.** Concurrency and resumption both
fall out of that for free: two workspaces do not know about each other, and a
session started inside one is recognised as belonging to that task without being
told.

**All repositories in a task share one branch name**, which is also the workspace
directory name. One task, one branch, however many repositories it touches.

---

## 5. Documents

Three kinds, with three lifetimes.

| | Where | Lifetime | Written by |
| :-- | :-- | :-- | :-- |
| **Top-level design** | `docs/architecture.md` in each repo; `docs/product.md` in the repo, or at the project root when the project spans repos | The project's life | Maintained continuously, including mid-task |
| **ADR** | `docs/adr/` in the repo the decision concerns | The project's life | Written during the design stage, as decisions are made |
| **Task document** | `task.md` at the workspace root | The task | Claude, throughout |

**Top-level design.** Two documents, each under about 200 lines. The limit is the
point: a document nobody can read in one sitting stops being read, and these two
are meant to be read by every task. When a task changes what they say, the change
is part of that task, made as it happens rather than deferred.

**ADR.** One decision per file: context, decision, reasoning. Written when the
decision is made, in the design stage, not reconstructed afterwards. When a decision
changes, the record is edited in place — the project keeps the current answer, not
an archaeology of previous ones.

Retrieval is a tool, not a discipline. `find_adr(query)` scans every ADR's front
matter across the task's repositories and returns matching titles, one-line
summaries, and paths; Claude then reads the few that matter. The alternative — an
index file kept in step by hand — puts every ADR in two places and lets them drift.

**Task document.** One file, holding the requirement, the design, the test cases,
and the record of which stages have passed. Never committed, because it lives
outside the repositories, and it dies with the workspace.

---

## 6. Tickets

One file per task under `<PROJECT>/tickets/`, created by the plugin at stage 1 and
never hand-edited. It holds the task description, the branch, the workspace path,
the repositories involved, the Claude session id, the current stage, and the
status.

Its purpose is recovery. Days later the user remembers a task by what it was about,
not by its branch name, so `find_ticket(query)` matches on the description and
returns the workspace path and the session id to resume. A slash command exposes
the same search to the user directly.

One implementation constraint: **the session id reaches the plugin only through
hook events, not through the server.** A hook writes it into the ticket; the server
reads it back. Anything that needs it has to go through that path.

Workspaces are not deleted when a task finishes, so both workspaces and tickets
accumulate. Managing them — listing, filtering by status, cleaning up finished
ones — is a later addition, not part of the first version.

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
| 9 | **User acceptance** | The user has run it and accepts — **dialog** |
| 10 | Pull request | The PR is open |

Three stages end in a dialog the user answers. The rest end when Claude calls
`advance_stage` and the server agrees the stage's output exists — the task document
has the section, the ADR files are there, the test command was run and reported
failures.

That check is a formality check, not a quality check. A program can see that a
Design section exists; it cannot see whether the design is any good. The design's
quality is what stages 4 and 5 are for, and the quality of the failing tests is what
the stage 6 dialog is for. **The server checks that the work happened; the user
checks that it was worth happening.**

Worktrees are created at the end of stage 2, not stage 1, because which
repositories a task touches is an outcome of the interview. Stage 1 creates the
workspace directory, the ticket, and the task document; the worktrees appear once
there is an answer.

Stage 4 and stage 8 are switchable in project config, because not every user has
codex. Switched off, they are skipped rather than passed.

**Going backwards.** Declining at stage 5 returns the task to stage 3: the design
was wrong, so the design is what changes. Declining at stage 9 is ambiguous —
acceptance can fail because the implementation is wrong or because the design was —
so Claude asks which, and returns to stage 7 or stage 3 accordingly. The dialog
itself stays a two-button accept/decline, because putting the choice in the dialog
would cost a second click on every acceptance to serve the case that fails. The
ticket records each return, so a task that went around twice says so.

---

## 8. The server

One MCP server, four tools.

| Tool | What it does |
| :-- | :-- |
| `advance_stage` | Check the current stage's output, raise a dialog when the stage needs the user, record the new stage in the ticket |
| `get_status` | Report the current task: stage, workspace, repositories, what is refused |
| `find_adr` | Search ADRs across the task's repositories |
| `find_ticket` | Search tickets by description; return workspace path and session id |

`advance_stage` takes a stage name. It does not take the wording of the dialog. The
server holds that text, so the question the user is asked is always the plugin's,
and the answer returns to the server without passing through Claude. This was
verified before the design was settled: MCP elicitation raises the dialog, blocks
until the user answers, and returns `accept` or `decline`. With an empty requested
schema the dialog has no fields, so approving is a single action.

The server holds no state in memory. One process is started per session, so state
in memory would be lost on restart and invisible to a second session working on
another task in the same project. Everything is in the ticket file.

---

## 9. Init

`init` adopts a project, once. It creates `tickets/`, writes the document skeletons
that are missing — `docs/architecture.md`, `docs/product.md`, an empty `docs/adr/`
in each repository — and asks for the three facts it cannot discover: the test
command, the run command, and whether codex is available.

It does not move, clone, or reorganise anything. Repositories are wherever they
already are inside `main/`, and finding them is a directory listing.

Skeletons are skeletons. The plugin writes headings and a sentence about what
belongs under each; the content is the user's.

Project config therefore holds three values and no inventory. Which repositories a
task touches is a per-task answer and lives in that task's ticket.

---

## 10. Degradation

**A project that never adopted the plugin.** The refusal hook looks for a ticket
covering the current directory. Finding none, it exits without a decision. Silence
is the default; enforcement is the exception.

**Codex not installed.** Stages 4 and 8 are skipped, and the task document records
that they were skipped rather than passed.

**A task abandoned mid-way.** The ticket is marked abandoned. The workspace is left
alone, because the user may come back to it; nothing is deleted on the plugin's
initiative.

**The server not running.** Stages cannot advance and the refusal stays in force.
Failing closed is the right direction: a task that cannot proceed is recoverable, a
task that silently proceeds unsupervised is not.

---

## 11. Deliberately not in the design

- **No defence against deliberate circumvention.** Stated as a decision so it is
  not mistaken for an oversight. The harness keeps an honest process honest.
- **No path classification.** No rules about what counts as a source file or a test
  file, and therefore no per-project path patterns to configure or protect.
- **No model calls of its own.** The plugin never invokes a model. It shapes what
  Claude does.
- **No bundled tooling.** No reviewer, no test runner, no language support. Codex is
  named in config and invoked by name, or switched off.
- **No workspace or ticket lifecycle management in version one.** Workspaces
  accumulate. Cleaning up is a later feature.
