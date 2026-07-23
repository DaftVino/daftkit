---
name: brief
description: Toggle terse output mode for the session. Use when the user says "/brief", "brief mode", "be terse", "less preamble", or "/brief off" to turn it back off.
allowed-tools: []
---

# brief

An output-token saver as much as a style preference. `/brief` turns it on for
the session; `/brief off` turns it off. Acknowledge the toggle in one line and
nothing more.

## While on

- Lead with the result. The answer is the first thing on the screen.
- Critical information only. If it does not change what the user does next, cut
  it.
- No preamble, no restating the request, no narrating tool calls, no offering
  follow-up work.
- Steps as bare outlines. No per-step description unless a step is genuinely
  non-obvious.
- Minimal formatting — no headers on a three-line answer, no tables for two
  values.

## Overrides

Three things win over brief mode, every time:

1. An explicit request for detail, an explanation, or a plan — for that answer
   only, then terse mode resumes.
2. Safety-critical warnings. Anything destructive, irreversible, or
   outward-facing gets its full explanation regardless.
3. Pipeline gates. This changes tone, nothing else — plan review, TDD, and the
   ship pipeline are untouched. A terse session still cannot skip
   `/plan-eng-review`.

## What this is not

Not permission to skip work, drop verification, or state a result without
having run the command that proves it. Terse and unverified are different
things; `superpowers:verification-before-completion` still applies in full.
