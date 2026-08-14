# The decision-record directory carries a README rather than a .gitkeep

summary: init writes docs/adr/README.md so the directory survives a commit, and find_adr skips it

## Context

`init` created `docs/adr/` as an empty directory. Git does not track empty
directories, so it disappeared the moment anything was committed, and the next task
would find no decision-record directory at all.

The usual remedy is an empty `.gitkeep`, which keeps the directory and says nothing.

## Decision

`init` writes `docs/adr/README.md` from a template: what a decision record is here,
one decision per file, the file naming, and the instruction to search rather than
browse. `find_adr` excludes `README.md` from its results.

## Reasoning

The directory needs a file either way, so the file may as well be the one a person
opens when they wonder what the directory is for. A `.gitkeep` solves the git
problem and leaves the human problem.

The exclusion in `find_adr` is not incidental. Without it the README matches almost
every query — it contains the words the search is made of — and the first result of
every search would be the one file that holds no decision.
