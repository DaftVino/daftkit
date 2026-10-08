---
name: dress
description: Dress newly filed GitHub issues on a Linear-variant repo — set project and priority in Linear, read them back, and report — and do nothing at all on any other repo. Use when the user says "/dress", "dress the issue", "dress it in Linear", after any `gh issue create` on a repo whose ROADMAP.md Board line names Linear, or when another skill hands over issue numbers to dress.
argument-hint: <issue-number> [<issue-number> ...]
---

# dress

On the Linear board variant (repo-standards §6.5.1), an issue is created in
GitHub and managed in Linear. The GitHub Issues Sync lands it on the board in
about two minutes with **no project and no priority**, and an undressed issue is
the variant failing. This skill is the step that dresses it, so the board stays
right without anyone carrying a second number around. Under ADR 0014 prose names
an issue `<short>-<N>` only, so tooling has to keep the Linear side correct.

Other skills call it — `/handoff` before its note, `standards-change` after a
flush — and a reminder hook prompts it after a bare `gh issue create`. It takes
one or more GitHub issue numbers.

## 1. Read the board, and skip if it is not Linear

For each number, run the helper from the repo:

```
node "<skill-dir>/scripts/board.mjs" <N> --wait
```

**No output means this repo is not on the Linear variant.** Its `ROADMAP.md`
`Board:` line names GitHub Projects, or it has no such line, or no `ROADMAP.md`.
Stop there, in silence, before any Linear tool is touched. Do not say the step
was skipped, do not ask anything, and do not fail the calling skill. Most repos
are on the default variant, and they must see no behaviour change at all.

Otherwise it prints one JSON line:

| Field | Meaning |
|---|---|
| `shortName` | the `Board:` line's project link text: the repo's short name, and its Linear project |
| `teamKey` | the board's team key |
| `attachmentUrl` | `https://github.com/<owner/repo>/issues/<N>`: what Linear's record of this issue must point at |
| `linearKey` | the Linear issue, read from Linear's own linkback comment, or `null` |
| `priority` | 1 Urgent, 2 High, 3 Medium or 4 Low, from the issue template's Priority dropdown, or `null` |
| `error` | why something could not be read, or `null` |

`--wait` looks for the linkback for up to three minutes, every twenty seconds,
because the sync takes about two. **If `linearKey` is still `null`**, report the
issue as *"no Linear linkback yet — left on the 24h backstop"* and move on. Do
not poll further, and do not fail the caller. The next `/handoff` sweeps it. An
issue imported before the integration posted linkbacks has none at all, and
gets the same line.

**Never compute a Linear key from the GitHub number.** The two sequences can
never be made to agree, and a computed key names somebody else's issue
plausibly enough to be believed.

## 2. Confirm it is this issue

Fetch the Linear issue with its attachments, using the session's Linear tool for
getting an issue. One attachment URL must equal `attachmentUrl` exactly. That is
what ties the project to *this repository's* issue `N`, rather than to anything
typed into a title. If none does, report a mismatch and change nothing.

If no Linear tool is connected in this session, report every issue as not
dressed from here, naming the number, and stop. Never fail the caller over it.

## 3. Set what is missing, and only that

- **Project.** If the issue has no project, set it to `shortName`, the
  `Board:` line's project. If it already has a *different* project, report that
  and leave it alone: somebody may have moved it on purpose.
- **Priority.** If the issue has none, use `priority` from the helper. If that
  is `null`, which happens with an outbox-filed or freehand issue, **ask the
  user**: Urgent (blocks the release), High (lands this branch), Medium
  (follow-up), Low (parked). If no user is there to ask, leave it unset and
  report it. If the issue already has a priority, keep it: triage outranks the
  filer's read.
- **Milestone and blocking relations.** Set them only when the calling skill
  handed them over. Otherwise list them as still needing a human. Never guess.

## 4. Read back

After writing, fetch the issue again and compare. Linear's save call has been
measured reporting a timeout that did not happen, so a timeout is read back,
never retried blind. Report what the read-back shows, not what was sent.

## 5. Report

One line per issue, in the repo's own identifier form:

```
<short>-<N> → project <name>, priority <level> (read back)
<short>-<N> → no Linear linkback yet — left on the 24h backstop
<short>-<N> → project set; priority needs a human (no template read, no answer)
```

Then stop. Dressing changes the board, and nothing else.

## What it will not do

- Run anything Linear-shaped on a repo that is not on the Linear variant.
- Invent a priority, a milestone or a blocking relation.
- Overwrite a project or priority somebody already set.
- Write a Linear key into prose. Under ADR 0014 the key is a handle for tools,
  and the issue is named `<short>-<N>`.
