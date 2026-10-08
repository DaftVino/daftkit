#!/usr/bin/env node
// The /continuum prompt gate: the structure a next-session prompt must carry,
// and the handful of facts it can be held to against real git state.
//
// The prompt has six `##` sections, in this order, and each is checkable:
//
//   Start here          the literal token /orient, in the first H2
//   Read first          1..6 numbered entries, each `path` + a (size)
//   Branch              the branch actually checked out, named
//   Constraints         the do-not-revert list
//   Exit criteria       at least one command, not an aspiration
//   Unknowns and risks  at least one list item; `- none` must be typed
//
// The boundary, stated rather than assumed: this file checks structure and the
// facts it can compare against real state — a path with a size, a command, and
// the branch, measured against git rather than taken on trust. It does not rule
// on whether the do-not-revert list is complete or whether the stated risks are
// the real risks. Those are judgements, and a validator that certified them
// would be doing what /crit was built to stop. They stay with the model and the
// owner. Entry *roles* are unchecked for the same reason: the skill supplies
// those labels, so grading them would be grading its own homework. Only the one
// fact survives — entry 1's path is the phase contract.
//
// validate(promptText, context) is pure and deterministic over its two
// arguments: no file read, no clock, no randomness, no child process, and no git
// call of its own. Git state arrives as `context`, read by the caller. The file
// boundary lives in main() alone. Self-contained by design: imports nothing
// outside node:*, so it runs standalone from ~/.claude/skills/continuum/.
//
// Usage: node validate-prompt.mjs <prompt-path> --branch <name> [--branches <a,b,c>]
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SECTIONS = ['Start here', 'Read first', 'Branch', 'Constraints', 'Exit criteria', 'Unknowns and risks'];

// Declaration order is report order within a section, so a run's output is
// stable across runs and diffable in a test assertion.
export const REFUSAL = {
  MISSING_SECTION: 'missing-section',
  SECTION_DUPLICATE: 'section-duplicate',
  SECTION_ORDER: 'section-order',
  ORIENT_NOT_FIRST: 'orient-not-first',
  MANIFEST_EMPTY: 'manifest-empty',
  MANIFEST_CONTRACT_FIRST: 'manifest-contract-first',
  MANIFEST_DUPLICATE: 'manifest-duplicate',
  MANIFEST_OVERFLOW: 'manifest-overflow',
  MANIFEST_UNSLICED: 'manifest-unsliced',
  MANIFEST_UNSIZED: 'manifest-unsized',
  MANIFEST_MISSING: 'manifest-missing',
  BRANCH_UNNAMED: 'branch-unnamed',
  BRANCH_MISMATCH: 'branch-mismatch',
  BRANCH_UNKNOWN: 'branch-unknown',
  ISSUE_CLOSED: 'issue-closed',
  ISSUE_UNPAIRED: 'issue-unpaired',
  ISSUE_UNQUALIFIED: 'issue-unqualified',
  ISSUE_BARE: 'issue-bare',
  ISSUE_LINEAR_KEY: 'issue-linear-key',
  CLOSING_KEYWORD: 'closing-keyword',
  EXIT_UNCHECKABLE: 'exit-uncheckable',
  UNKNOWNS_EMPTY: 'unknowns-empty',
};

export const RULES = Object.values(REFUSAL);

// ≈8k tokens, ~5% of the 150k phase budget. A file over this appears only as a
// slice instruction, never as a whole-file read.
export const SLICE_THRESHOLD_BYTES = 32768;
export const MANIFEST_MAX_ENTRIES = 6;

const HEADING = /^## (.+?)\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const ENTRY_START = /^\s*\d+\.\s/;
const LIST_ITEM = /^\s*[-*+]\s+\S/;
const BACKTICKED = /`([^`\n]+)`/g;
const SIZE_TOKEN = /\((?:(\d+(?:\.\d+)?)\s?([KMG])i?B?|new file)\)/;
const SLICED = /\b(slice|anchor)/i;
// The one heuristic in this file, and it reads the vocabulary imperatively: only
// an instruction to create licenses a branch the repo does not have. A negated
// use ("do not create a new branch") and a passive one ("scope was cut on `x`")
// are not directives and license nothing. A directive it fails to recognise is a
// loud false refusal you fix by rewording — widen the vocabulary, never weaken
// the rule. One silent pass remains, and is accepted: a typo'd base on a real
// create line, because `cut \`x\` from \`y\`` puts the base and the branch being
// created in the same position and nothing here can tell them apart.
const CREATE_DIRECTIVE = /\bcut\b|\bcreate\b|\bnew branch\b|(?:^|\s)-b\b/gi;
const NEGATION = /\bnot\b|\bnever\b|n't/i;
const PASSIVE_AUX = /\b(?:was|is|were|are|been|being)\s*$/i;
const UNIT_BYTES = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

