---
name: continuum
description: Hand the current chat off and write the prompt that forces the next one's first moves — a read manifest with sizes, the branch it must not get wrong, and the constraints it must not revert, refused by a validator before it is written. Use when the user says "/continuum", "handoff and start a fresh chat", "I'm going to clear", "write the prompt for the next session", "next session prompt", or "pick up the next task".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
---

# continuum

Every session that ends in a `/clear` ends the same way: *"hand off, and write the
prompt for a fresh chat to pick up the next task."* The first half is `/handoff`.
The second half is this.

**This skill owns one thing:** the prompt the next chat is pasted, and the gate
that refuses it. The exit note is `/handoff`'s, delegated whole in §1 and never
restated here — it specifies that better than this file would.

The failure it exists to stop is not a missing note. It is a fresh session that
reads a note, branches from `main`, and loses the plan — because the prompt said
where to go and nobody checked it against where the work actually was.

## 1. Hand off first

Invoke `/handoff` via the Skill tool. Unchanged, whole, and before anything else.

- It **stops early** — no plan document, so it routes the state elsewhere: carry
  on. The prompt does not depend on the note existing.
- It **fails in a way it could not work around**: stop, and say so. This is not
  `CONTINUUM_BLOCKED_VALIDATION` — nothing was validated — so report that
  `/handoff` failed and generate nothing. A prompt pointing at a note nobody
  wrote is worse than no prompt.
- The note for this transition is **already written and committed** — you wrote it
  by hand, or a prior step did: `/handoff`'s work is done. Say so and move to §2.
  Do not invoke it to append a second entry. One transition is one record, and a
  log carrying two entries for it tells the next session the phase happened twice.
- Its **invocation** fails: retry once. A prompt-validation failure later never
  re-runs it — the note is already durable, and writing it twice writes the same
  record twice.

Check the last case before you invoke, not after: read the plan document's log and
see whether the top entry already covers the phase you are leaving.

## 2. Refresh the code map if it is stale

The manifest you are about to write cites line anchors. A stale anchor sends the
next chat to the wrong line, which is worse than sending it nowhere.

```
git log -1 --format=%h -- '*.js' '*.mjs' '*.cjs' '*.gs' '*.ts' '*.tsx' '*.jsx' '*.html'
```

Compare that to the commit `docs/code-map.md`'s own header names. Different →
invoke `/code-map` before generating. **Never compare against `HEAD`**: a map
cannot name the commit that adds it, so a `HEAD` comparison calls every freshly
committed map stale. No code map in the repo → skip, silently.

**Commit the map before moving on.** Regenerating it dirties the tree, and §3
gives you two choices for a dirty path: clean it, or disclose it. Disclosing your
own side effect as a risk to the next session is not a disclosure, it is noise.

## 3. Account for anything left uncommitted

```
git status --porcelain
```

Empty, or every remaining path is named in `## Unknowns and risks` with the
reason it was left. This one is on you: the validator is not handed the git
status, so it checks only that the section is non-empty. Stated here so the gap
is known rather than assumed closed.

## 4. Select what goes in the prompt

The validator polices structure. These criteria decide content, and they are
criteria rather than an algorithm on purpose — a generator computing the manifest
from git reachability cannot know which correction is binding, which test
constrains the work, or which precedent carries meaning.

**`## Read first` — four roles, each at most once, none padded.**

| Role | What it is |
|---|---|
| Phase contract | The plan or design doc for the phase, with its log and any binding corrections |
| Dependency | A shared surface the next phase will call, modify or conform to |
| Constraint | An existing test or checker that already binds the work |
| Precedent | An established pattern to imitate |

The phase contract is **always** entry 1. Omit a role that does not exist rather
than inventing one — a first phase of a new plan legitimately has only its
contract, and the floor is one entry for exactly that reason. Cap at six. Any
file over **32,768 bytes** appears only as a slice or anchor instruction, never
as a whole-file read. Every entry carries a path, a size and a one-sentence
reason.

**`## Constraints`** — only what can change an implementation choice in *this*
phase: binding corrections inherited from a prior phase, repo rules that would
fail review, and decisions already made. Not general good practice. The validator
does not inspect this section's body; a panel ruled on 2026-07-26 that a rule
requiring one bullet would be a scope increase past a ratified rule set, and that
selecting the right bullets is yours, not the gate's. It is the section most
likely to be quietly worthless, so write it last, when you know what the next
phase could get wrong.

**`## Exit criteria`** — two to seven observable conditions, at least one an
executable command written out in full: `npm test`, not a bare `make`, which the
gate reads as one word rather than something to run. A fenced block counts too.
Each uses a checkable verb: exists, contains, passes, committed, recorded.
"Clean" and "robust" are not exit criteria.

**`## Unknowns and risks`** — unresolved decisions, environmental uncertainty,
likely regressions, uncommitted paths from §3, and anything needing the owner.
Plain prose, no required prefixes: a prefix makes a risk prefixed, not
actionable.

## 5. The shape it must take

Six `##` headings, this order, nothing renamed:

`Start here`, `Read first`, `Branch`, `Constraints`, `Exit criteria`,
`Unknowns and risks`.

