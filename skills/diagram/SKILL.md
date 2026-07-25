---
name: diagram
description: Analyze a repo through a chosen lens and produce an editable point-in-time .excalidraw diagram (plus a Mermaid source) — a structure working board (folders as frames, files as cards), flowchart, ER, or sequence. Self-contained and portable; no external diagram tooling. Re-runs merge into a board the user has arranged rather than overwriting it. Use when the user says "diagram", "map this repo", "structure board", "update the board", "refresh the diagram", "show what relies on what", "draw the drop tables / skill trees", "sequence for X", or "visualize the structure".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
---

# diagram

Point-in-time comprehension diagrams. You analyze a repo (or a subsystem) through
a **lens**, build a small structured **model**, and a bundled zero-dependency
converter turns it into an editable `.excalidraw` plus a valid Mermaid `.mmd`
source. These are scratch snapshots — non-authoritative. Once the user has
arranged a board, keep it: `--update` merges a fresh render into their layout
(§3a) instead of overwriting it. The converter never calls out to any other tool;
it ships beside this skill at `scripts/to-excalidraw.mjs`.

## 1. Ask up front

Confirm three things before analyzing (one `AskUserQuestion`, or infer from a
clear request and state your assumption):

- **Lens** — what to map: `structure` (the file/folder tree as a working board),
  `domain-data` (entities and how their records reference each other),
  `process-flow` (one operation, step by step), or `described` (the user
  describes it).
- **Output type** — how to render: `structure` (the board), `flowchart`, `er`,
  or `sequence`. Default per lens (`structure`→structure, `domain-data`→er,
  `process-flow`→sequence), but the user may override; lens and type are
  independent. (For an *imports* graph rather than the folder tree, use the
  `described` lens with type `flowchart`.)
- **Target** — a path, subsystem, or glob to analyze; for `described`, the
  description itself.

For the `structure` lens, do not ask lens/type questions — go straight to the
board flow below (it has its own single confirmation).

## 2. Analyze the repo and build the model

Read only what the target needs (prefer `docs/code-map.md`, `Grep`, and scoped
`Read` over opening large files whole). Cap the diagram at ~40 nodes /
participants — beyond that it is unreadable, so **narrow the subsystem** and say
so rather than emitting a wall. Build the model per the chosen type.

**By lens (worked examples):**

- **structure** → the board flow. A raw file listing is never the deliverable —
  filenames alone are no more useful than a directory listing. Follow §2a.
- **domain-data** → an entity per data table/type; a relation wherever one
  record references another's id. Example: a drop-table row carrying an `itemId`
  → `{ entities:[{name:"DropTable",attributes:[{name:"id",key:"PK"}]},{name:"Item",…}], relations:[{from:"DropTable",to:"Item",cardinality:"1..N",label:"yields"}] }`.
- **process-flow** → participants are the services/functions/actors the operation
  touches; messages are the ordered calls/events between them. Example: mob death
  → loot roll → grant item: `{ participants:[{id:"mob",label:"Mob"},{id:"loot",label:"LootService"},{id:"inv",label:"Inventory"}], messages:[{from:"mob",to:"loot",label:"died()",order:1},{from:"loot",to:"inv",label:"grant(item)",order:2}] }`.
- **described** → interpret the user's description, locate the relevant files to
  ground it, and build whichever model shape fits the chosen type.

### 2a. The structure board flow

**Step 1 — skeleton.** Run the bundled scanner for the mechanical tree. It lists
files with `git ls-files --cached --others --exclude-standard` (tracked +
untracked, `.gitignore` respected; outside a repo it walks the tree skipping
`.git`, `node_modules`, `dist`, `build`, `coverage`, `.venv`, `__pycache__`) and
applies the caps (depth 3, 25 files/folder; both overridable):

```
node "<skill-dir>/scripts/scan-structure.mjs" <target-dir> --out <model.json> [--depth 3] [--max-files 25] [--name <label>]
```

**Step 2 — identify the unit.** Peek at the target's contents. The card unit is
the *thing*, not the file: a folder of `<name>/SKILL.md` dirs → the unit is the
skill; a folder of `.md` items with frontmatter → the item; a `scripts/` dir →
the script; a docs tree → the doc. When a folder *is* a unit, it becomes one
card (`card: true`), not a frame of boilerplate filenames — a board where every
card says `SKILL.md` is a failed board. If the identified unit lies beyond the
scanner caps (deeper than `--depth`, or swallowed by `--max-files`), rescan
that branch with raised caps before enriching — a collapsed card cannot be
enriched into the unit it hides.

**Step 3 — self-determine, then confirm (always).** From the unit and the
user's request, pick the strongest organization (intent + card preset + relation
mode) and a second-strongest alternative. Ask ONE question offering exactly:

1. **Continue as suggested** — name the choice concretely ("one card per skill,
   title + hook, dependency arrows").
2. **The second-strongest guess** — equally concrete.
3. **I'll state the intent** — the user describes what the board should answer;
   you pick preset and mode to fit.
4. **I'll state the intent and the unit** — the user also overrides what a card
   represents.

**Card presets** (what each card shows):

| Preset | Card content | Fits |
|---|---|---|
| `title` | unit name only | pure reorganizing; densest |
| `title+hook` | name + one muted line: its purpose (frontmatter description, header comment, doc H1) | inventory / comprehension — the default |
| `title+facts` | name + hook + key facts (bundled scripts, triggers, dep counts) | deep audit of a small target |
| `work-status` | name + flags: `TODO×n`, `no test`, `empty`, `stale` — pre-colored via the legend colors where certain | planning gaps and work |
| `item-data` | name + the item's own key fields (type, category, rarity… from frontmatter/JSON keys) | folders of data/content items |

**Relation modes** (what gets arrows):

| Mode | Draws | Fits |
|---|---|---|
| `outline` | nothing — pure containment | reorganizing files |
| `arrows` | every pertinent relation, bound card-to-card, short verb labels ("reads", "installs", "produces"), capped ~25 (say what was left out) | dependency mapping |
| `cross-folder` | only relations crossing folder/unit boundaries; sibling links go in card detail text | busy boards |
| `notes` | no arrows; each card's detail names its dependencies ("→ code-map, publish") | zero-clutter reading |
| `focus` | only relations touching ONE named unit | "what does changing X affect" |

**Step 4 — enrich the model.** Rewrite the scanner's tree: unit-folders become
`card: true` entries with `label`/`detail` per the preset; plain files become
`{name, label, detail?, color?}` objects where detail earns its place; add
`relations: [{from, to, label?}]` per the mode. Endpoints are root-relative
paths (`orient`, `diagram/scripts/to-excalidraw.mjs` — folders resolve to their
frame) or an explicit `id` on the entry (ids must be unique and must not equal
another entry's path — the converter rejects collisions). The converter
normalizes relations (dedupes, drops self-links and unknown endpoints) before
they influence layout. A card may carry `status: done | in-progress | error |
gap` — rendered in the canonical legend color (`color` overrides it). Ground
every hook, relation, and status in a real read (frontmatter, imports, header
comments) — never invent one. Keep details under ~40 characters; they render
small.

**Model schemas** (validated by the converter):

```jsonc
// structure  { type, root, tree, relations? } — tree from scan-structure.mjs, then enriched:
//   dirs:  {name, dirs, files} (frame) | {name, card:true, label?, detail?, color?, id?} (unit card)
//          | {name, collapsed:true, fileCount} (summary card)
//   files: "name" | {name, label?, detail?, color?, id?}
//   relations: [{from, to, label?}] — endpoints are root-relative paths or explicit ids
// flowchart  { type, direction?("TB"|"LR"), nodes:[{id,label,group?}], edges:[{from,to,label?}] }
// er         { type, entities:[{name,attributes:[{name,type?,key?}]}], relations:[{from,to,cardinality,label?}] }
// sequence   { type, participants:[{id,label}], messages:[{from,to,label,order}] }
```

Self-references are allowed (a self-import, a self-call): the converter renders
them as a small loop. Keep labels short — they render inside boxes.

## 3. Write the model and convert

Write the model JSON to a temp file, then run the bundled converter (path is
relative to this skill's directory):

```
node "<skill-dir>/scripts/to-excalidraw.mjs" <model.json> "diagrams/<YYYY-MM-DD>-<slug>-<type>" --type <structure|flowchart|er|sequence>
```

It writes `diagrams/<date>-<slug>-<type>.excalidraw` and the sibling `.mmd` into
the target repo, and refuses (non-zero exit) on a model that does not match its
type — fix the model and re-run. It also **refuses to overwrite an existing
`.excalidraw`** (the user may have reorganized it by hand): use `--update` (§3a),
write to a new name, or pass `--force` only when discarding their layout is the
deliberate intent.

### 3a. Updating a board the user has already arranged

When the board exists and the repo has moved on, **do not regenerate it** — the
user's layout is the work. Merge the fresh render into their board:

```
node "<skill-dir>/scripts/to-excalidraw.mjs" <model.json> "diagrams/<existing-base>" --type structure --update
```

It reads `<out-base>.excalidraw`, merges, and writes it back (refreshing the
`.mmd`). Matching is by the `customData.daftplate` marker every generated element
carries — never by label text, so a renamed card is still the same card.

| | On `--update` |
|---|---|
| Position, size, frame membership | **kept** — the user's, always. A card's bound title and its muted detail line ride the box. |
| A card the user recolored | **kept.** A card still wearing its generated color is **repainted** when its status changes. |
| A label or detail the user edited | **kept.** The generator stamps what it wrote (`lastGenerated`); text that differs from it is the user's. |
| A label or detail the user never touched | **refreshed** from the fresh render. |
| A unit new in the model | lands in the **Gaps / To do** frame, flagged `inbox: true` — not dropped into its folder. The user places it. |
| A unit gone from the model | **never deleted.** It stays exactly where it is, tinted (dashed, muted, `opacity 60`) and flagged `stale: true`. |
| Relation arrows | regenerated from the model and re-bound to the cards' final positions. |
| Anything the user drew themselves | passed through verbatim — including a caption bound to a generated card. |

**Element ids are preserved, so hand-drawn references keep their meaning.** A
matched element keeps the id it already had in the user's board; only genuinely
new elements get ids, and never one that board already used. An arrow the user
drew from their own note to a card therefore still points at *that* card after
the model gains a file that sorts ahead of it — the merge never rewrites a user
element at all, so bindings, `containerId`, `frameId` and any reference field
Excalidraw adds later all keep working. The card's side of the binding is kept
too: its `boundElements` is the fresh render's list **plus** the user's entries.

**It refuses rather than guesses**, and exits non-zero. A board carrying no
daftplate markers (hand-built, or stripped), two elements claiming one marker, or
a hand-drawn element referencing something the update cannot preserve leaves the
board **untouched**: the fresh render goes to `<out-base>.new.excalidraw` and the
reason is reported. `--force` still resets from scratch and beats `--update`.

Known edges, verified against the real Excalidraw app (2026-07-24):

- The legend's four palette swatches have **no identity of their own** — they are
  furniture, regenerated every update. An arrow bound to a swatch cannot be
  preserved, so the merge refuses. Bind to cards, annotate swatches with free text.
- A brand-new **folder** frame appears at its fresh tree position (only new
  *cards* route to the Inbox); its child cards still land in the Inbox.
- A board generated before update mode has no `lastGenerated`, so every label
  simply refreshes. No data is lost.
- A card is re-seated in its frame only when it has **not moved since the board
  was last written** (`geom`) — the signature of the Excalidraw frame-drag
  desync, which strands a grandchild card when its parent frame is dragged. A
  card the user moved out of its frame themselves, by drag or arrow key, stays
  where they put it. A board with no `geom` snapshot gets the old unconditional
  repair, once.
- User styling or hand-bent routing on a **generated relation arrow** is
  discarded — arrows are regenerated from the model.

**The structure board** renders folders as nested Excalidraw frames and units as
semantic cards inside them (containment layout — only deliberate relation arrows
cross it, bound to their cards so they follow drags). The layout follows the
**banded-grid system**: ONE global grid holds everything that never needs to
move — plain cards first, then cards that only *receive* lines (sinks) on their
own bottom rows, same columns. Only cards that *originate* lines drop below,
into spaced bands ranked by nearest target (band 1 points at the grid, band 2
at band 1, …); odd bands sit half a column pitch off the grid, even bands
return to the columns — a brick lattice, so arrows run short clear diagonals
through the gaps (quarter-pitch stagger is the manual escalation if half lanes
ever conflict). A dense tangle (more intra-folder edges than cards) falls back
to a **ring** with an empty interior, which guarantees no arrow passes through
a card. A band-skipping arrow may cross a card — accepted; this board exists to
be rearranged and the grid is already out of the way. Cross-folder arrows carry
no guarantee either way — prefer intra-folder relations, or the `notes` mode,
when a board has many. It is a working board, not
just a picture: dragging a folder frame moves its contents, cards can be dragged
between folders, and it ships an annotation kit beside the tree — a four-color
status **Legend** (green done, yellow in progress, red error to fix, blue
gap/missing; select a card → background color to mark it) and an empty
**Gaps / To do** workbench frame for staging notes and planned-but-missing
files. Collapsed folders and overflow appear as dashed summary cards. The `.mmd`
companion is the read-only view (nested subgraphs plus relation edges).

## 4. Report

After an `--update`, report the **merge**, not the render: what arrived in the
Inbox, what went stale, and which labels refreshed — that is what the user needs
to go look at. If the merge was refused, say why and name the
`.new.excalidraw` written beside their untouched board.

Otherwise print both file paths. Note they are scratch snapshots (gitignore or
commit as the user prefers) and offer to open the `.excalidraw`. State the lens, type, and
node/participant count (for `structure`: folder and file counts, plus the depth
and file caps used); if you capped or narrowed the scope, say what you left
out. For `structure` boards with nested folders, pass on the one known
Excalidraw quirk (verified 2026-07-24): dragging a frame moves only its direct
members — a subfolder frame travels, but that subfolder's own contents stay
behind. To move a deep folder intact, rubber-band-select its whole area
instead of dragging its name. The `.mmd` is the human-readable source — mention the user can hand-edit it
or paste it into any Mermaid renderer.