const violation = (rule, section, message) => ({ rule, section, message });

// Every reserved-heading candidate is a backtick span shaped like a ref. Git
// refuses a leading or trailing slash, an empty path component and `..`, so a
// backticked `/deliberate` is a skill invocation rather than a branch nobody
// has — the difference between a false refusal on every prompt that mentions
// one and a rule that only fires on real branch names.
const isRefLike = (s) => /^[\w.\-/]+$/.test(s)
  && !s.startsWith('/') && !s.endsWith('/') && !s.includes('//') && !s.includes('..');

// Positions come back with the spans because the create-directive exemption is
// positional: it licenses what follows the verb, not the whole line.
function backtickedSpans(text) {
  const found = [];
  for (const m of text.matchAll(BACKTICKED)) found.push({ inner: m[1], at: m.index });
  return found;
}

const backticked = (text) => backtickedSpans(text).map((s) => s.inner);

// Where the line starts licensing new branches, or null if it never does. Both
// guards check what stands ahead of the verb: a negation anywhere before it on
// the line reverses the instruction ("do not create a new branch; stay on `x`"
// was exempting `x`), and an auxiliary immediately before it makes the verb a
// report of what happened rather than a direction ("scope was cut on `x`").
function createDirectiveAt(line) {
  for (const m of line.matchAll(CREATE_DIRECTIVE)) {
    const before = line.slice(0, m.index);
    if (!NEGATION.test(before) && !PASSIVE_AUX.test(before)) return m.index;
  }
  return null;
}

// Fenced content is invisible to every rule but exit-uncheckable, where a fence
// is itself the evidence. Masked lines keep their positions so a body's line
// range still lines up with the raw text.
function maskFences(text) {
  const raw = text.split('\n');
  const masked = raw.slice();
  const fenced = raw.map(() => false);
  let open = null;

  for (let i = 0; i < raw.length; i += 1) {
    const m = FENCE.exec(raw[i]);
    if (open) {
      masked[i] = '';
      fenced[i] = true;
      if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') open = null;
    } else if (m) {
      masked[i] = '';
      fenced[i] = true;
      open = { char: m[1][0], len: m[1].length };
    }
  }
  return { raw, masked, fenced };
}

function readSections(text) {
  const { raw, masked, fenced } = maskFences(text);
  const headings = [];
  for (const [i, line] of masked.entries()) {
    const m = HEADING.exec(line);
    if (m) headings.push({ name: m[1], line: i });
  }

  const found = new Map();
  // Every line a reserved section owns, its heading included. What is left over
  // is the preamble above `## Start here` plus anything under a heading the
  // contract does not reserve — text the per-section scan used to drop.
  const claimed = masked.map(() => false);
  for (const [i, heading] of headings.entries()) {
    if (!SECTIONS.includes(heading.name)) continue;
    const end = i + 1 < headings.length ? headings[i + 1].line : masked.length;
    const range = { from: heading.line + 1, to: end };
    for (let j = heading.line; j < end; j += 1) claimed[j] = true;
    const section = {
      ...heading,
      body: masked.slice(range.from, range.to),
      rawBody: raw.slice(range.from, range.to),
      hasFence: fenced.slice(range.from, range.to).some(Boolean),
    };
    if (found.has(heading.name)) found.get(heading.name).duplicates += 1;
    else found.set(heading.name, { ...section, duplicates: 0 });
  }
  return {
    headings,
    found,
    outside: masked.filter((_, i) => !claimed[i]),
    // The unmasked twin, for the one rule that must not honour a fence. See
    // `closingKeywordRefs`.
    rawOutside: raw.filter((_, i) => !claimed[i]),
  };
}

function readEntries(body) {
  const entries = [];
  for (const line of body) {
    if (ENTRY_START.test(line)) entries.push([line]);
    else if (entries.length > 0) entries[entries.length - 1].push(line);
  }
  return entries.map((chunk) => {
    const text = chunk.join('\n');
    // First line only. Read over the whole entry, a sizeless entry borrowed any
    // size its prose happened to quote — and the borrowed number then fed the
    // slice threshold, so a 60K file citing a small one cleared manifest-
    // unsliced too. `slice`/`anchor` stays whole-entry: that instruction
    // legitimately lands on a continuation line.
    const size = SIZE_TOKEN.exec(chunk[0]);
    return {
      text,
      path: backticked(text).find((s) => !/\s/.test(s)) ?? null,
      sized: size !== null,
      // A size with no unit letter is not a size token at all, so `bytes` is
      // null exactly when the entry is unsized or carries the (new file) escape.
      bytes: size?.[1] ? Math.round(Number(size[1]) * UNIT_BYTES[size[2]]) : null,
    };
  });
}

