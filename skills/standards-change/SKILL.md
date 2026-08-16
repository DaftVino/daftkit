---
name: standards-change
description: Queue a note recording where a repo deliberately breaks a daftplate engineering standard, and later flush queued notes into daftplate ADRs or issues. Use when the user says "standards change", "record a deviation", "we're breaking the standard here", "flush the outbox", or when a repo needs to differ from repo-standards on purpose.
---

# standards-change

The deviation outbox. When a repo **deliberately** breaks a standard, the reason belongs
somewhere a future reader will find it — not in a commit message nobody greps and not in a
comment that ages out. This queues a note locally; `--flush` later turns queued notes into
daftplate ADRs or issues.

Two halves, usually run weeks apart and from different repos:

- **Queue** — run from the repo that is deviating. Cheap, local, no network.
- **Flush** — run from the daftplate checkout, once someone is ready to decide.

## Why the queue is local

Notes go to `~/.daftplate/outbox/` rather than straight to GitHub issues because daftplate
publishes a curated public export (ADR 0004), and a note names a private repo and the
standard it broke. Queuing locally keeps that decision explicit: nothing leaves the machine
until a human flushes it, and a flush to an issue refuses a target repo that is not private.

## Queue a note

```
node ~/.claude/skills/standards-change/scripts/outbox.mjs <repo-path> \
  --rule="repo-standards §3" \
  --reason="Numbered doc buckets are required for navigation in this vault." \
  [--adr=docs/adr/0001-numbered-doc-buckets.md]
```

- `--rule` and `--reason` are both required. A note with no reason is not a note.
- `--adr` is optional: point it at a local ADR in the deviating repo if one exists.
- `profile` and `daftplate` are read from the repo's `.daftplate.json` when it has one, and
  recorded as `null` when it does not — a repo that daftplate never scaffolded can still
  report a deviation.

Write the `reason` for someone who does not have your context. *"Breaks §3"* is not a reason;
*"the vault's numbered buckets are the navigation, and kebab-case names sort wrong in the
Obsidian sidebar"* is.

## Inspect the queue

```
node ~/.claude/skills/standards-change/scripts/outbox.mjs --flush
```

Bare `--flush` **lists and moves nothing.** Read it before flushing anything.

## Flush one note

One note at a time, and you choose what it becomes.

**As an issue** — the default recommendation. A deviation is evidence, not yet a decision,
and an issue is where evidence goes to be argued:

```
node ~/.claude/skills/standards-change/scripts/outbox.mjs --flush \
  --note=<filename> --as=issue --daftplate=<path> --repo=<owner/repo>
```

**As an ADR** — only once a decision actually exists. All three sections are required,
because an ADR without alternatives is a changelog entry wearing a hat:

```
node ~/.claude/skills/standards-change/scripts/outbox.mjs --flush \
  --note=<filename> --as=adr --daftplate=<path> \
  --decision="..." --alternatives="..." --consequences="..."
```

It renders a **Proposed** ADR. Accepting it is a separate, human act.

## What it will not do

- **It never deletes a note.** A flush *moves* it to `~/.daftplate/outbox/flushed/`,
  byte-identical, and only after the ADR file exists or GitHub has returned an issue URL.
  A failed flush leaves the note pending, which is the recoverable direction.
- **It never flushes an issue to a public repo.** The target is checked first.
- **It never creates a duplicate issue.** Every body carries `Outbox-ID: <uuid>` and a retry
  finds the existing issue by that ID, so a partial failure is safe to re-run.
- **It never overwrites an existing ADR.**
- **It never flushes the whole queue at once.** One note, one decision.

## When to reach for this instead of just fixing it

If `/sync-standards` refuses a file as `REFUSED MODIFIED` and the repo is right to differ,
that is a deviation and belongs here. If the repo is wrong, fix the repo. The outbox is for
the first case only — using it to record things you intend to fix turns it into a to-do list
and it will stop being read.
