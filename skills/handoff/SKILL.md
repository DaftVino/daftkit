---
name: handoff
description: Write a session handoff before a planned /clear or at the end of a phase — branch, plan step, next actions, and the files-to-read manifest the next session needs. Use when the user says "handoff", "wrap up", "I'm going to clear", or when a phase is complete.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
---

# handoff

Phase exit, made cheap and repeatable. `/orient` makes entry cheap; this makes
exit clean. Together they are what the ≤150k rule depends on
(`engineering-standards/claude-md-global.md`, "Context budgets").

## 1. Establish where the note goes

The handoff note is **appended to the plan document's `## Handoff log`** —
`docs/designs/YYYY-MM-DD-slug.md`. It is never a new file, never `todo.md`,
never a stray note (repo-standards §6.4).

If the work has no plan document because it did not need one, say so and write
the state into the PR description instead. Do not create a design doc purely to
hold a handoff.

## 2. Write the note

One `###` entry, dated, covering exactly this:

- **Branch and what merged** — commit SHAs for anything squash-merged, and the
  PR number.
- **What shipped** — files created or modified, and the test count before and
  after.
- **What the plan got wrong** — anything corrected during execution, each
  marked **do not revert** with the reason. This is the highest-value line in
  the note: it is what stops the next session re-introducing a fixed bug
  because the plan still says the old thing.
- **What was discovered** — anything empirical the next session needs, with the
  evidence. Tool versions, API behaviour, exit codes.
- **What is still open** — and specifically whether it needs a human, with
  what blocks it.
- **Next phase** — its name, and its files-to-read manifest with sizes.

Be specific enough that a session with no memory of this one can act on it.
"Fixed some issues" is a wasted line; "`node --test tests/` fails on Node 22
because positional args became glob patterns — the script is now bare
`node --test`, do not revert" is the whole point.

## 3. Save the working context

Run gstack `/context-save` to capture the live session state. This is
complementary, not redundant: the handoff note is durable and committed and
survives into the repo's history; the context save is a machine-restorable
snapshot for the very next session. Write the note first — if the session dies
mid-save, the committed note is what survives.

## 4. Commit

```
git add docs/designs/<the plan doc>
git commit -m "docs: record the <phase> handoff note"
```

Commit it even if nothing else is ready to commit. An uncommitted handoff note
is not a handoff.

## 5. Report

Print the next session's first command and its read manifest, so resuming is a
copy-paste rather than a rediscovery. Then stop — do not start the next phase.