function checkManifest(section, contractPath, existingPaths, out) {
  const entries = readEntries(section.body);
  if (entries.length === 0) {
    out.push(violation(REFUSAL.MANIFEST_EMPTY, 'Read first', 'the manifest has no numbered entries; a bulleted read is prose'));
    return;
  }

  if (contractPath && entries[0].path !== contractPath) {
    out.push(violation(REFUSAL.MANIFEST_CONTRACT_FIRST, 'Read first', `entry 1 must be the phase contract, ${contractPath}, not ${entries[0].path ?? 'an entry naming no path'}`));
  }

  const seen = new Set();
  const reported = new Set();
  for (const e of entries) {
    if (e.path === null) continue;
    if (seen.has(e.path) && !reported.has(e.path)) {
      reported.add(e.path);
      out.push(violation(REFUSAL.MANIFEST_DUPLICATE, 'Read first', `two entries name ${e.path}`));
    }
    seen.add(e.path);
  }

  if (entries.length > MANIFEST_MAX_ENTRIES) {
    out.push(violation(REFUSAL.MANIFEST_OVERFLOW, 'Read first', `${entries.length} entries; the manifest caps at ${MANIFEST_MAX_ENTRIES}`));
  }

  for (const [i, e] of entries.entries()) {
    const which = e.path ?? `entry ${i + 1}`;
    if (!e.sized) out.push(violation(REFUSAL.MANIFEST_UNSIZED, 'Read first', `${which} carries no (size) and no (new file) escape`));
    else if (e.bytes !== null && e.bytes > SLICE_THRESHOLD_BYTES && !SLICED.test(e.text)) {
      out.push(violation(REFUSAL.MANIFEST_UNSLICED, 'Read first', `${which} is over ${SLICE_THRESHOLD_BYTES} bytes and says nothing about reading it in slices, or from anchors`));
    }
    // (new file) is the documented escape for an entry naming something that
    // does not exist yet — `e.sized && e.bytes === null` identifies it
    // precisely, since manifest-unsized already owns the unsized case above.
    const isNewFile = e.sized && e.bytes === null;
    if (existingPaths && e.path !== null && !isNewFile && !existingPaths.has(e.path)) {
      out.push(violation(REFUSAL.MANIFEST_MISSING, 'Read first', `${which} does not exist`));
    }
  }
}

function checkBranch(section, context, out) {
  const branch = typeof context.branch === 'string' && context.branch !== '' ? context.branch : null;
  const head = typeof context.head === 'string' && context.head !== '' ? context.head : null;
  const known = Array.isArray(context.branches) ? context.branches : [];

  const lines = section.body.map((line) => ({
    directiveAt: createDirectiveAt(line),
    candidates: backtickedSpans(line).filter((s) => isRefLike(s.inner)),
  }));
  const all = lines.flatMap((l) => l.candidates.map((s) => s.inner));

  if (all.length === 0) {
    out.push(violation(REFUSAL.BRANCH_UNNAMED, 'Branch', 'the section names no branch; a backticked identifier is how the next chat is told where the work is'));
    return;
  }

  // A detached HEAD is not refused, only stated: the prompt names the commit
  // where a branch would go, and a longer SHA satisfies the short one git gave.
  const isHead = (c) => head !== null && (c === head || c.startsWith(head));
  if (branch !== null) {
    if (!all.includes(branch)) out.push(violation(REFUSAL.BRANCH_MISMATCH, 'Branch', `the work is on ${branch}, which the section never names`));
  } else if (head !== null && !all.some(isHead)) {
    out.push(violation(REFUSAL.BRANCH_MISMATCH, 'Branch', `HEAD is detached at ${head}, which the section never names`));
  }

  // No branch list means the caller could not supply one, which disables this
  // rule and leaves branch-mismatch — the one that matters most — standing.
  if (known.length === 0) return;

  const reported = new Set();
  for (const { directiveAt, candidates } of lines) {
    for (const { inner: c, at } of candidates) {
      // Everything after the verb is exempt, base included: `cut \`x\` from
      // \`y\`` names both legitimately, and telling the two apart is beyond what
      // this file can know. A typo'd base there is the accepted cost.
      if (directiveAt !== null && at > directiveAt) continue;
      if (known.includes(c) || c === branch || isHead(c) || reported.has(c)) continue;
      reported.add(c);
      out.push(violation(REFUSAL.BRANCH_UNKNOWN, 'Branch', `${c} is not a branch this repo has, and the line does not say to create it`));
    }
  }
}

