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

## 4. Name what this session filed, if the board is Linear

`repo-standards` §6.5.1 gives every issue 24 hours to be dressed in Linear —
project, priority, blocking relations — and marks that clause as convention, so
nothing prompts it and nothing checks it. Measured 2026-08-24: seven issues filed
in one session reached Linear inside two minutes and arrived with no project and
no priority. This step is the prompt that was missing. It is not a check, and it
never blocks.

**Detect the variant from `ROADMAP.md`, and from nowhere else.**

```
grep -n '^Board:' ROADMAP.md
```

`check-roadmap.mjs` fails any repo where more than one `Board:` line survives, so
the one that does is that repo's single declaration of which §6.5 variant it is
on. That is why this reads the roadmap rather than `CLAUDE.md` prose, which
nothing constrains, or an ADR, which records the decision but not its current
state.

- The surviving line names **Linear** → continue.
- It names **GitHub Projects**, or there is **no `ROADMAP.md`** → skip the whole
  step in silence, the way §2 skips a repo with no code map. Most repos are on
  the default variant, and a repo without a roadmap is either pre-template or on
  an `optional` profile. Neither is a finding, so do not report that the step was
  skipped.

**List what this session filed:**

```
gh issue list --state all --search "created:>=<session-start> author:@me" \
  --json number,title --limit 30
```

`<session-start>` is an ISO timestamp — `2026-08-25T12:00:00Z` — not a bare date.
A bare date returns everything filed since midnight, so on the second session of
one day it names issues the first session already dressed. `gh` missing,
unauthenticated, or the repo has no remote → skip, silently, for the same reason
a missing roadmap does.

**An empty result prints nothing.** Not "none found". A session that filed no
issues has no debt, and a line announcing that costs the next session a read to
learn nothing.

**Each issue goes into `## Unknowns and risks` by number and title, stating that
dressing was not verified from here.** Use this wording, or wording that makes
the same claim:

- Filed this session; dressing not verified from here — `<short>-168` *(title)*,
  `<short>-169` *(title)*. If `/handoff` did not already, run `/dress 168 169`;
  it sets project and priority and reads them back (§6.5.1).

The distinction is the whole point of the step. This skill has no Linear access,
so it cannot know whether an issue is already dressed, and a line reading *these
need dressing* about an issue somebody dressed ten minutes ago is a false claim
the next session will act on. What is true whatever the board says is that these
issues were filed here and this skill could not check them.

Two things follow from having no board access, and both are deliberate:

- **It reports; it never dresses.** `allowed-tools` grants no MCP tool and gains
  none. The call exists and works — that is not the constraint. The constraint is
  distribution: this skill ships to repos with no Linear workspace, no such team,
  and in most cases no Linear at all, and one workspace's server name has no
  business in it. Anyone revisiting that is arguing about distribution, not about
  whether the API can do it.
- **`gh` gives the GitHub number, and that is all the name needs.** Under §6.5.1
  (ADR 0014) an issue on this variant is written `<short>-<N>` wherever a human
  reads it — the `Board:` line's project link text, a hyphen, and the GitHub
  number, as in `daftplate-168`. The Linear key never appears in prose, so there
  is nothing on the board this skill needs to read in order to name an issue.

Nothing found here changes which of §8's three terminal states is reached. An
undressed issue is a fact about the board, not a defect in the prompt, and
refusing to write a valid handoff over an empty board field would trade a real
deliverable for a bookkeeping one.

## 5. Select what goes in the prompt

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
likely regressions, uncommitted paths from §3, board issues from §4, and anything
needing the owner.
Plain prose, no required prefixes: a prefix makes a risk prefixed, not
actionable.

## 6. The shape it must take

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

`<the branch the next session will stand on>` — <what is on it>. <Where to
branch from, and where not to.>

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

## 7. Validate before writing

**An invalid prompt never reaches disk.** Assemble the context from real state —
the validator makes no git call, no `gh` call and no file read of its own. Every
fact it checks arrives from here, and a fact you do not gather is a rule that
does not run:

```
git branch --show-current
git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||'
git branch --format='%(refname:short)'
gh issue list --state open --limit 200 --json number -q '.[].number'
```

The second names the repo's default branch, which is where the next session
starts on a normal handoff. Both are gathered because `branch` is chosen between
them — see below — and neither is simply the answer.

Then, for each path your `## Read first` manifest names, test whether it exists
(`test -e <path>`, or a `Glob`) and collect the ones that do.

Then call `validate(promptText, context)` from
`<skill-dir>/scripts/validate-prompt.mjs`, passing
`{ branch, head, branches, phaseContractPath, openIssues, existingPaths, board }`:

