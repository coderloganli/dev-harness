// The ten stages of a dev-harness task.
//
// `needsUser` marks the stages that end in a dialog the user answers; every other
// stage ends when Claude asks to advance and the server agrees the stage produced
// something. `requires` is the formality check run before leaving the stage — it
// asks whether the work happened, never whether it was any good. `authorises` marks
// the one stage whose acceptance also authorises sending the work out.
//
// A `dialog` is written for a reader who can see nothing else. The terminal cannot
// be scrolled while one is open, so whatever was on screen a moment earlier is out
// of reach until it is answered; a message that says only "Accept it?" asks for a
// decision from information the user cannot look at. Each one therefore names what
// is being approved and what accepting causes. See
// `docs/adr/0008-a-dialog-says-what-accepting-does.md`.

/**
 * The repositories a task touches, as a phrase that fits inside a sentence.
 *
 * A ticket is created at stage 1 and its repositories are settled at stage 2, so a
 * dialog can be reached with none recorded. That case gets a sentence rather than a
 * count of nothing.
 */
export function repoPhrase(t) {
  const repos = t.repos ?? [];
  if (!repos.length) return 'the repositories this task touches';
  return `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} (${repos.join(', ')})`;
}

export const STAGES = [
  {
    n: 1,
    key: 'new-task',
    title: 'New task',
    intent: 'Create the workspace, the ticket, and the task document.',
    requires: 'taskDocExists',
  },
  {
    n: 2,
    key: 'interview',
    title: 'Requirements interview',
    intent:
      'Read the top-level documents and the decision records, interview the user, ' +
      'write the requirement into task.md, settle which repositories are involved.',
    requires: 'requirementAndRepos',
  },
  {
    n: 3,
    key: 'design',
    title: 'Design',
    intent:
      'Write the design and the test cases into task.md. Write a decision record ' +
      'for every decision as it is made. Update the top-level documents if this ' +
      'design changes what they say.',
    requires: 'designAndTestCases',
  },
  {
    n: 4,
    key: 'codex-design',
    title: 'Codex reviews the design',
    intent: 'Run codex against the design section, address the findings, revise.',
    requires: 'codexDesignVerdict',
    skippableWhenNoCodex: true,
  },
  {
    n: 5,
    key: 'user-design',
    title: 'User reviews the design',
    intent: 'Present the design and ask the user to approve it.',
    needsUser: true,
    dialog: (t) =>
      `Stage 5 — approve the design for ${t.branch}?\n` +
      `Accepting unlocks writing code in ${repoPhrase(t)}: the failing tests come next.\n` +
      'Decline to send the design back for changes.',
    declineTo: 3,
  },
  {
    n: 6,
    key: 'failing-tests',
    title: 'Failing tests',
    intent:
      'Implement exactly the test cases from task.md and nothing else. Run them. ' +
      'Show the user the failures and which test case each came from.',
    needsUser: true,
    requires: 'testsRanAndFailed',
    dialog: (t) =>
      `Stage 6 — approve the failing tests for ${t.branch}?\n` +
      'They ran and failed as intended. Accepting moves on to writing the code that makes\n' +
      'them pass. Decline to keep working on the tests.',
    declineTo: 6,
  },
  {
    n: 7,
    key: 'implementation',
    title: 'Implementation',
    intent: 'Write the code until the whole suite is green, including tests that already existed.',
    requires: 'suiteGreen',
  },
  {
    n: 8,
    key: 'codex-code',
    title: 'Codex reviews the code',
    intent: 'Run codex against the diff with task.md as the reference, triage every finding.',
    requires: 'codexCodeVerdict',
    skippableWhenNoCodex: true,
  },
  {
    n: 9,
    key: 'acceptance',
    title: 'User acceptance',
    intent:
      "Follow the project's try value to hand the user something they can exercise " +
      'themselves — a command, a URL, an input to try.',
    needsUser: true,
    // The one acceptance. It approves the work and authorises sending it out, so the
    // message says so — a second dialog at stage 10 asking the same thing about the
    // same work made the acceptance weaker, not stronger. See
    // `docs/adr/0007-one-acceptance-authorises-the-pull-request.md`.
    authorises: true,
    dialog: (t) =>
      `Stage 9 — accept ${t.branch}?\n` +
      'You have run it yourself. This is the only approval asked for: accepting commits,\n' +
      `pushes, and opens a pull request in ${repoPhrase(t)}.\n` +
      'Decline to send it back for changes.',
    // Declining here is ambiguous: acceptance can fail because the implementation
    // is wrong or because the design was. Claude asks which and returns to 7 or 3.
    declineTo: 'ask',
  },
  {
    n: 10,
    key: 'pull-request',
    title: 'Pull request',
    intent: 'Commit in each repository, push the branch, open a pull request per repository.',
    // No dialog: reaching this stage means stage 9 was accepted, which is the
    // authorisation. A stage with work in it and no question.
  },
];

export const LAST_STAGE = STAGES.length;

export function stage(n) {
  return STAGES.find((s) => s.n === n) ?? null;
}

export function describe(n) {
  // Stage 0 is a ticket written down before any work began. It is not at a stage of
  // the procedure, so `stage(0)` finds nothing and it is named rather than numbered.
  if (n === 0) return 'backlog';
  const s = stage(n);
  return s ? `stage ${s.n} of ${LAST_STAGE} — ${s.title}` : `stage ${n}`;
}