function checkStructure(headings, found, out) {
  for (const name of SECTIONS) {
    if (!found.has(name)) out.push(violation(REFUSAL.MISSING_SECTION, name, `the prompt has no ## ${name}`));
    else if (found.get(name).duplicates > 0) out.push(violation(REFUSAL.SECTION_DUPLICATE, name, `## ${name} appears ${found.get(name).duplicates + 1} times`));
  }

  let furthest = -1;
  for (const name of [...found.keys()].sort((a, b) => found.get(a).line - found.get(b).line)) {
    const at = SECTIONS.indexOf(name);
    if (at < furthest) {
      out.push(violation(REFUSAL.SECTION_ORDER, name, `## ${name} arrives after a section the contract puts later`));
      break;
    }
    furthest = at;
  }

  const start = found.get('Start here');
  if (!start) return;
  if (headings[0]?.name !== 'Start here') {
    out.push(violation(REFUSAL.ORIENT_NOT_FIRST, 'Start here', '## Start here is not the first H2; nothing may precede the instruction to orient'));
    // Word-bounded: a line pointing at the /orientation docs satisfied a bare
    // substring test without ever telling the next chat to run anything.
  } else if (!/\/orient\b/.test(start.body.join('\n'))) {
    out.push(violation(REFUSAL.ORIENT_NOT_FIRST, 'Start here', '## Start here never says /orient'));
  }
}

// The bucket a reference outside all six reserved sections is reported under.
// `SECTIONS.indexOf` returns -1 for it, so validate()'s closing sort puts it
// ahead of every sectioned violation — which is where the text it names sits.
export const OUTSIDE_SECTION = '(outside)';

// `#N` outside fenced blocks. The `(FORGE-M)` half of the §6.5.1 pairing is not
// a GitHub number and must never be collected: the two sequences drift by 80-103
// across this workspace, so a Linear number read as a GitHub one silently checks
// the wrong issue's state.
//
// The lookbehind drops `owner/repo#N`, the form §6.5.1 mandates for another
// repo's issue: checked against *this* repo's open list it is a false refusal on
// a spelling the standard requires. `\w` covers `daftkit#3`, `-` and `/` cover
// `some-repo#8` and `owner/repo#8`. A bare `#336699` is still read as issue
// 336699, deliberately: it is all-digit with no discriminator from a real
// number, and it fails loudly rather than silently.
const ISSUE_REF = /(?<![\w/-])#(\d+)/g;

// The lookbehind above exempts *any* `word#N`, not only the slashed form, and it
// has to: told nothing about which repo it is validating for, the scan cannot
// tell `daftkit#3` from `daftplate#152`. So the third spelling is refused rather
// than guessed at — §6.5.1 permits `#N` for this repo's issue and
// `owner/repo#N` for another's, and nothing else. An unslashed prefix is neither,
// which is exactly why it is uncheckable: `daftplate#152` reads as a
// self-reference and as `DaftVino/daftplate`'s issue 152 equally well, and those
// are different issues in different repositories.
//
// Identity was the obvious alternative and does not work here. The working
// checkout and the public export it produces have DIFFERENT names, so
// name-matching would exempt `daftplate#152` — correctly, since that names the
// real public export repo — and catch only the working repo's own spelling,
// which nobody will ever type.
// A list of *known other* repos goes stale by construction, and a stale list
// falsely refuses the mandated spelling: the defect the lookbehind was added to
// fix, reinstated. Requiring the slash needs no identity at all.
//
// It catches the English-prefix case for the same reason and to the same end:
// `reproduces unchanged post-#123` names this repo's #123 and the lookbehind
// drops it silently. Known false positive: text like `C#9` outside a fence.
// The fix there is the space the prose wanted anyway.
const UNQUALIFIED_REF = /(?<![\w/-])([A-Za-z][\w.-]*)#(\d+)/g;

// A Linear id, and the pairing that redeems it. No lookbehind on the paired
// form: `owner/repo#4 (FORGE-9)` is a legitimate pair even though its `#4` is
// another repo's number.
const LINEAR_REF = /\bFORGE-\d+\b/g;
const PAIRED_REF = /#\d+\s*\(\s*(FORGE-\d+)\s*\)/g;