| Key | From | Rule it arms |
|---|---|---|
| `branch` | the branch the next session will stand on — see below, **not** `git branch --show-current` | `branch-mismatch` |
| `head` | `git rev-parse --short HEAD`, only when `branch` is empty | `branch-mismatch` on a detached HEAD |
| `branches` | `git branch --format='%(refname:short)'` | `branch-unknown` |
| `phaseContractPath` | the plan document this phase is executing | `manifest-contract-first` |
| `openIssues` | the `gh issue list` above, as `number[]` | `issue-closed` |
| `existingPaths` | the manifest paths that exist, as `string[]` | `manifest-missing` |
| `board` | `readBoard(<ROADMAP.md text>)` from the same file; `null` when the repo has no `ROADMAP.md` | `issue-bare`, `issue-linear-key`, and `issue-closed` on `<short>-<N>` |

**`branch` is the branch the prompt's *reader* will be standing on, not the one
writing it.** Every other rule here is time-invariant: a manifest entry's size,
a section's order, an issue's state are the same fact at write time and at read
time. `branch-mismatch` is not. The launch pad is written from a feature branch
and read by a fresh session after that branch has merged and been deleted, so
validating it against `git branch --show-current` certifies a line that is true
for one commit and false forever after. That is not a hypothetical: it is how
the prompt on `main` rotted, and it is `#178`.

So pick `branch` by asking where the next session will start:

- **This branch is landing** — the normal handoff. Pass the repo's default
  branch, usually `main`, and let `## Branch` name it and say what to cut from
  it. Durable, because `main` is not deleted.
- **The next session continues on this branch** — a mid-branch clear, nothing
  merging yet. Pass the current branch. It still exists when the file is read,
  so naming it is correct and stays correct.

Nothing is weakened by this. A prompt naming a branch the repo does not have
still fails `branch-unknown` from either standpoint, and a prompt naming no
branch at all still fails `branch-unnamed`. What stops firing is only the
refusal that was wrong — the writer's branch is not where the work will be.

`branch` is `null` on a detached HEAD or an unborn branch; pass the short SHA as
`head` and the prompt must name *that* instead. Neither case is refused — both
are unusual enough that the next chat has to be told.

**When `gh` is absent, unauthenticated, or rate-limited**, the command fails or
prints nothing. Do not pass `[]` — an empty array means *every issue is closed*
and refuses the prompt wholesale. Omit `openIssues` entirely, and **say so in
chat**: "`issue-closed` stood down — `gh` could not list open issues, so no `#N`
in this prompt was checked." A rule that turns itself off in silence is the
defect this section exists to close, so the stand-down is a stated outcome and
never an assumed one. `issue-unpaired` still runs off a Linear board, and
`issue-bare` and `issue-linear-key` on one: they read the prompt's own text and
need no issue state.

The same holds for `existingPaths`. Omit it if you could not test the paths, and
say `manifest-missing` stood down.

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
| `manifest-missing` | A `## Read first` path is not in `context.existingPaths`. An entry marked `(new file)` is exempt — it names something that does not exist yet, on purpose. Stands down entirely when `existingPaths` is absent |
| `branch-unnamed` | Backtick the branch in `## Branch` |
| `branch-mismatch` | Name the branch `context.branch` carries — for a launch pad that is where the *reader* will stand, not where you are writing from (§7). No escape hatch: the rule is right, and passing the writer's branch was the defect |
| `branch-unknown` | A backticked ref in `## Branch` the repo does not have. Three causes: a real typo; a create line the vocabulary missed, so widen it, never weaken the rule; or a backticked filename or tag — `` `package.json` ``, `` `v1.2.0` `` — which the section reads as a branch. Unbacktick it, or move it out of `## Branch` |
| `issue-closed` | A `#N` in the prompt, or under a Linear board a `<short>-<N>`, is not in `context.openIssues`. `owner/repo#N` is exempt — another repo's number is not this repo's. Stands down entirely when `openIssues` is absent |
| `issue-unpaired` | Off a Linear board only: a `FORGE-M` written without its `#N` half, which can be checked against nothing because the two sequences drift. Kept unchanged from before ADR 0014, so a repo not on the Linear variant sees no difference. Write the GitHub number. Never stands down |
| `issue-bare` | Under a Linear board only: a bare `#N`. §6.5.1 (ADR 0014) names this repo's issue `<short>-<N>`, because a bare `#N` resolves against whatever repository the reader is standing in. `owner/repo#N` is exempt. Write `<short>-<N>`. Stands down, and says so, when no board was supplied |
| `issue-linear-key` | Under a Linear board only: any `<TEAM>-<M>`, the old pair included. Under ADR 0014 the Linear key never appears in prose; name the issue `<short>-<N>` by its GitHub number. The team key comes from the `Board:` line, not from this file. Stands down, and says so, when no board was supplied |
| `issue-unqualified` | A `#N` wearing an unslashed prefix — `daftplate#152`, `post-#123`. No §6.5.1 form puts a prefix before a `#` — this repo's issue is `#N`, or `<short>-<N>` on the Linear variant, and another repo's is `owner/repo#N`; the third is ambiguous by construction, so it is checked against nothing and `issue-closed` goes quiet on it. Add the owner, or drop the prefix. Never stands down — the spelling is a property of the prompt's own text |
| `closing-keyword` | A GitHub closing keyword standing next to a literal issue number — `Fixes` immediately followed by `#13`. GitHub's parser ignores code spans, block quotes and negation, so a prompt *warning* that such a footer would be wrong closes the issue the moment the prose is copied into a PR body; it has fired twice in this workspace, once on a deploy blocker. §6.5.1's sanctioned forms: break the token with an explicit `+` between the halves, or name the issue and describe the keyword in words. The one rule here that reads the raw text — a fence exempts nothing, because the parser's behaviour inside one is unmeasured and the copy does not carry the fence. Never stands down |
| `exit-uncheckable` | `## Exit criteria` needs a command with an argument — `` `npm test` ``, not `` `make` `` — or a fenced block. A single token is a name, not something to run |
| `unknowns-empty` | Type `- none` deliberately. An empty section is not a claim of safety |

