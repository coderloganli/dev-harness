---
summary: a dialog message carries its own context, because the terminal cannot be scrolled while it is open
---

# A dialog says what accepting does

## Context

While an elicitation dialog is open in the Claude Code CLI, the terminal cannot be
scrolled. Only the current screen is visible, and whatever Claude presented just
before the dialog — the design, the failing tests, the thing to try — is out of
reach until the dialog is answered.

The dialogs were written on the opposite assumption. "Stage 9 — you have run
single-acceptance-dialog yourself. Accept it?" is a pointer to a conversation the
user is, at that moment, unable to look at.

The plugin cannot fix the scrolling. Verified against the MCP specification
(2025-06-18, `client/elicitation`): `elicitation/create` carries exactly two params,
`message` and `requestedSchema`, and the specification states that implementations
are free to expose elicitation through any interface pattern and that the protocol
mandates no user interaction model. How the dialog is drawn and what keys it honours
belong to the client. That is a Claude Code issue, and it is reported there.

## Decision

Every dialog message states what is being approved and what accepting causes, in
enough detail to decide without scrolling. Stage 9, the one that sends work out,
names the branch, names the repositories it will touch, and says that accepting
commits, pushes and opens pull requests.

A message is written for the reader who can see nothing else. It says the concrete
consequence — "commits, pushes, and opens a pull request in 2 repositories (api,
web)" — rather than the stage's name, because the stage's name is only meaningful to
someone who can still see the procedure.

Values that may be absent are treated as absent. A ticket whose repositories are not
settled still produces a readable sentence.

## Reasoning

This is a mitigation, not a fix, and saying so keeps it from being mistaken for one.
The scrolling is the real defect and it is upstream; what is in reach here is
removing the need to scroll at the one moment scrolling is impossible.

It also holds without the defect. A dialog whose wording the plugin owns is the
harness's only direct sentence to the user — the one piece of text in the procedure
that Claude cannot phrase. Spending it on a question the user cannot answer from
what is in front of them wastes the one channel that is guaranteed honest.

The cost is a longer dialog. That is the right direction: the failure this design
protects against is a user accepting something they could not see, and the failure
it risks is a user reading two extra lines.