export function issueRefs(text) {
  const { masked } = maskFences(text);
  const seen = new Set();
  for (const line of masked) {
    for (const m of line.matchAll(ISSUE_REF)) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b);
}

// Linear ids written without their GitHub half. A prompt naming only `FORGE-246`
// carries no `#N` at all, so issue-closed has nothing to compare and every stale
// reference in it passes — the rule standing down without saying so. Resolving
// the Linear id is not an option (the two sequences drift), and §6.5.1 already
// requires the pair, so the bare form is refused rather than guessed at.
// `word#N` — neither §6.5.1 spelling. Returned as the whole matched token, not
// as a number: the prefix is the defect and the message has to quote it back, and
// two different prefixes on the same number are two separate violations.
export function unqualifiedRefs(text) {
  const { masked } = maskFences(text);
  const seen = new Set();
  for (const line of masked) {
    for (const m of line.matchAll(UNQUALIFIED_REF)) seen.add(m[0]);
  }
  return [...seen].sort();
}

// GitHub's auto-close keywords, all three tenses of each, exactly as its parser
// takes them.
//
// What may stand between the keyword and the number is the whole rule. GitHub
// accepts whitespace, an optional colon, and **any markdown emphasis or code
// formatting around either half** — a keyword in a code span still closes, which
// is the observed behaviour this rule exists for. So the joiner class holds
// whitespace, `:` and the formatting characters, and holds **no `+`**. That
// omission is not incidental: `+` is what §6.5.1's sanctioned form puts between
// the two halves, and it is what makes the safe form safe here as well as on
// GitHub.
const CLOSING_KEYWORD_REF = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s`*_~]*(?:(?:[\w.-]+\/[\w.-]+)?#\d+|\bGH-\d+\b|https?:\/\/\S*?\/issues\/\d+)/gi;

/**
 * A closing keyword standing next to a literal issue number — the construct that
 * closes an issue by being written about.
 *
 * **This is the one rule in this file that reads the raw text.** Every other one
 * runs over `maskFences`' output, because a fenced block is an example rather than
 * an assertion. That reasoning does not transfer, for two reasons and neither is a
 * guess about the parser.
 *
 * GitHub's auto-close parser is **measured** to ignore code spans: this rule is
 * built on a real incident, in which an issue was closed on 2026-08-29 by a PR
 * body containing a backticked reference inside a block quote, in a sentence
 * warning against exactly that. Its behaviour inside a *fenced* block was never
 * measured, and measuring it costs a real issue to find out.
 *
 * And the pathway does not run through GitHub's renderer anyway. Both recorded
 * occurrences — the earlier one recorded in a frozen design document, same
 * shape — were
 * launch-pad prose **copied into a PR body**, and a fence does not reliably
 * survive that copy. Treating unmeasured as unsafe is the whole point of a rule
 * whose violation is silent: there is no CI signal, no review comment and no diff,
 * the issue simply stops being open.
 *
 * The whole matched token comes back rather than the number, because the joiner is
 * the defect and the message has to quote it back — and the same number reached
 * two different ways is two separate violations.
 */
export function closingKeywordRefs(text) {
  const seen = new Set();
  // By paragraph, not by line — the only rule here that does not scan line by
  // line. A soft line break is whitespace once markdown is rendered, so a
  // keyword ending one line and a `#N` opening the next are adjacent to the
  // parser however they look in the source; a blank line is a paragraph break
  // and does separate them. Line-by-line would miss the first, which is the
  // shape a wrapped sentence produces by accident rather than by intent.
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const m of paragraph.matchAll(CLOSING_KEYWORD_REF)) seen.add(m[0].replace(/\s+/g, ' ').trim());
  }
  return [...seen].sort();
}

// --- the board, and the identifier it implies (§6.5.1, ADR 0014) ----------
//
// A repo on the Linear variant names an issue `<short>-<N>`, where `<short>` is
// the project link text on its single `Board:` line. That line is the repo's one
// checked declaration of its variant (check-roadmap.mjs refuses two), which is
// why it is read here and nowhere else. readBoard is pure: main() reads the file
// and hands the text over, so validate() stays a function of its arguments.
//
// Three copies of this parse exist, and they are forced, not lazy:
// check-roadmap.mjs ships into scaffolded CI and imports nothing, and this file
// and the board helper both run standalone from ~/.claude/skills/. A parity test
// over shared fixtures pins them together.
const BOARD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BOARD_TEAM = /\bteam\s+`([A-Z][A-Z0-9]*)`/;

