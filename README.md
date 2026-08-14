# Claude Code Harness

A harness for Claude Code: it makes Claude build software the way a careful engineer
does — read the design first, agree it before writing code, write the failing test
before the feature, work in a scratch space that cannot damage anything, and keep
the documentation true.

Installed as a plugin, it answers to `harness`: `/harness:task`, `/harness:status`.

It governs three things, and they are independent of each other:

- **Documents** — a short top-level design, a searchable record of decisions, and a
  throwaway document per task.
- **Workspace** — one per task, isolated, findable again weeks later.
- **Stages** — ten of them, four ending in a dialog you answer.

> **Status: early.** The harness has been through one real task — its own, fixing
> five defects that its first run exposed — and the ten stages, the refusal and the
> approval dialogs all held. There is no marketplace entry yet.

## Why

Claude Code produces good work when it knows the design, cannot run ahead of you,
and cannot damage anything while trying. Most people rebuild some version of those
three conditions by hand in every project — a CLAUDE.md, a habit of asking for a
plan, a manual `git worktree add` — and drop them under time pressure, which is
exactly when they were doing the most work.

The harness makes them a property of the tool instead of a property of your
willpower.

## The ten stages

| # | Stage | Ends when |
| :-- | :-- | :-- |
| 1 | New task | The workspace, ticket, and task document exist |
| 2 | Requirements interview | The requirement is written and the repositories are settled |
| 3 | Design | The design and test cases are written; decisions are recorded |
| 4 | Codex reviews the design | Findings addressed — skipped if you have no codex |
| 5 | **You review the design** | You approve it |
| 6 | **Failing tests** | The tests exist, run, fail, and you have seen the failure |
| 7 | Implementation | The suite is green |
| 8 | Codex reviews the code | Findings addressed — skipped if you have no codex |
| 9 | **You accept it** | You have run it yourself |
| 10 | **Pull request** | The PR is open |

Claude can ask to move on. It cannot move on: the stage is held by the plugin, and
advancing is refused unless the stage actually produced something. The stages in
bold end with a dialog whose wording the plugin owns — Claude cannot phrase the
question you are asked, and your answer never passes through it.

## The one refusal

Until you approve the design at stage 5, **nothing inside a repository is
writable** except:

```
docs/architecture.md
docs/product.md
docs/adr/
```

The task document lives outside every repository, so it stays writable too. While
the design is unsettled, the only cheap thing to do is work on the design.

After stage 5, nothing is refused for the rest of the task.

## Layout

A project is a directory. `main/` holds the base branch; each task gets a sibling
workspace named after its branch, with a git worktree per repository it touches.

```
notes/
  main/                  the base-branch workspace
    api/                 main checkout
    web/                 main checkout
  add-note-search/       a task workspace
    task.md              this task's document — outside every repository
    api/                 worktree on add-note-search
    web/                 worktree on add-note-search
  tickets/
  config.json
```

One task, one branch, however many repositories. Your main checkouts are never
written to while a task is running, and abandoning a task means leaving a directory
alone.

## Documents

| | Where | Lives for |
| :-- | :-- | :-- |
| Architecture | `docs/architecture.md` in each repository | The project |
| Product design | `docs/product.md` | The project |
| Decisions | `docs/adr/` in the repository they concern | The project |
| The task | `task.md` at the workspace root | The task |

The two top-level documents are held to about 200 lines each. The limit is the
feature: they are read in full by every task, and a document too long to read in one
sitting stops being read.

Decision records are searched, not browsed — `find_adr` returns the few that bear on
the question. They are written during the design stage as decisions are made, and
edited in place when a decision changes.

## Finding your way back

Every task has a local ticket holding its description, its workspace, and the Claude
session it was worked in. Weeks later, ask for "that task about search ranking" and
`find_ticket` hands back the directory to return to, and the session to resume when
one was recorded — a task whose session was not says so, rather than offering a
resume that goes nowhere.

## Getting started

```
/harness:init       once per project
/harness:task       start a task, or resume the one you are standing in
/harness:status     where the current task stands
/harness:tickets    find an earlier task, and get back its workspace and session
```

`init` creates `tickets/`, writes the document skeletons that are missing, and asks
for the three things it cannot discover: how your suite is run, how to try a change, and
whether codex is available. It moves nothing and clones nothing.

## What it will not do

- Make Claude faster. It is slower at the front, on purpose.
- Decide what to build. It governs how, never what.
- Defend against a model deliberately working around it. It keeps an honest process
  honest; that is the whole claim.
- Ship a reviewer, a test runner, or language support. Codex is named in config and
  invoked, or switched off.
- Rewrite your history, stash your work, delete a workspace, or reorganise your
  repositories.

## Documentation

- [Product design](docs/product.md) — the problems it solves, and what it will not do
- [Architecture](docs/architecture.md) — how it is built and why

## License

MIT
