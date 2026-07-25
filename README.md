# daftkit

Portable agent skills for [Claude Code](https://claude.ai/code) — small, self-contained task playbooks you install once and use in any repository. No build step, no dependencies.

> daftkit is a curated, one-directional export of a private working repo. Fixes made here are not upstreamed; the skills are maintained in the source repo and re-exported.

## Part of daftplate

daftkit is one half of a two-repo system. Its companion, **[daftplate](https://github.com/DaftVino/daftplate)**, is the scaffolding engine — a layered template system that stamps out new project repositories with their conventions, CI, and agent instructions already in place.

- **daftplate** is the repo factory: a shared base layer plus one overlay per project type, with verification and provenance built in.
- **daftkit** is the portable agent skills that the factory — and any other repo — leans on day to day.

The split is deliberate. Profiles and the scaffolding engine only make sense inside daftplate, but these skills work in *any* repository, so they live on their own. Want the whole system (templates + skills + the context-budget discipline)? Start with **[daftplate](https://github.com/DaftVino/daftplate)**. Just want the skills? You are in the right place.

## The skills

### `/orient` — start a session already oriented

A session-start brief. It reads the repo's `CLAUDE.md`, its code map, the latest changelog entry, git status, and open issues, then emits a short working brief: what the repo is, where things stand, and what to do next. The point is to make *entering* a repo cheap — an agent starts productive instead of spending its first budget reading its way in. It is built to bail out early when a brief would not actually help.

### `/handoff` — leave a clean exit

The mirror of `/orient`. Before a planned context reset or at the end of a phase, it writes a durable handoff note into the plan document: the branch and what merged, what the plan got wrong and how it was corrected, what was discovered, what is still open, and the next step with its files-to-read list. `/orient` makes entry cheap; `/handoff` makes exit clean — together they are what long, multi-session work depends on.

### `/brief` — terse mode

Toggles a terser output style for the session: less preamble, no narration, answers first. Flip it on when you want signal over explanation.

### `/curious` — ask-more mode

Toggles a moderately higher tendency to ask clarifying questions before acting — more than the default, never about the obvious. Useful when the work is ambiguous and a wrong assumption is expensive to unwind.

### `/insist` — no unanswered questions

A hard stop on skipping questions: while on, the agent will not auto-decide or barrel past a real decision. On its own it is a strong preference; paired with the enforcement hook shipped in daftplate, it becomes an actual gate the agent cannot talk its way around.

### `/gas-deploy` — deploy Google Apps Script safely

Deploys a Google Apps Script web app with `clasp`, handling the traps that bite: deployment-ID hygiene (so you update the same deployment instead of spawning new ones), the `/exec` vs `/dev` URL distinction, and the auth failures that look like code bugs.

### `/diagram` — a working board of your repo, not a picture of it

Reads a repo through a lens you choose and writes an editable `.excalidraw` file plus a Mermaid source. The structure lens is the one to reach for: folders become nested frames, files become cards inside them, and you rearrange the board by hand — it ships a four-colour status legend to mark what is done, in progress, broken, or missing, and an empty workbench frame for gaps. Rerun it with `--update` and it *merges* into the board you arranged instead of overwriting it: your positions, colours, edited labels and hand-drawn notes survive, new units land in an Inbox, and units that left the codebase are tinted stale rather than deleted. Flowchart, ER, and sequence lenses are there too. It carries its own scanner and converter, so it needs nothing but Node.

## How these were built

These skills were not designed in the abstract. They were extracted from a real, solo, AI-heavy development workflow whose single biggest pain was **context exhaustion** — an AI assistant losing the thread on a large project as it ran out of room to hold everything at once. Each skill maps to a specific, repeated instance of that pain:

- `/orient` and `/handoff` bracket every working session, so context spent re-reading a repo is context saved.
- `/brief` and `/curious` tune how much the agent says and asks.
- `/insist` stops the quiet auto-decision that a tired reviewer misses.
- `/gas-deploy` encodes deploy knowledge you otherwise re-learn every few months.
- `/diagram` moves the shape of a large repo out of the context window and onto a board you can keep.

They were built the way daftplate builds everything: in small, independently reviewed phases, test-first, with zero runtime dependencies — the whole suite runs on Node's built-in test runner. They graduated into their own repo at daftplate's `v1.0.0`, once they had proven they carried no coupling to the templates. That lack of coupling is exactly why they are safe to drop into any repo you work in.

## Install

Each skill is a directory containing a `SKILL.md`. Copy the ones you want into your Claude Code skills directory:

```
cp -r skills/orient ~/.claude/skills/
```

Repeat per skill, or copy them all. They load automatically the next session.

## License

MIT — see [LICENSE](LICENSE).