export function readBoard(roadmapText) {
  if (typeof roadmapText !== 'string') return null;
  const lines = roadmapText.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('Board:'));
  if (start === -1) return null;
  const paragraph = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') break;
    paragraph.push(line);
  }
  const text = paragraph.join(' ');
  if (!/\bLinear\b/.test(text)) return { variant: 'github', shortName: null, teamKey: null, projectUrl: null };
  const link = BOARD_LINK.exec(text);
  return {
    variant: 'linear',
    shortName: link ? link[1].trim() : null,
    teamKey: BOARD_TEAM.exec(text)?.[1] ?? null,
    projectUrl: link ? link[2] : null,
  };
}

// A Linear board whose short name and team key both parse. A board missing
// either is not silently treated as GitHub: the caller reports the Linear rules
// as stood down, because a rule that switched off reads exactly like a pass.
const usableLinear = (board) => board?.variant === 'linear'
  && typeof board.shortName === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(board.shortName)
  && typeof board.teamKey === 'string' && board.teamKey !== '';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `<short>-<N>`, as numbers. The trailing guard is the version-string case:
// `daftplate-1.10.0` is a release, not issue 1, and a dot followed by a digit is
// what tells them apart. A sentence ending `daftplate-357.` still reads as 357.
export function shortRefs(text, shortName) {
  const { masked } = maskFences(text);
  const re = new RegExp(`(?<![\\w./-])${escapeRegExp(shortName)}-(\\d+)(?![\\w-]|\\.\\d)`, 'g');
  const seen = new Set();
  for (const line of masked) {
    for (const m of line.matchAll(re)) seen.add(Number(m[1]));
  }
  return [...seen].sort((a, b) => a - b);
}

// Any `<TEAM>-<M>` at all, paired or not: under ADR 0014 the Linear key never
// appears in prose, so the old pair is as wrong as the bare key.
export function linearKeyRefs(text, teamKey) {
  const { masked } = maskFences(text);
  const re = new RegExp(`\\b${escapeRegExp(teamKey)}-\\d+\\b`, 'g');
  const seen = new Set();
  for (const line of masked) {
    for (const m of line.matchAll(re)) seen.add(m[0]);
  }
  return [...seen].sort();
}

export function unpairedLinearRefs(text) {
  const { masked } = maskFences(text);
  const seen = new Set();
  for (const line of masked) {
    const paired = new Set();
    for (const m of line.matchAll(PAIRED_REF)) paired.add(m.index + m[0].indexOf(m[1]));
    for (const m of line.matchAll(LINEAR_REF)) if (!paired.has(m.index)) seen.add(m[0]);
  }
  return [...seen].sort();
}

