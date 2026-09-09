---
name: anchor
description: Prepare a focused continuation brief and a ready-to-run /compact command for one specified subject. Use only when the user explicitly invokes /anchor before continuing the same task after compaction.
argument-hint: "[subject, desired outcome, and next step]"
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - Read
  - Grep
  - Glob
  - Bash(git status --short)
  - Bash(git branch --show-current)
  - Bash(git log -1 *)
  - Bash(gh pr view *)
  - Bash(gh issue view *)
---

# anchor

Two rules first, because compaction re-attaches this body newest-first under a
5,000-token cap and everything below them is elaboration.

1. **Never default an omitted scope.** If the argument does not give you all
   three of subject, desired outcome and resume point, ask once and stop. Do not
   inspect the repository, infer the most recent topic, prepare a partial anchor,
   or print a `/compact` command.
2. **You cannot run `/compact`.** A skill cannot trigger a built-in command. Print
   the exact command, stop, and never say or imply that compaction happened.

This is continuation inside the same session. It is not a durable archive and not
a handoff to a new session — `/handoff` and `/continuum` own those.

## Invocation

```text
/anchor <subject, desired outcome, and next step>
```

Sufficient only when all three are identifiable without guessing:

1. **Subject boundary** — the task, artifact, defect, decision or subsystem to preserve.
2. **Desired outcome** — what "done" means for the continued work.
3. **Resume point** — the first action or decision expected after compaction.

"this", "the PR" or "the current task" qualify only when the conversation holds
one unambiguous referent *and* already establishes the outcome and the resume
point.

### Clarification gate

Empty, vague, internally inconsistent, or missing any of the three → ask and stop.
Prefer one question that collects everything missing:

> What exact subject should survive compaction, what outcome are we continuing
> toward, and what should Claude do first afterward?

Use `AskUserQuestion` when there are a few well-supported readings; otherwise ask
in chat. Ask again if the answer is still insufficient. The skill stays active, so
the user does not re-invoke it after answering.

## Workflow

### 1. Confirm the boundary

Restate the subject to yourself in one sentence. Include the subject and its direct
dependencies, nothing else. If the user is actually switching to unrelated work,
say `/clear` is the right command and stop — unless they explicitly want the
connection between the two tasks preserved.

### 2. Gather only missing evidence

Facts already established in the conversation come first. Inspect local state only
when the scope names a repository artifact whose current state is missing or
uncertain **and** that uncertainty would change the brief.

Allowed: current branch, concise working-tree status, the named PR or issue,
changed file names, the latest relevant test result. Not allowed as brief-padding:
re-reading files already represented accurately, opening large files, collecting
whole diffs, re-running broad suites, fetching general documentation, or exploring
unrelated history. State unresolved uncertainty rather than resolving it
speculatively.

Neither `git` nor `gh` is a hard dependency. When one is unavailable, use the
established session facts and preserve the uncertainty; do not fail the workflow.

### 3. Build the continuation brief

```text
Objective:
<one concrete outcome>

Relevant state:
- <branch/PR/issue and implementation status, only when applicable>
- <files, components, or code paths that matter>

Confirmed facts and decisions:
- <fact or decision with enough evidence to trust after compaction>

Open questions and blockers:
- <unresolved item, risk, or explicit assumption; "none known" is allowed>

Resume with:
1. <first concrete action>
2. <next action, only if it materially helps>
3. Run: <specific verification command, when known>
```

Target 400–700 tokens; hard cap 1,000. Omit empty optional detail instead of
padding. Preserve exact error text only when its wording is diagnostically
important — otherwise record the command, exit status and conclusion. Refer to
files and symbols by path and name rather than embedding code.

The brief must distinguish completed from planned work, observed facts from
inference, accepted decisions from rejected or superseded ones, and uncommitted
changes from committed or merged state. **Never imply that unfinished work was
finished.**

Do not restate what Claude Code re-injects on its own: project-root `CLAUDE.md`,
unscoped rules and auto memory all come back after compaction. Include a
task-specific exception or decision only if it is not recorded there. Nested
`CLAUDE.md` files and path-scoped rules do *not* return until a matching file is
read again — when one matters, preserve its path and instruct the resumed agent to
reload it rather than copying the file. Name any other skill that must be
re-invoked instead of reproducing its body.

### 4. Remove what should not survive

The compact instructions must explicitly minimize unrelated conversation and side
questions; superseded approaches and repeated corrections; raw command output, full
diffs and file bodies already summarized; generic repo instructions Claude Code
re-injects; and tool schemas or skill prose that can be reloaded on demand.

### 5. Print the command and stop

One short instruction, then one fenced block:

````text
Submit this as your next message to compact the current session:

```text
/compact Anchor the next context on this continuation brief. Preserve the facts and distinctions below; remove unrelated or superseded material. Treat "Resume with" as the active next work, and do not assume unfinished work was completed.

<continuation brief>
```
````

`/compact` must be the first text inside the block — Claude Code recognizes
commands only at the start of a message. Add no alternatives, offer nothing
further, begin no next step, and report no success. The only terminal state here is
that the command is ready; compaction is complete only once the user submits it.

## Failure behavior

- **Missing or insufficient scope** — clarify; no command.
- **Ambiguous repository state** — preserve the ambiguity and name the cheapest next check. Never invent a branch, PR, test result or completion state.
- **Referenced artifact unavailable** — say what could not be inspected; ask for it only when the brief cannot be trustworthy without it.
- **Near-full context** — stick to established facts and print promptly. Do not spend the remainder on discovery.
- **Unrelated next task** — recommend `/clear`; do not manufacture continuity.

## Never

Write a file, memory or transcript export. Call another skill, hook, MCP server or
repo-local helper. Run a mutating command, a broad test suite, or anything
producing unbounded log or diff output. Change settings. Start the work. Claim the
session was compacted.
