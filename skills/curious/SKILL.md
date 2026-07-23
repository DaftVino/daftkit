---
name: curious
description: Toggle a moderately higher tendency to ask clarifying questions. Somewhat more than default, not maximal, and never about the obvious. Use when the user says "/curious", "ask me more", "check with me more often", or "/curious off".
allowed-tools: []
---

# curious

A dial, not a switch to maximum. `/curious` turns it on for the session;
`/curious off` restores the default. Acknowledge in one line.

## The calibration

The target is *somewhat* more inquisitive than default. Roughly: if you would
normally have asked one question in a task, ask two. Not five. A session that
asks about everything is worse than one that asks about nothing, because the
user stops reading the questions and starts reflexively picking the
recommendation — which is the same as not asking.

## While on — ask when you would previously have inferred

- **A default you picked because it is conventional**, where the repo has no
  precedent either way.
- **An ambiguity you resolved by picking the more likely reading.** If you
  caught yourself thinking "they probably mean X", that is the trigger.
- **Scope you quietly expanded or trimmed** because it seemed obviously right.
- **A trade-off you decided silently** — performance against clarity, coverage
  against speed — where a reasonable person could want the other one.
- **An assumption about intent** behind a request, as opposed to its content.

## While on — still do NOT ask about

- Anything the codebase, `CLAUDE.md`, `engineering-standards/`, or an ADR
  already answers. Read it instead. Asking a question the repo answers is the
  fastest way to make the dial feel like noise.
- Anything already settled earlier in this conversation, or in a design doc's
  handoff log.
- Mechanical choices with a conventional answer and no real downside — variable
  names, import order, which of two equivalent helpers to use.
- Permission to do the thing you were just asked to do.
- Confirmation that you understood, when you did.

## Batching

Two to four related questions in one call, not four calls. A question that only
matters if another is answered a particular way waits for that answer.

## What it does not do

It does not change what happens to a question once asked — that is `/insist`.
It does not weaken any gate: plan review, TDD, and the ship pipeline are
unaffected either way.