export function validate(promptText, context) {
  if (typeof promptText !== 'string') throw new TypeError('promptText must be a string');
  const ctx = context && typeof context === 'object' ? context : {};

  const { headings, found, outside, rawOutside } = readSections(promptText);
  const violations = [];
  checkStructure(headings, found, violations);

  const manifest = found.get('Read first');
  if (manifest) {
    checkManifest(
      manifest,
      typeof ctx.phaseContractPath === 'string' ? ctx.phaseContractPath : '',
      Array.isArray(ctx.existingPaths) ? new Set(ctx.existingPaths) : null,
      violations,
    );
  }

  const branch = found.get('Branch');
  if (branch) checkBranch(branch, ctx, violations);

  // Every line of the prompt, not only the six sections. The launch pad's own
  // `> Delete this file once #N is underway` note sits above `## Start here` by
  // construction, and a per-section scan never read it. Sectioned references
  // keep a real `section`, which the closing sort needs; the leftovers get
  // OUTSIDE_SECTION, whose -1 index sorts them ahead of all six.
  const regions = [
    { section: OUTSIDE_SECTION, body: outside },
    ...SECTIONS.map((name) => ({ section: name, body: found.get(name)?.body })),
  ].filter((r) => r.body !== undefined).map((r) => ({ section: r.section, text: r.body.join('\n') }));

  // The board decides which identifier rules apply. Only a Linear board whose
  // short name and team key both parse turns the ADR 0014 rules on; anything else
  // leaves the pre-ADR-0014 behaviour exactly as it was, which is the owner's
  // ruling that nothing changes outside the Linear variant.
  const board = ctx.board && typeof ctx.board === 'object' ? ctx.board : null;
  const linear = usableLinear(board) ? board : null;

  if (Array.isArray(ctx.openIssues)) {
    const open = new Set(ctx.openIssues.map(Number));
    for (const { section, text } of regions) {
      for (const n of issueRefs(text)) {
        if (!open.has(n)) {
          violations.push(violation(REFUSAL.ISSUE_CLOSED, section,
            `#${n} is not open; a prompt pointing at closed work sends the next session to re-do it`));
        }
      }
      // The ADR 0014 form is a GitHub number too, and the reason a prefixed
      // number was ever refused is that it was checked against nothing. Here it
      // is checked.
      if (linear) {
        for (const n of shortRefs(text, linear.shortName)) {
          if (!open.has(n)) {
            violations.push(violation(REFUSAL.ISSUE_CLOSED, section,
              `${linear.shortName}-${n} is not open; a prompt pointing at closed work sends the next session to re-do it`));
          }
        }
      }
    }
  }

  // No context key gates this one off a Linear board. The pairing is a property
  // of the text, so there is nothing for a caller to supply and nothing to stand
  // down. Under a Linear board issue-linear-key below replaces it, because ADR
  // 0014 refuses the pair as firmly as the bare key.
  if (!linear) {
    for (const { section, text } of regions) {
      for (const id of unpairedLinearRefs(text)) {
        violations.push(violation(REFUSAL.ISSUE_UNPAIRED, section,
          `${id} carries no #N half; §6.5.1 names an issue #N (FORGE-M), and a Linear id alone cannot be checked against GitHub issue state`));
      }
    }
  }

  if (linear) {
    for (const { section, text } of regions) {
      for (const n of issueRefs(text)) {
        violations.push(violation(REFUSAL.ISSUE_BARE, section,
          `#${n} is a bare GitHub number on a Linear-variant repo; §6.5.1 names it ${linear.shortName}-${n}, because a bare #N resolves against whatever repository the reader is standing in`));
      }
      for (const id of linearKeyRefs(text, linear.teamKey)) {
        violations.push(violation(REFUSAL.ISSUE_LINEAR_KEY, section,
          `${id} is a Linear key in prose; under ADR 0014 it never appears there — name the issue ${linear.shortName}-<N> by its GitHub number, and never compute one number from the other`));
      }
    }
  }

  // Nor this one, and for the same reason: the spelling is a property of the
  // text. It runs whether or not `openIssues` was supplied, which is the point —
  // the form it refuses is the one that made issue-closed go quiet.
  for (const { section, text } of regions) {
    for (const ref of unqualifiedRefs(text)) {
      const n = /\d+$/.exec(ref)[0];
      // Off a Linear board the message is byte-for-byte what it was before ADR
      // 0014, because the golden test holds non-Linear output to that.
      violations.push(violation(REFUSAL.ISSUE_UNQUALIFIED, section, linear
        ? `${ref} is no §6.5.1 spelling; write ${linear.shortName}-${n} for this repo's issue or owner/repo#${n} for another's, because a prefix before a # is checked against nothing`
        : `${ref} is neither §6.5.1 spelling; write #${n} for this repo's issue or owner/repo#${n} for another's, because a prefixed #N is checked against nothing`));
    }
  }

  // Nor this one — and over `rawBody`, so a fence exempts nothing. The regions
  // above are built from the masked bodies on purpose and cannot be reused.
  const rawRegions = [
    { section: OUTSIDE_SECTION, body: rawOutside },
    ...SECTIONS.map((name) => ({ section: name, body: found.get(name)?.rawBody })),
  ].filter((r) => r.body !== undefined).map((r) => ({ section: r.section, text: r.body.join('\n') }));

  for (const { section, text } of rawRegions) {
    for (const ref of closingKeywordRefs(text)) {
      violations.push(violation(REFUSAL.CLOSING_KEYWORD, section,
        `${ref} is a closing keyword beside a literal issue number; GitHub's parser ignores code spans, quoting and negation, so this closes the issue when the prompt is copied into a PR body — §6.5.1: break the token with an explicit + between the halves, or name the issue and describe the keyword in words`));
    }
  }

  const exit = found.get('Exit criteria');
  if (exit && !exit.hasFence && !backticked(exit.body.join('\n')).some((s) => /\s/.test(s))) {
    violations.push(violation(REFUSAL.EXIT_UNCHECKABLE, 'Exit criteria', 'no backticked or fenced command; a criterion nobody can run is an aspiration'));
  }

  const unknowns = found.get('Unknowns and risks');
  if (unknowns && !unknowns.body.some((line) => LIST_ITEM.test(line))) {
    violations.push(violation(REFUSAL.UNKNOWNS_EMPTY, 'Unknowns and risks', 'no list items; an empty section is not a claim of safety, so `- none` has to be typed'));
  }

  violations.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return { ok: violations.length === 0, violations };
}

