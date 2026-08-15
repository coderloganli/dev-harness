# Claude Code Harness — Architecture

Status: draft, pending review
Last updated: 2026-08-10

The harness is a Claude Code plugin that governs three things: the documents a
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
  config.json             project config: codex on/off, and how to test and try
  tickets/                one file per task
```

`main/` is not a special case: it is the workspace for the base branch, with the
same shape as every task workspace. Repositories are found by looking inside it,
which is why nothing has to be recorded about where they are.

**`main/` is always a container, one directory per repository, even when there is
only one.** The obvious shortcut — letting `main/` be the checkout itself in a
single-repository project — costs more than it saves: the task workspace would
have to change shape to match, and then the task document has nowhere to live
except inside the repository, which is exactly what it must never do. One layout,
one rule, one place for `task.md`.

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

**The session id is passed in.** `start_task` takes it as an argument, and the task
skill reads `CLAUDE_CODE_SESSION_ID` in a shell call to supply it. With no argument
the server tries its own environment, which is empty today and costs nothing to try.
With neither, the ticket records null.

Getting the id to the ticket took three failed attempts, and what they have in
common is worth more than any of them:

- A hook wrote it into the ticket — but resolved *which* ticket from the event's
  working directory, and a session creating a task is usually nowhere near the
  workspace it is about to create.
- The server read it from its own environment — but a bundled MCP server does not
  inherit `CLAUDE_CODE_SESSION_ID`, and a test that sets the variable itself cannot
  discover that.
- A shared record was designed to bridge the two — and cut, because it could hold a
  session from another project or one closed days ago, producing a wrong id where
  there had been none.

`SessionStart` still repairs a ticket when a session starts inside that ticket's own
workspace. That is the one place where resolving from the working directory is
right: the session demonstrably is there. See
`docs/adr/0002-session-id-from-the-environment.md`.

**A ticket has a life of its own.** It is created by `start_task` at stage 1, or
written down before there is any work at all: `add_ticket` records a description and
a proposed branch with no workspace, no worktree and no stage. That is a backlog
entry — `active`, at stage 0, which `describe` renders as `backlog`. The status set
stays `active`, `done`, `abandoned`, because status says whether the work is live
and stage says how far it has got, and a fourth status would say the second thing
twice (`docs/adr/0004-backlog-is-a-stage-not-a-status.md`).

From there `set_ticket_status` moves a ticket between `active` and `abandoned`, in
either direction, so a dropped task can be reopened — reopening a finished one also
clears `finished_at` and `authorised_at`, because a live task cannot also be one the
user has already authorised sending out, and returns the stage to 9, which is where
the dialog that authorises it lives. It cannot write `done`. `done` is what stage 10
produces once the user has accepted the feature at stage 9, and a management tool
that could write it directly would be a way around that acceptance
(`docs/adr/0006-management-cannot-produce-done.md`). Every change it does make
raises the plugin's dialog first.

**Cleanup is a move, not a delete.** `archive_ticket` moves the file into
`tickets/archive/`, out of every listing, and back out again on request. Nothing is
removed: not the ticket, not the workspace, not the worktree, not the branch. The
archive being a directory rather than a field is what makes the default listing
free — `allTickets` reads one directory, and archived tickets are simply not in it
(`docs/adr/0005-archiving-moves-the-file.md`).

These three are addressed by branch name rather than by the working directory, since
managing a ticket means acting on one whose workspace you are not in. A branch name
therefore reaches a file path without a directory creation to stop it on the way, so
it is validated where it enters: lower-case letters, digits and hyphens, nothing
that can traverse.

**The default listing shows unfinished work.** `find_ticket` with no arguments
returns active and backlog tickets, and nothing else; `done`, `abandoned`, `all` and
the archive are all reachable by asking. It answers as a table, one line per ticket,
and falls back to the full block when exactly one ticket matches — a search that
lands on one ticket is someone trying to get back into it.

Workspaces are still not deleted when a task finishes, so directories on disk
accumulate whatever happens to their tickets. Reclaiming that space stays the user's
own, deliberately: a worktree can hold uncommitted work, and nothing in the plugin
can judge whether it matters.

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

Three stages end in a dialog the user answers — 5, 6 and 9. The rest end when Claude calls
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

**What a dialog says.** The terminal cannot be scrolled while a dialog is open, so
whatever Claude presented just before it is out of reach until it is answered. Each
message therefore carries its own context — what is being approved, and what
accepting causes — rather than pointing at a conversation the user cannot see. The
plugin cannot make the dialog scrollable: `elicitation/create` carries a message and
a schema, and how it is drawn belongs to the client
(`docs/adr/0008-a-dialog-says-what-accepting-does.md`).

---

## 8. The server

One MCP server, eleven tools.

| Tool | What it does |
| :-- | :-- |
| `start_task` | Create the workspace, the ticket, and the task document |
| `advance_stage` | Check the current stage's output, raise a dialog when the stage needs the user, record the new stage |
| `return_to_stage` | Send the task back to an earlier stage, with the user's reason |
| `finish_task` | Mark the task done once the pull requests exist |
| `abandon_task` | Mark the task abandoned; delete nothing |
| `get_status` | Report the current task: stage, workspace, repositories, what is refused |
| `find_adr` | Search ADRs across the task's repositories |
| `find_ticket` | Search tickets by description, or list them; return workspace path and session id |
| `add_ticket` | Write down a backlog entry: a description and a proposed branch, and nothing else |
| `set_ticket_status` | Move a ticket between active and abandoned, by name, after the user accepts |
| `archive_ticket` | Move a ticket into the archive, or back out of it |

Stage 9's acceptance is also the authorisation to send the work out: accepting sets
`authorised_at` in the same write as the stage change, and stage 10 asks nothing.
Two dialogs on consecutive screens, about the same work, with nothing happening
between them, made the acceptance weaker rather than stronger — a confirmation that
always follows another confirmation stops being read
(`docs/adr/0007-one-acceptance-authorises-the-pull-request.md`).

`finish_task` is still separate, and still refuses without `authorised_at`. That
keeps the ticket honest — a task is not done because permission was given, but
because the work left the machine. What went away is the second question, not the
second record.

An advance that is waiting on a dialog holds the task: a second `advance_stage`
arriving meanwhile is turned away rather than queued, so one stage never raises two
dialogs.

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
that are missing — `docs/architecture.md`, `docs/product.md`, and `docs/adr/README.md`
in each repository — and asks for the three facts it cannot discover: how the test
suite is run, how the user tries a change, and whether codex is available.

The decision-record directory gets a README rather than being left empty, because
git does not track empty directories and the directory would vanish on the first
commit. Making that file the README rather than a `.gitkeep` means it also explains
what the directory is for. `find_adr` skips it, since it holds no decision and
contains the words every search is made of.

It does not move, clone, or reorganise anything. Repositories are wherever they
already are inside `main/`, and finding them is a directory listing.

Skeletons are skeletons. The plugin writes headings and a sentence about what
belongs under each; the content is the user's.

Project config therefore holds three values and no inventory. Which repositories a
task touches is a per-task answer and lives in that task's ticket.

The three are not the same kind of thing, and saying so prevents the mistake that
produced them being treated alike. **`codex` is read by the server** and is the only
value any program reads: it decides whether stages 4 and 8 happen. **`test` and
`try` are read by Claude** — they exist so the question is asked once per project
rather than once per task, and their values are prose as much as commands. `try` is
named for what stage 9 needs, which is a way for the user to exercise the change
themselves; a project with nothing to launch answers it with a sentence.

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
- **No deletion, of anything, ever.** Cleanup is archiving. Workspaces accumulate on
  disk and removing them stays the user's own act.
- **No issue tracker.** A backlog entry is a description and a branch name. No
  assignee, no priority, no labels, no cross-project view, and no remote or shared
  store — the tickets of one project are the files in one directory.