Or from a shell:

```
node "<skill-dir>/scripts/validate-prompt.mjs" <prompt-path> --branch <name> --branches <a,b,c> --open-issues <n,n,n> --roadmap ROADMAP.md
```

Exit 0 clean, 1 on violations, 2 on a usage error. `--branch` is required —
without it `branch-mismatch` would stand down and the wrong branch would print
`clean`. Spot-checking a committed launch pad takes the same value §7 chooses,
which is usually `--branch main`; passing `$(git branch --show-current)` out of
habit re-creates the false refusal this section exists to prevent.

`--roadmap` passes the board the same way `board` does above. It is a flag, never
a read of the working directory, so the verdict depends only on the arguments;
omit it only when the repo has no `ROADMAP.md`, and the CLI then prints
`stood-down:` for `issue-bare` and `issue-linear-key`. A path it cannot read is
a usage error.

`--branches` and `--open-issues` stay optional, because the CLI must never shell
out to `git` or `gh` itself and a caller may have neither answer. They are not
silent about it: every run prints one `stood-down: <rule> — <why>` line to stderr
per rule it could not arm, so a `clean` on stdout is always read next to the list
of what was not checked. `--open-issues` takes the numbers from the `gh` command
above; omit the flag rather than passing an empty value, which would refuse every
`#N` in the prompt.

`existingPaths` needs no flag — the CLI tests the manifest paths against the
filesystem itself, which is the one boundary it is allowed. It passes no phase
contract and no `head`, so `manifest-contract-first` never fires there and a
detached HEAD goes uncompared. Both are reachable through `validate()` alone.
Use the CLI to spot-check a prompt, not to certify one.

**On failure, regenerate once**, feeding back the complete violation list. One
repair, two drafts. A second repair masks a repeatable generation defect and
spends a model call while the owner is waiting to clear.

## 8. Three terminal states, and only three

1. Still invalid after the one repair → **`CONTINUUM_BLOCKED_VALIDATION`**. Write
   nothing, commit nothing. Print every violation and the last candidate in chat
   for manual repair.
2. Valid → write `docs/designs/next-session-prompt.md`, print it verbatim in
   chat, and attempt the commit **once**. The commit fails →
   **`CONTINUUM_UNCOMMITTED`**. Never retry, amend, reset, stash, switch branches
   or delete anything. The prompt is valid, on disk and already printed, so
   calling this blocked would misstate it — and calling it success would hide
   that a `/clear` plus a branch switch loses the file. The file is a launch
   pad, and the session that picks it up deletes it in its first commit.
3. Committed → **`CONTINUUM_COMMITTED`**.

Print the prompt verbatim either way it succeeds. The transition is meant to be
a copy-paste, not a re-read.

## 9. What the gate does not do

It checks structure and the facts it can compare against real state: six
sections, a path with a size, a command, and the branch measured against git
rather than taken on trust.

It does not rule on whether your constraints are the binding ones or your risks
are the real ones. Those are judgements. A validator that certified them would be
doing the thing `/crit` was built to stop — and a prompt that passes every rule
can still be useless, which is why §5 is the part that actually takes thought.