```markdown
# Next session — paste this into a fresh chat

> Delete this file once <phase> is underway; it is a launch pad, not a document.

## Start here

Run `/orient` before anything else, including clarifying questions. Then <one
line naming the task>.

## Read first

Read nothing else until you have these, in order:

1. `path/to/contract.md` (11.7K) — why it matters
2. `path/to/other.mjs` (0.7K) — why it matters

## Branch

`<current branch>` — <what is on it>. <Where to branch from, and where not to.>

## Constraints

- <do-not-revert item, with the reason>
- <repo constraint that fails review>

## Exit criteria

- `npm test` green (suite is at <N> now)

## Unknowns and risks

- <ambiguity, missing input, or thing needing the owner>
```

`<N>` comes from `node --test --test-reporter=tap 2>&1 | grep -E '^# pass ' | awk '{print $3}'`.
The default reporter prints a non-ASCII glyph that `grep '^# pass'` will not
match. Omit the parenthetical when the phase changes no code.

Optional, and only in the `daftplate` repo: `tests/fixtures/next-session-prompt.exemplar.md`
there is a real prompt that validates clean, worth reading before your first one.
It ships with that repo, not with this skill, so anywhere else the path holds
whatever that repo happens to have — do not go looking.

## 6. Validate before writing

**An invalid prompt never reaches disk.** Assemble the context from real state —
the validator makes no git call of its own:

```
git branch --show-current
git branch --format='%(refname:short)'
```

Then call `validate(promptText, context)` from
`<skill-dir>/scripts/validate-prompt.mjs`, passing
`{ branch, head, branches, phaseContractPath }`. `branch` is `null` on a detached
HEAD or an unborn branch; pass the short SHA as `head` and the prompt must name
*that* instead. Neither case is refused — both are unusual enough that the next
chat has to be told.

Every rule it can report, and what fixes it:

| Rule | Fix |
|---|---|
| `missing-section` | Add the heading. All six are required |
| `section-duplicate` | A reserved heading appears twice; merge them |
| `section-order` | Reorder to the six above |
| `orient-not-first` | `## Start here` must be the first H2 and must say `/orient` |
| `manifest-empty` | `## Read first` needs a numbered entry; a bulleted read is prose |
| `manifest-contract-first` | Entry 1 must be the phase contract's real path |
| `manifest-duplicate` | Two entries name the same file |
| `manifest-overflow` | More than six entries; cut to the ones that bind |
| `manifest-unsliced` | An entry over 32,768 bytes must say to read it in slices, or from anchors |
| `manifest-unsized` | Add `(11.7K)`, or the literal `(new file)` |
| `branch-unnamed` | Backtick the branch in `## Branch` |
| `branch-mismatch` | Name the branch actually checked out. No escape hatch — naming where the work sits is never wrong |
| `branch-unknown` | A backticked ref in `## Branch` the repo does not have. Three causes: a real typo; a create line the vocabulary missed, so widen it, never weaken the rule; or a backticked filename or tag — `` `package.json` ``, `` `v1.2.0` `` — which the section reads as a branch. Unbacktick it, or move it out of `## Branch` |
| `exit-uncheckable` | `## Exit criteria` needs a command with an argument — `` `npm test` ``, not `` `make` `` — or a fenced block. A single token is a name, not something to run |
| `unknowns-empty` | Type `- none` deliberately. An empty section is not a claim of safety |

Or from a shell:

```
node "<skill-dir>/scripts/validate-prompt.mjs" <prompt-path> --branch <name> --branches <a,b,c>
```

Exit 0 clean, 1 on violations, 2 on a usage error. `--branch` is required —
without it `branch-mismatch` would stand down and the wrong branch would print
`clean`. Without `--branches` only `branch-unknown` stands down.

The shell path also passes no phase contract and no `head`, so
`manifest-contract-first` never fires there and a detached HEAD goes uncompared.
Both are reachable through `validate()` alone; the CLI takes no flag for either.
Use it to spot-check a prompt, not to certify one.

**On failure, regenerate once**, feeding back the complete violation list. One
repair, two drafts. A second repair masks a repeatable generation defect and
spends a model call while the owner is waiting to clear.

## 7. Three terminal states, and only three

1. Still invalid after the one repair → **`CONTINUUM_BLOCKED_VALIDATION`**. Write
   nothing, commit nothing. Print every violation and the last candidate in chat
   for manual repair.
2. Valid → write `docs/designs/next-session-prompt.md`, print it verbatim in
   chat, and attempt the commit **once**. The commit fails →
   **`CONTINUUM_UNCOMMITTED`**. Never retry, amend, reset, stash, switch branches
   or delete anything. The prompt is valid, on disk and already printed, so
   calling this blocked would misstate it — and calling it success would hide
   that a `/clear` plus a branch switch loses the file.
3. Committed → **`CONTINUUM_COMMITTED`**.

Print the prompt verbatim either way it succeeds. The transition is meant to be
a copy-paste, not a re-read.

## 8. What the gate does not do

It checks structure and the facts it can compare against real state: six
sections, a path with a size, a command, and the branch measured against git
rather than taken on trust.

It does not rule on whether your constraints are the binding ones or your risks
are the real ones. Those are judgements. A validator that certified them would be
doing the thing `/crit` was built to stop — and a prompt that passes every rule
can still be useless, which is why §4 is the part that actually takes thought.
