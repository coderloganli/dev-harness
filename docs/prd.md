# dev-harness — Product Requirements Document

Status: draft, pending review
Last updated: 2026-08-10

dev-harness is a Claude Code plugin. It governs three things, and they are
independent of each other:

- **The documents a project keeps** — a short top-level design, a searchable record
  of decisions, and a throwaway document per task.
- **The workspace a task runs in** — one per task, isolated, findable again later.
- **The stages a task passes through** — ten of them, three ending in your approval.

---

# Part 1 — The problems, and how dev-harness solves them

## 1.1 Documents

### The design document nobody reads

**What happens.** A project's architecture document grows until reading it is a
project of its own. So nobody reads it, including Claude, which infers the design
from whatever files it happened to open and produces code that is locally
reasonable and globally wrong.

**How dev-harness solves it.** Two top-level documents, architecture and product
design, each held to about 200 lines. The limit is the feature. A document short
enough to read in one sitting is a document every task can be expected to have
read, and that expectation is what makes it worth maintaining.

### The design document that is no longer true

**What happens.** Updating the architecture document is always a separate task, and
separate tasks do not get scheduled. Within a year it describes a system that no
longer exists and actively misleads.

**How dev-harness solves it.** A task that changes what those documents say updates
them as part of that task, at the moment the change is made, not afterwards.
Documentation is writable in every stage, including before any approval, so
recording a decision is never something Claude has to ask permission for.

### Decisions that were made and then lost

**What happens.** Why is the cache in SQLite? Someone decided, with reasons, two
years ago. The reasons are in a pull request comment nobody can find, so the
decision gets silently relitigated — often by Claude, which has no way to know it
was ever settled.

**How dev-harness solves it.** One decision per file under `docs/adr/`: context,
decision, reasoning. Written during the design stage, as the decision is made.
Retrieval is a tool rather than a discipline: `find_adr` searches every decision
record across the task's repositories and returns the few that bear on the question,
so Claude does not have to guess filenames or read the whole directory.

### The task's own thinking has nowhere to live

**What happens.** The requirement, the design, and the test cases exist only in the
conversation. They cannot be reread, revised, or pointed at. Writing them to a file
instead means a file that pollutes the repository and shows up in the diff.

**How dev-harness solves it.** One document per task, at the workspace root —
outside every repository. It holds the requirement, the design, the test cases, and
the record of stages passed. It cannot appear in a diff, needs no ignore rule, and
dies with the workspace.

## 1.2 Workspace

### An abandoned attempt leaves your checkout dirty

**What happens.** You try something, it does not work out, and your checkout has
half-applied edits and a modified config. Cleaning up is manual, and you are never
quite sure it is clean.

**How dev-harness solves it.** Every task gets its own workspace directory with its
own git worktrees, created from an up-to-date base branch. All work happens there.
Abandoning a task touches nothing else.

### You cannot work on two things at once

**What happens.** A task is half-done and something urgent arrives. Stash, branch
over unfinished work, or wait.

**How dev-harness solves it.** Workspaces are siblings and know nothing about each
other. You start the urgent task in a second window.

### A change that spans repositories is not one thing

**What happens.** The feature needs a change in the API and a change in the web
client. That is one piece of work, but git gives you two branches in two clones,
kept in step by memory.

**How dev-harness solves it.** One workspace holds a worktree for every repository
the task touches, all on the same branch name. One task, one branch, one directory,
however many repositories.

### You cannot find your way back

**What happens.** Three days later you remember there was a task about search
ranking. You do not remember the branch name, the directory, or which session it
was, and Claude has no memory of it either.

**How dev-harness solves it.** Every task has a local ticket holding its
description, its workspace path, and its Claude session id. `find_ticket` matches on
what the task was about, and hands back the directory to return to and the session
to resume.

## 1.3 Stages

### Claude writes the code before you have seen the design

**What happens.** You describe a feature; Claude proposes an approach and implements
it in the same reply. By the time you read the proposal, several files have changed
and disagreeing costs a rewrite.

**How dev-harness solves it.** Until you approve the design, nothing inside any
repository is writable except the design documents themselves. Not "Claude is
instructed not to" — the write is refused. This is the only hard refusal in the
product, and after your approval there are none.

### The tests are written after the code, so they only confirm it

**What happens.** Claude implements the feature and then writes tests. They pass
immediately, because the implementation shaped them. They document what the code
does, not what it should do.

**How dev-harness solves it.** Writing the failing tests is its own stage, and it
ends with you looking at the failure output. A test that passes before the feature
exists is a defect, and you are the one who sees it.

### Nobody reviews the design, and code review comes too late

**What happens.** Review happens on the finished code, where every finding is
expensive, and design mistakes have already been built on.

**How dev-harness solves it.** The design is reviewed twice before implementation —
once by codex, once by you — and the code is reviewed again afterwards. Wrong
designs are cheapest to fix while they are still a document.

### The procedure dissolves over a long task

**What happens.** Under time pressure, or simply after two hours and a compaction,
the plan-first habit quietly stops happening.

**How dev-harness solves it.** The current stage is held by the plugin, not by
Claude's memory of it. Claude can ask to move to the next stage; the plugin checks
the stage actually produced something and, for the three stages that need you,
asks you. The stage is restated whenever the session starts or the stage changes.

## What dev-harness does not try to do

- Make Claude faster. It is slower at the front, on purpose.
- Decide what to build. It governs how, never what.
- Defend against a model deliberately working around it. The harness keeps an
  honest process honest; that is the whole claim.
