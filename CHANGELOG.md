# Changelog

All notable changes to daftkit are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-07-24

### Added

- `/diagram` — reads a repo through a chosen lens and writes an editable `.excalidraw` board plus a Mermaid source. The structure lens renders folders as nested frames and files as cards inside them, with a four-colour status legend and an empty workbench frame for gaps, so the board is something you arrange and keep rather than a picture you regenerate. Rerunning with `--update` **merges** into the board you arranged: positions, colours, edited labels and anything you drew survive, a unit new in the code lands in an Inbox, and a unit that left is tinted stale instead of deleted. Element identity is preserved across updates, so an arrow you drew by hand still points at the card you aimed it at. Flowchart, ER, and sequence lenses ship too. It was held back from 1.0.0 with `/code-map` and `/deliberate`, which need a daftplate checkout to run; `/diagram` does not — it bundles its own scanner and converter and needs nothing but Node.

### Changed

- Expanded the README: per-skill detail (what each does and when to reach for it), the daftplate companion framing, and the development story behind the skills.

## [1.0.0] — 2026-07-23

### Added

- The first six portable skills, extracted from the `daftplate` working repo: `/orient`, `/handoff`, `/brief`, `/curious`, `/insist`, and `/gas-deploy`. Each is a self-contained `SKILL.md` with no build step and no dependencies.
