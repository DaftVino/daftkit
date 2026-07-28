# Changelog

All notable changes to daftkit are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-07-28

### Added

- `/continuum` — the half of a chat-to-chat transition that was still hand-work. `/handoff` writes the note; nothing wrote the **prompt** the next session starts from, and nothing checked that what it printed was complete. The mechanism is not a better template: `validate(promptText, context)` is pure, deterministic and dependency-free, and it **refuses an invalid prompt before it reaches disk**, over six fixed sections and fifteen rules. The rule that closes the real hole compares the branch the prompt names against the branch actually checked out — asserted against git rather than trusted, with **no escape hatch**, because naming where the work sits is never wrong and omitting it is how a fresh session silently branches from `main` and loses the plan. A companion rule catches the other half: a stale or typo'd branch the prompt tells the next chat to *continue* on. One silent pass remains and is named in the source rather than left to be discovered — a typo'd base on a genuine create line, because a `cut … from …` line puts the base and the new branch in the same grammatical position and nothing in a pure function can tell them apart. It bundles its own validator and names no daftplate path, so it runs standalone from wherever it is installed.
- It was held out of the previous release behind a flip condition rather than a judgement call, and the condition is the interesting part: the session that *writes* a prompt cannot be the session that proves one works. The export was held until a fresh session executed a generated prompt end to end and landed a branch without asking a question the prompt should have answered. That happened on 2026-07-26.

### Changed

- `/handoff` gives up its "I'm going to clear" trigger to `/continuum`. The router picks a skill on its description line, and two skills claiming the same phrase leave it no way to choose. `/handoff` still owns the note and `/continuum` delegates to it; only the clearing case moved.

## [1.1.0] — 2026-07-24

### Added

- `/diagram` — reads a repo through a chosen lens and writes an editable `.excalidraw` board plus a Mermaid source. The structure lens renders folders as nested frames and files as cards inside them, with a four-colour status legend and an empty workbench frame for gaps, so the board is something you arrange and keep rather than a picture you regenerate. Rerunning with `--update` **merges** into the board you arranged: positions, colours, edited labels and anything you drew survive, a unit new in the code lands in an Inbox, and a unit that left is tinted stale instead of deleted. Element identity is preserved across updates, so an arrow you drew by hand still points at the card you aimed it at. Flowchart, ER, and sequence lenses ship too. It was held back from 1.0.0 with `/code-map` and `/deliberate`, which need a daftplate checkout to run; `/diagram` does not — it bundles its own scanner and converter and needs nothing but Node.

### Changed

- Expanded the README: per-skill detail (what each does and when to reach for it), the daftplate companion framing, and the development story behind the skills.

## [1.0.0] — 2026-07-23

### Added

- The first six portable skills, extracted from the `daftplate` working repo: `/orient`, `/handoff`, `/brief`, `/curious`, `/insist`, and `/gas-deploy`. Each is a self-contained `SKILL.md` with no build step and no dependencies.