- Provide a reviewer, a test runner, or language support. Codex is named in config
  and invoked, or switched off.
- Manage CI, deployment, releases, or issue trackers.

---

# Part 2 — A task, end to end

The project is a note-taking app called `notes`, spanning two repositories: `api`
and `web`. The task is to let users search their notes. Each step says who acts.

## Before any task — `/dev-harness:init`, once per project

dev-harness writes the document skeletons that are missing — `docs/architecture.md`,
`docs/product.md`, an empty `docs/adr/` in each repository — creates `tickets/`, and
asks for the three things it cannot discover: the test command, the run command,
and whether codex is available.

It moves nothing and clones nothing. Your repositories stay where they are, inside
`main/`.

```
notes/
  main/
    api/        main checkout
    web/        main checkout
  config.json
  tickets/
```

Skeletons are headings and a sentence about what belongs under each. The content
is yours.

## Stage 1 — New task

**You:** `/dev-harness:task`, and answer one open question — what problem does this
solve? "Once you have a few hundred notes you cannot find anything."

**Automatic:** dev-harness proposes the branch name `add-note-search`, you confirm
it, and it creates the workspace directory, the ticket, and the task document.

```
notes/
  add-note-search/
    task.md
```

No worktrees yet: which repositories this touches is something the interview
decides.

## Stage 2 — Requirements interview

**Automatic:** dev-harness reads the two top-level documents, searches the decision
records for anything bearing on search or storage, and looks at the code it may
touch.

**You:** it comes back with batched questions. Titles only or body too?
Case-sensitive? Does an empty query show everything or nothing? Are tags in scope?
Which repositories does this touch — both, or just the API?

**Automatic:** your answers go into `task.md`, and the worktrees for the settled
repositories are created, all on the branch `add-note-search`:

```
notes/
  add-note-search/
    task.md
    api/        worktree on add-note-search
    web/        worktree on add-note-search
```

From here everything happens inside that directory. `main/` is not touched again.

## Stage 3 — Design

**Automatic:** dev-harness writes the design into `task.md`, naming the files and
modules that change in each repository, and enumerating the test cases with their
triggers and expected outcomes.

Decisions made along the way are written as decision records immediately — a new
file under `api/docs/adr/` for the choice of search implementation. If the design
changes what `docs/architecture.md` says, that document is edited now, in the same
task.

Nothing else in either repository is writable yet.

## Stage 4 — Codex reviews the design

**Automatic:** codex reviews the design section of `task.md` against the top-level
documents and the decision records. Claude addresses the findings and revises the
design before you see any of it.

Skipped when codex is switched off in config.

## Stage 5 — You review the design

**You:** read the design, argue with it, ask for changes. When you are satisfied, a
dialog appears — the wording is the plugin's, not Claude's:

```
Stage 5 — approve the design for add-note-search?
  Accept   Decline
```

Accepting is what lifts the refusal. Nothing else does. Declining sends the task
back to stage 3 and the refusal stays in force.

## Stage 6 — Failing tests

**Automatic:** dev-harness writes exactly the test cases from `task.md`, runs them,
and shows you the failures and which spec case each test came from.

**You:** check the failures are for the intended reason — the feature is missing,
not the test misspelled — then accept the dialog.

## Stage 7 — Implementation

**Automatic:** code until the suite is green, including tests that already existed,
across both repositories.

**You:** nothing, usually. This is the stretch where you can leave.

If the design or a test turns out to be wrong, dev-harness stops and asks rather
than quietly adjusting either.

## Stage 8 — Codex reviews the code

**Automatic:** codex reviews the diff with `task.md` as the reference. Claude fixes
what is real, argues what is not, and re-runs until clean.

Skipped when codex is switched off.

## Stage 9 — You accept it

**Automatic:** dev-harness starts the app with the project's run command and hands
you the URL and a query to type.

**You:** use it. This stage is not "does Claude think it works" — it is you having
run it. Accept, and the task moves to the pull request.

Decline, and Claude asks one question: is this a design problem or an
implementation problem? A design problem sends the task back to stage 3, an
implementation problem back to stage 7, and it comes forward through the same
stages again. The ticket records the return, so a task that went around twice says
so.

## Stage 10 — Pull request

**You:** one dialog authorises the whole thing — you already accepted the feature
at stage 9, and this stage is sending it out.

**Automatic:** commits in each repository with a message describing the change and
why, pushes the branch, and opens a pull request per repository. The workspace
stays where it is.

---

## Coming back to a task

Days later: "continue that task about search ranking." `find_ticket` matches the
description and returns the workspace path and the session id, so you resume the
session you left rather than re-explaining the task. A slash command gives you the
same search directly.

## What you will see refused

Only one thing, and only before stage 5:

```
Write to api/src/search.ts refused.
The design has not been approved yet (stage 3 of 10).
Present the design in task.md and ask for approval.
Documentation stays writable: docs/architecture.md, docs/product.md, docs/adr/.
```

After stage 5, nothing is refused for the rest of the task.

## Several tasks at once

Each workspace has its own ticket, its own stage, and its own worktrees. Starting a
second task while the first is unfinished is ordinary, not a recovery procedure.

## Configuration

One file at the project root, holding three things: the test command, the run
command, and whether codex is available. It is not in any repository, so a project
spanning several repositories has exactly one.

There is no inventory of repositories in it. They are whatever is inside `main/`,
and which ones a given task touches is recorded in that task's ticket.

## What dev-harness will not do to you

It never rewrites history, never stashes your work, never deletes a workspace, and
never touches a main checkout while a task is running. Finished workspaces are left
alone until you decide otherwise.
