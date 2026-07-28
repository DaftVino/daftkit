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
import { readFileSync } from 'node:fs';
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
  BRANCH_UNNAMED: 'branch-unnamed',
  BRANCH_MISMATCH: 'branch-mismatch',
  BRANCH_UNKNOWN: 'branch-unknown',
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
  for (const [i, heading] of headings.entries()) {
    if (!SECTIONS.includes(heading.name)) continue;
    const end = i + 1 < headings.length ? headings[i + 1].line : masked.length;
    const range = { from: heading.line + 1, to: end };
    const section = {
      ...heading,
      body: masked.slice(range.from, range.to),
      rawBody: raw.slice(range.from, range.to),
      hasFence: fenced.slice(range.from, range.to).some(Boolean),
    };
    if (found.has(heading.name)) found.get(heading.name).duplicates += 1;
    else found.set(heading.name, { ...section, duplicates: 0 });
  }
  return { headings, found };
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

function checkManifest(section, contractPath, out) {
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

export function validate(promptText, context) {
  if (typeof promptText !== 'string') throw new TypeError('promptText must be a string');
  const ctx = context && typeof context === 'object' ? context : {};

  const { headings, found } = readSections(promptText);
  const violations = [];
  checkStructure(headings, found, violations);

  const manifest = found.get('Read first');
  if (manifest) checkManifest(manifest, typeof ctx.phaseContractPath === 'string' ? ctx.phaseContractPath : '', violations);

  const branch = found.get('Branch');
  if (branch) checkBranch(branch, ctx, violations);

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

const USAGE = 'usage: node validate-prompt.mjs <prompt-path> --branch <name> [--branches <a,b,c>]';

function readArgv(argv) {
  const rest = argv.slice(2);
  const opts = { path: null, branch: null, branches: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--branch') opts.branch = rest[++i] ?? null;
    else if (arg === '--branches') opts.branches = (rest[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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

  const result = validate(text, { branch: opts.branch, head: null, branches: opts.branches, phaseContractPath: '' });
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
