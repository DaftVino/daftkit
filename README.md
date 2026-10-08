<h1><img src="assets/daftkit-logo.png" alt="daftkit" width="200" align="top"> daftkit</h1>

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

The mirror of `/orient`. At the end of a phase, it writes a durable handoff note into the plan document: the branch and what merged, what the plan got wrong and how it was corrected, what was discovered, what is still open, and the next step with its files-to-read list. `/orient` makes entry cheap; `/handoff` makes exit clean — together they are what long, multi-session work depends on. If you are also about to clear the context and want a prompt for the next chat, reach for `/continuum`, which writes the note through `/handoff` and the prompt itself.

### `/continuum` — write the prompt the next session starts from

`/handoff` writes the note that records where the work got to. `/continuum` writes the *prompt* that makes the next chat start correctly — the files to read with their sizes, the branch it must not get wrong, the constraints it must not revert, and the exit criteria it is done against. The part that makes it more than a template is a validator: `validate(promptText, context)` is pure, deterministic and dependency-free, and it **refuses an invalid prompt before it reaches disk**, over six fixed sections and fifteen rules. The rule that closes the real hole compares the branch the prompt names against the branch actually checked out, with no escape hatch — omitting where the work sits is how a fresh session silently branches from `main` and loses the plan. Use it when you are about to clear the context and want the next session to pick up without re-deriving anything.

### `/anchor` — keep the thread through a compaction

`/continuum` hands off to a *new* session. `/anchor` keeps the current one. Give it a subject, the outcome you want and the next step, and it turns them into an evidence-grounded continuation brief plus a ready-to-submit `/compact` command, so an unfocused compaction cannot throw away the state you still need. It is deliberately explicit-invocation only: when to compact is your call, not the agent's. It refuses an argument missing any of the three parts rather than defaulting the scope to "the current task", because guessing there preserves the wrong subject — and it prints the command rather than running it, since a skill cannot trigger a built-in.

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

### `/audit` — find out whether a green suite proves anything

Reads raw test bodies, names a concrete mutant for each assertion, and reports which assertions would accept that mutant. It exists because a passing suite is evidence a test *executed*, never evidence it would have *caught* anything, and the gap between those two is where regressions live. Read-only and supplementary: it does not rewrite your tests, it tells you which of them are decorative.

### `/dress` — set project and priority on synced Linear issues

If your repo creates issues in GitHub and its `ROADMAP.md` `Board:` line names Linear, `/dress` fills in a newly synced issue's missing project and priority. It finds the Linear issue through the sync's linkback comment, waits up to three minutes for that comment to appear, confirms the GitHub attachment, and reads the saved values back. The project comes from the `Board:` line; the priority comes from the issue template or from you, never from a guess. It does not overwrite values somebody already set. On any other repo it produces no output, makes no network request and asks no question. It uses the Linear tools connected to your Claude session, so the repository holds no API key.

### `/standards-change` — somewhere a deliberate deviation can live

When a repo breaks a standard on purpose, the reason belongs somewhere a future reader will find it — not in a commit message nobody greps. A note naming the rule and the reason queues locally, and a later flush turns one note into a decision record or a private issue. Nothing is ever deleted: a flush *moves* the note, byte-identical, and only after the artifact exists, so a failed flush leaves it pending. It imports Node builtins only, because it runs from repos that have no daftplate checkout.

## How these were built

These skills were not designed in the abstract. They were extracted from a real, solo, AI-heavy development workflow whose single biggest pain was **context exhaustion** — an AI assistant losing the thread on a large project as it ran out of room to hold everything at once. Each skill maps to a specific, repeated instance of that pain:

- `/orient` and `/handoff` bracket every working session, so context spent re-reading a repo is context saved.
- `/brief` and `/curious` tune how much the agent says and asks.
- `/insist` stops the quiet auto-decision that a tired reviewer misses.
- `/gas-deploy` encodes deploy knowledge you otherwise re-learn every few months.
- `/diagram` moves the shape of a large repo out of the context window and onto a board you can keep.
- `/anchor` is the same problem from the other side: keeping one session's thread through a compaction rather than handing it to the next.
- `/audit` answers the question a green suite cannot: whether those tests would have caught anything.
- `/standards-change` keeps a deliberate deviation findable instead of trusting it to memory.

They were built the way daftplate builds everything: in small, independently reviewed phases, test-first, with zero runtime dependencies — the whole suite runs on Node's built-in test runner. They graduated into their own repo at daftplate's `v1.0.0`, once they had proven they carried no coupling to the templates. That lack of coupling is exactly why they are safe to drop into any repo you work in.

## Install

daftkit is a Claude Code **plugin**. Clone it into your skills directory under its
own name and every skill in it loads next session:

```
git clone https://github.com/DaftVino/daftkit ~/.claude/skills/daftkit
```

One directory, not one per skill. Everything daftkit ships lives under that single
path, so nothing it installs can land on top of a skill you already had — which is
the whole reason for the plugin shape rather than a pile of loose directories in a
folder you share with everything else.

Skills stay addressable under their plain name (`orient`) as well as the qualified
`daftkit:orient`, so nothing you have written down about them needs changing.

### Copying individual skills instead

Each skill is still a self-contained directory holding a `SKILL.md`, so you can
take just the ones you want:

```
cp -r skills/orient ~/.claude/skills/
```

One caveat worth knowing before you mix the two. **A loose copy wins the bare
name.** If `~/.claude/skills/orient/` exists alongside the plugin, `/orient` runs
the loose copy and the plugin's is reachable only as `daftkit:orient` — so a stale
hand-copied skill will quietly shadow the one you just updated. Pick one route per
skill, or remove the loose directory once you have installed the plugin.

## License

MIT — see [LICENSE](LICENSE).
