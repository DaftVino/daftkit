---
name: orient
description: Session-start brief for a repo — reads CLAUDE.md, the code map, the latest changelog entry, and open issues, then emits a short working brief. Use at the start of any session, after a /clear, or when the user says "orient", "where are we", or "catch up".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# orient

Produce a working brief in under 30 lines, for under 15k tokens. This runs
before anything else in a session, which is the cheapest moment there is —
spending 60k here to save 40k later is a net loss, so the budget is the point.

## 0. Decide whether to run at all

Orientation is a bet: it costs tokens now to avoid larger reads later. On a
session that arrived with a specific, self-contained task, the bet loses — the
brief is pure overhead. **Measured 2026-07-22: `/orient` costs ~8.8k tokens on a
small repo, against a ~41k session baseline.**

So if the user's first message is a concrete task that does not depend on the
repo's current state — "add a test for X", "what does this regex do", "fix this
stack trace" — skip the brief and do the task. Run it when the request is
open-ended, references repo state, or resumes prior work.

## The read-size discipline — conditional

**When the SessionStart hook says this repo holds a file over 50KB:** never
open one. Not to skim it, not to check one thing. Use `docs/code-map.md` for
structure, `Grep` for specifics, or dispatch an Explore subagent. If you find
yourself about to read a large file "just quickly", that is the failure this
skill exists to prevent.

**When the hook says no file is large enough:** skip this section entirely and
skip step 3 below. Do not grep defensively in a repo of small files — every
tool call re-sends the whole context, so three greps to avoid one 8KB read
costs more than the read. The rule exists for 775KB userscripts, not for a
5KB module.

## 1. Read, in this order, stopping when you have enough

1. `CLAUDE.md` — always. It is under 60 lines by standard.
2. `.daftplate.json`, if present — the profile and the daftplate version that
   produced this repo. One line of output.
3. `docs/code-map.md`, if present — read the `##` headers and the sizes, not
   the symbol lists. You are learning the shape, not the contents.

   **Check its freshness first**, with the command the map's own header prints:

   ```
   git log -1 --format=%h -- '*.js' '*.mjs' '*.cjs' '*.gs' '*.ts' '*.tsx' '*.jsx' '*.html'
   ```

   If that differs from the commit the header names, indexed source has changed
   since the map was built. Count the drift with `git rev-list --count
   <map-commit>..HEAD -- '*.js' '*.mjs' '*.cjs' '*.gs' '*.ts' '*.tsx' '*.jsx'
   '*.html'` and say so in the brief: *"code map is N source commits stale —
   anchors may be wrong; run /code-map"*. A stale map is worse than no map,
   because it is trusted. Do not regenerate it unasked.

   **Do not compare against `HEAD`.** The stamp is the last commit that touched
   an indexed file, because a map cannot name the commit that adds it — a HEAD
   comparison reports every freshly-committed map as stale, and the correct
   response to that false positive is not to reason around it in the brief.
4. The topmost released entry in `CHANGELOG.md` — `Read` with `limit: 40`.
5. `git status --short` and `git log --oneline -5`.
6. `gh issue list --limit 10 --state open` — skip without comment if `gh` is
   unavailable or the repo has no remote.
7. The newest file in `docs/designs/`, if any, and only its `## Handoff log`
   section — `Grep` for the heading and read from there.

If `docs/code-map.md` is absent and the repo has a source file over 100KB, say
so and offer `/code-map`. Do not generate it unasked.

## 2. Emit the brief

Exactly these sections, nothing else:

- **Repo** — one line: what it is, profile, current branch.
- **State** — released version, uncommitted changes, whether the branch is
  ahead of `main`, and the code map's staleness if it is not current.
- **Open work** — up to five issues as `#N title`, plus the current milestone
  if there is one.
- **Last handoff** — the "next phase" line from the newest design doc, verbatim,
  or `none` if there is no design doc.
- **Watch out** — anything from CLAUDE.md's repo-specific constraints that a
  new session would plausibly violate in its first ten minutes. Two items
  maximum, and only real ones. Omit the section rather than padding it.
- **Suggested next action** — one line.

## 3. Stop

Do not start work. Do not read further "for context". Do not offer a plan. The
user reads the brief and decides. Ending here is the whole discipline.
