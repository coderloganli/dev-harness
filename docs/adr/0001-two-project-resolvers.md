# Finding the project is done twice, deliberately

summary: hooks and the server resolve the project mechanically; init resolves it with judgement, and the two must not be merged

## Context

Two parts of the harness need to answer "which project is this?" and they run in
places that could not be more different.

`findProject()` in `lib/store.mjs` runs inside a hook process and inside the MCP
server. There is no model there and no user to ask. It gets a directory and must
return an answer or nothing, deterministically, in milliseconds, on every file
write.

The `init` skill runs as text in Claude's context, with the user present. It is
adopting a project that does not exist yet, so the marks it looks for are partly
absent by definition.

The init skill was originally written as an algorithm — walk up looking for `main/`
and `tickets/` — which made it fail the first time it was used: the session's
directory was the project's parent, and walking up never looks down.

## Decision

Two resolvers, and they stay separate.

`findProject()` keeps its mechanical walk up and does not change. The init skill
loses its algorithm and states the intent instead: find the project the user means,
look around rather than only up, and ask when there is more than one candidate.

## Reasoning

The failure was a category error, not a bug. Locating the project a person means is
judgement — the marks are ambiguous, the directory they started in is a hint rather
than an answer, and the right move when unsure is to ask. Written as a procedure it
could only ever handle the cases the author thought of.

Enforcement is the opposite. It must never ask, never guess, and never vary; a
refusal that depended on judgement would be a refusal that sometimes fires and
sometimes does not.

Merging them would break one or the other: give the hooks judgement and they become
unpredictable; give init an algorithm and it fails on the first unanticipated
layout, which is exactly what happened.
