# Product design

## What this is

The harness is a Claude Code plugin that makes Claude build software the way a
careful engineer does: read the design first, agree it before writing code, write
the failing test before the feature, work in a scratch space that cannot damage
anything, and keep the documentation true.

It governs three things, and they are independent of each other:

- **Documents** — a short top-level design, a searchable record of decisions, and a
  throwaway document per task.
- **Workspace** — one per task, isolated, findable again weeks later.
- **Stages** — ten of them, three ending in a dialog the user answers.

## Who it is for

**The solo practitioner with several projects**, who wants the same rigour in every
repository without re-explaining it, and who values the gates as protection against
their own tendency to accept whatever the model produced first.

**A small team standardising how they use Claude Code**, who want review and test
discipline enforced by the tool, and project facts recorded in the repository
rather than in one person's head.

**Not for** exploratory scripting or a one-line fix. The harness is deliberately
heavy at the front, and it must never impose itself on a project that has not opted
in.

## The problems it solves

### Documents

**The design document nobody reads.** An architecture document grows until reading
it is a project of its own, so nobody does — including Claude, which then infers
the design from whatever files it happened to open. Two top-level documents,
architecture and product design, both bounded — 350 lines and 200. The limit is the
feature: a document short enough to read in one sitting can be expected of every
task, and that expectation is what makes it worth maintaining. A limit nothing checks
is a wish, so both are held by a test.

**The design document that is no longer true.** Updating it is always a separate
task, and separate tasks do not get scheduled. A task that changes what those
documents say updates them as part of that task. Documentation is writable in every
stage, so recording something is never a thing to ask permission for.

**Decisions made and then lost.** Why is the cache in SQLite? Someone decided, with
reasons, and the reasons are in a pull request comment nobody can find, so the
decision gets silently relitigated. One decision per file under `docs/adr/`, written
during the design stage as the decision is made. Retrieval is a tool rather than a
discipline: `find_adr` returns the few records that bear on the question.

**The task's own thinking has nowhere to live.** The requirement, the design and the
test cases exist only in the conversation, or in a file that pollutes the
repository. One document per task, at the workspace root, outside every repository:
it cannot appear in a diff, needs no ignore rule, and dies with the workspace.

### Workspace

**An abandoned attempt leaves your checkout dirty.** Every task gets its own
workspace with its own git worktrees, created from an up-to-date base branch.
Abandoning a task touches nothing else.

**You cannot work on two things at once.** Workspaces are siblings and know nothing
about each other.

**A change that spans repositories is not one thing.** One workspace holds a
worktree for every repository the task touches, all on the same branch name.

**You cannot find your way back.** Every task has a local ticket holding its
description, its workspace path, and — when it was recorded — the Claude session it
was worked in. `find_ticket` matches on what the task was about and hands back the
directory, and the session to resume when there is one. A task whose session was
never recorded says so, rather than offering a resume that goes nowhere.

**The list of tasks is mostly dead ones.** Tickets only ever moved forward, so
everything ever started stays in the listing and buries the one thing being worked
on. The default listing shows unfinished work; finished, abandoned and archived
tasks are one argument away. Archiving moves a ticket out of every listing without
deleting it — nothing in the harness deletes anything, and a ticket is the only
record of what a directory on disk was for.

**Work you thought of before you could start it.** A task had to be begun to be
recorded at all, so anything not started right now lived in your head. A ticket can
be written down with a description and a branch name and nothing else: no workspace,
no branch, no stage. Starting it later is the ordinary way of starting a task. And a
task dropped or finished can be moved back to active, because deciding to carry on
with something is not a reason to retype what it was about.

### Stages

**Claude writes the code before you have seen the design.** Until the design is
approved, nothing inside a repository is writable except the design documents. Not
an instruction — the write is refused. This is the only hard refusal in the product,
and after approval there are none.

**The tests are written after the code, so they only confirm it.** Writing the
failing tests is its own stage, and it ends with the user looking at the failure.

**Nobody reviews the design, and code review comes too late.** The design is
reviewed twice before implementation — once by codex, once by the user — and the
code again afterwards. Wrong designs are cheapest to fix while they are still a
document.

**The procedure dissolves over a long task.** The current stage is held by the
plugin, not by Claude's memory of it. Claude can ask to advance; the plugin checks
the stage produced something, and asks the user at the three stages that need them.

## What it deliberately does not do

- **Make Claude faster.** It is slower at the front, on purpose.
- **Decide what to build.** It governs how, never what.
- **Defend against a model deliberately working around it.** The harness keeps an
  honest process honest; that is the whole claim, and stating it prevents a false
  sense of a guarantee the design cannot provide.
- **Ship a reviewer, a test runner, or language support.** Codex is named in config
  and invoked, or switched off.
- **Manage CI, deployment, releases, or issue trackers.** A backlog entry is a
  description and a branch name — no assignee, no priority, no labels, no board, and
  nothing shared between people or projects.
- **Delete anything.** Cleanup is archiving. Workspaces stay on disk until you
  remove them yourself.
- **Own your instruction files.** It reads and complements them.
- **Reorganise your repositories, rewrite history, stash your work, or delete a
  workspace.**

## Principles

- **Discover, never assume.** Repository, base branch, and project facts are
  resolved at runtime or asked once. The plugin hardcodes none of them.
- **The stages are the product.** Anything that makes a stage easier to skip is an
  anti-feature.
- **The design and the tests are the contract.** Implementation obeys them; when
  they look wrong, the user decides.
- **Inert by default.** In a project that has not adopted it, and in any session
  with no active task, the plugin refuses nothing and says nothing.
- **One refusal.** Enforcement is a fence around the one thing worth fencing —
  writing code before the design is agreed — and nothing else.
- **What a program cannot judge, and a model should not be trusted to, becomes a
  sentence on a stage the user is already stopping at.**
- **No unverified claims.** Third-party behaviour is taken from official
  documentation, and anything unverified is labelled as such.

## Success criteria

- A first-time user adopts a project and reaches an approved design without editing
  a configuration file by hand.
- In a task run end to end, no source file exists before the design was approved —
  verifiable from the branch's history.
- The base-branch checkout is byte-identical before and after an abandoned task.
- A second task runs while the first is unfinished, with no interference.
- A project that has never adopted the harness sees no blocked tool call and no
  injected instruction while the plugin is installed.
- A task from weeks ago is found by describing it, and resumed from its ticket.