const USAGE = 'usage: node validate-prompt.mjs <prompt-path> --branch <name> [--branches <a,b,c>] [--open-issues <1,2,3>] [--roadmap <path>]';

function readArgv(argv) {
  const rest = argv.slice(2);
  const opts = { path: null, branch: null, branches: [], openIssues: null, roadmap: null };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--branch') opts.branch = rest[++i] ?? null;
    else if (arg === '--branches') opts.branches = (rest[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--roadmap') opts.roadmap = rest[++i] ?? '';
    else if (arg === '--open-issues') opts.openIssues = (rest[++i] ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    else if (arg.startsWith('--')) return null;
    else if (opts.path === null) opts.path = arg;
    else return null;
  }
  // --branch is required, and an empty value is not a branch. Treating it as
  // optional stood branch-mismatch down and printed `clean` on a prompt naming
  // the wrong branch — the shell path giving a green light to the one failure
  // the skill exists to stop. --branches stays optional; it only disables
  // branch-unknown, which USAGE says out loud.
  if (opts.path === null || opts.branch === null || opts.branch === '') return null;
  return opts;
}

function main(argv) {
  const opts = readArgv(argv);
  if (!opts) {
    console.error(USAGE);
    return 2;
  }

  let text;
  try {
    text = readFileSync(opts.path, 'utf8');
  } catch (e) {
    console.error(`cannot read the prompt: ${e.message}`);
    return 2;
  }

  // A rule that stood down is a rule that reported nothing, which reads exactly
  // like a rule that passed. `--branch` was made required for that reason; the
  // issue and contract context cannot be, because supplying them would mean
  // calling `gh` and reading a plan, neither of which this file is allowed to
  // do. So the CLI names what it turned off instead of printing a bare `clean`.
  const stoodDown = [];
  if (opts.openIssues === null) stoodDown.push(['issue-closed', 'no --open-issues, so no issue state to compare against']);
  if (opts.branches.length === 0) stoodDown.push(['branch-unknown', 'no --branches, so no branch list to compare against']);
  // The board arrives by flag, never from the working directory: a verdict that
  // changed with the folder it was run from would be no verdict at all, and every
  // CLI test here runs from this repo's root, whose board is Linear. An explicit
  // path that cannot be read is a usage error, not a stand-down — the caller asked
  // for a board and did not get one.
  let board = null;
  if (opts.roadmap !== null) {
    if (opts.roadmap === '') {
      console.error(USAGE);
      return 2;
    }
    try {
      board = readBoard(readFileSync(opts.roadmap, 'utf8'));
    } catch (e) {
      console.error(`cannot read the roadmap: ${e.message}`);
      return 2;
    }
  }
  if (opts.roadmap === null) {
    stoodDown.push(['issue-bare', 'no --roadmap, so no board to say whether this repo is on the Linear variant']);
    stoodDown.push(['issue-linear-key', 'no --roadmap, so no board to say whether this repo is on the Linear variant']);
  } else if (board?.variant === 'linear' && !usableLinear(board)) {
    stoodDown.push(['issue-bare', 'the Board: line names Linear but its project link text or team key does not parse']);
    stoodDown.push(['issue-linear-key', 'the Board: line names Linear but its project link text or team key does not parse']);
  }
  stoodDown.push(['manifest-contract-first', 'the shell path supplies no phase contract; reach it through validate()']);
  for (const [rule, why] of stoodDown) console.error(`stood-down: ${rule} — ${why}`);

  const { found } = readSections(text);
  const manifest = found.get('Read first');
  const existingPaths = manifest
    ? readEntries(manifest.body).map((e) => e.path).filter((p) => p !== null && existsSync(p))
    : [];

  const result = validate(text, {
    branch: opts.branch,
    head: null,
    branches: opts.branches,
    phaseContractPath: '',
    existingPaths,
    openIssues: opts.openIssues,
    board,
  });
  for (const v of result.violations) console.error(`${v.rule}: ${v.section} — ${v.message}`);
  console.log(result.ok ? 'clean' : `${result.violations.length} violation(s)`);
  return result.ok ? 0 : 1;
}

export { main };

// Self-contained CLI entry — deliberately no scripts/lib/cli.mjs import, so the
// gate runs standalone from the installed skill directory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
