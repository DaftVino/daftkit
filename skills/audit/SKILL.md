---
name: audit
description: Audit whether tests actually prove what they claim — read raw test bodies, name a concrete mutant per assertion, and report which assertions accept it. Use when the user says "/audit", "are these tests real", "would this test have caught it", "mutation check", or before trusting a green suite as evidence.
argument-hint: "[a diff, a branch, or a named test scope]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(node --test *)
---

# audit

**Read-only. This skill never edits a test, production code, a review record, or an installed skill.** It reports; a separate session fixes. That is the first rule because it is the one most easily lost: the general-purpose review pack this supplements is fix-first by design, and a reviewer whose output is the input to a fix session cannot also be applying fixes.

## Why this exists separately

`/review` is a third-party pack and a strong reviewer. It has one structural blind spot this skill exists to cover, and it is not an oversight in it: its adversarial pass reads test files in **summary mode only** — `diff --stat`, not the bodies — and its checklist tells a reviewer not to flag "this assertion could be tighter" when the assertion already covers the behaviour. Both are reasonable defaults. Together they mean **a test that asserts nothing reads as coverage**.

The calibration case, which is real:

```
expect(feed()).toBe(feed())
```

A pure function compared to itself. It cannot fail. Every missing-test category misses it — it is not a missing negative path, edge case, or isolation violation — the one component that reasons rather than checklists is told not to read test bodies, and a standing instruction says to drop it if noticed.

`/review` is not defective and is not replaced. It reviews the change; this reviews the *evidence*.

## Input

```text
/audit <a diff, a branch, or a named test scope>
```

With no argument, audit the working diff against the merge base. If that is empty, say so and stop rather than auditing the whole suite — an unbounded audit produces an unbounded report nobody reads.

## Workflow

### 1. Read the raw bodies

For every test in scope, read the **test body itself**, not a summary, a name, or a coverage figure. Then read the production code each one exercises. Both halves are required: an assertion can only be judged against what the code can actually do.

If the scope is large, narrow it and say what was left out. A bounded audit that names its bound beats a complete-looking one that silently sampled.

### 2. For each assertion, name a mutant

Four fields, per assertion. All four, or the audit has not been done:

| Field | What it is |
|---|---|
| **Claim** | The property the test purports to prove, stated as a property |
| **Mutant** | A concrete change to the production code that reintroduces the bug — specific enough that a reader could apply it |
| **Observable** | The exact difference the assertion must distinguish between fixed and mutated |
| **Verdict** | Does the assertion **reject** the mutant, or accept it? |

Worked, from the incident this doctrine came from:

- **Claim:** the result cannot be absent or invalid.
- **Mutant:** the function returns `null`.
- **Observable:** the returned value.
- **Assertion:** `result !== undefined`.
- **Verdict:** **accepts the mutant.** `null !== undefined` is true, so the test passes with the bug present and does not prove the claim.

Weaker checks that do not establish a stronger claim: coverage, "it executed", "it did not throw", "not `undefined`", and type-only assertions. Compare exact values or exact bytes.

### 3. Report both halves

Three sections, and the third is not optional:

- **Blocking** — a test whose assertion accepts its named mutant. Give the four fields, so the finding is checkable rather than assertable.
- **Citation** — a doc, plan, changelog or PR body citing a test as proof of a claim that test does not assert. Name the citation and the assertion side by side.
- **What holds up** — the mutants the assertions *do* reject, named. An audit that reports only failures is indistinguishable from one that found nothing because it looked at nothing.

### 4. Never claim red you did not see

You may **recommend** a focused command. You may not write `Observed red:` unless the failing run actually happened in this session.

If historical red evidence is simply unavailable — the test predates the convention, the history is squashed — report that as **absent evidence**, in its own line, separately from a semantic tautology. They are different findings and conflating them inflates the second.

## Never

Edit anything. Run a broad suite, a build, or a deploy. Claim a test is tautological without naming the mutant it accepts. Emit an empty "no issues found" — if nothing was examined, say that instead. Characterise `/review` as broken.
