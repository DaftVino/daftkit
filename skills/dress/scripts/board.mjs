#!/usr/bin/env node
// The read-only half of /dress: which board this repo is on, which Linear issue a
// GitHub issue synced to, and what priority its filer chose. It never writes to
// Linear — the session does that with its own Linear tools, after reading this.
//
// The skip rule is the contract that matters most (§6.5.1, ADR 0014): a repo
// whose ROADMAP.md does not declare a Linear board gets NO output, NO `gh` call
// and NO prompt. The variant check therefore runs before anything touches the
// network, and a test runs this with no `gh` on PATH to prove it.
//
// Self-contained by design, like continuum's validator: it imports nothing
// outside node:*, so it runs standalone from ~/.claude/skills/dress/. Its
// readBoard is the third copy of one parse; a parity test in daftplate holds the
// three to one answer.
//
// It also resolves Linear keys to GitHub issues for the launch-pad validator
// (`--resolve`, ADR 0015), by the same linkback route and under the same skip.
//
// Usage: node board.mjs <issue-number> [--wait]
//        node board.mjs --resolve <KEY>...
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The author Linear's GitHub integration posts its linkback comment as. */
export const LINKBACK_AUTHOR = 'linear-code[bot]';

/** The sync lands in about two minutes, measured. Twenty seconds, nine times
 *  after the first look, bounds the wait at three: long enough for the normal
 *  case, short enough that a stuck sync never holds the session hostage. */
export const WAIT = { attempts: 9, intervalMs: 20_000 };

/** §6.5.1's priority vocabulary, as both issue templates' dropdown spells it. */
export const PRIORITY = { Urgent: 1, High: 2, Medium: 3, Low: 4 };

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
  const link = /\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text);
  return {
    variant: 'linear',
    shortName: link ? link[1].trim() : null,
    teamKey: /\bteam\s+`([A-Z][A-Z0-9]*)`/.exec(text)?.[1] ?? null,
    projectUrl: link ? link[2] : null,
  };
}

/**
 * The Linear key from the linkback comment, or null. Only Linear's own bot is
 * believed: a person pasting a board link into a comment names an issue, but not
 * necessarily this one's twin. Never computed from the GitHub number.
 */
export function linearKeyFromComments(comments, teamKey) {
  if (!Array.isArray(comments) || !teamKey) return null;
  const re = new RegExp(`linear\\.app/[^/\\s]+/issue/(${teamKey}-\\d+)\\b`);
  for (const c of comments) {
    if (c?.user?.login !== LINKBACK_AUTHOR) continue;
    const m = re.exec(c.body ?? '');
    if (m) return m[1];
  }
  return null;
}

/**
 * Linear's priority (1 Urgent … 4 Low) from the issue template's Priority
 * dropdown, or null. Null is the honest answer for a body with no such section —
 * an outbox-filed issue, a freehand one — and the skill then asks the user.
 * Priority is a judgement, so this never supplies a default.
 */
export function priorityFromBody(body) {
  if (typeof body !== 'string') return null;
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => /^#{2,4}\s+Priority\s*$/.test(l.trim()));
  if (at === -1) return null;
  const value = lines.slice(at + 1).find((l) => l.trim() !== '')?.trim() ?? '';
  const word = /^([A-Z][a-z]+)\b/.exec(value)?.[1];
  return word && Object.hasOwn(PRIORITY, word) ? PRIORITY[word] : null;
}

/**
 * Look for the linkback, then look again every `intervalMs`, at most `attempts`
 * more times. `look` and `sleep` are passed in so the bound is a property of this
 * function, testable without a clock or a network.
 */
export async function waitForLinkback(look, { attempts = WAIT.attempts, intervalMs = WAIT.intervalMs, sleep } = {}) {
  let key = await look();
  for (let i = 0; key === null && i < attempts; i += 1) {
    await sleep(intervalMs);
    key = await look();
  }
  return key;
}

/** Linear-variant repos close-and-archive at about 200 issues (§6.5.1), so an
 *  open list this long is complete in practice. A list that reaches it may have
 *  been cut off, and a resolver that read half the open issues would report a
 *  real open key as unresolved, so the whole map is declared unavailable. */
export const OPEN_LIMIT = 1000;

/**
 * Which GitHub issue each Linear key names, read from the linkback comments the
 * sync posts (ADR 0015 ruling 6). It needs no Linear API key: the route is the
 * one dressing already trusts, and it is never computed from a number.
 *
 * Open issues are listed and every one's linkback is read. Closed issues are too
 * many to read, so each key is searched for among them, and a hit counts only if
 * that issue's own linkback carries the key: a search hit says the text appears
 * somewhere, not that this issue is the key's twin.
 *
 * Returns `{ available, keys: { KEY: { status, numbers } } }`, where status is
 * `open` or `closed` for exactly one match, `ambiguous` for two or more, and
 * `unresolved` for none. Any `gh` failure makes the whole map unavailable rather
 * than partial, because a partial map reads a real key as unresolved.
 *
 * `gh(args)` returns stdout and throws on failure, so every status is testable
 * without a network.
 */
export function resolveLinearKeys(keys, { repo, teamKey, gh: run }) {
  const own = new RegExp(`^${teamKey}-\\d+$`);
  const wanted = [...new Set(keys)].filter((k) => own.test(k)).sort();
  const unavailable = { available: false, keys: {} };
  try {
    const comments = new Map();
    const keyOf = (n) => {
      if (!comments.has(n)) {
        comments.set(n, linearKeyFromComments(JSON.parse(run(['api', `repos/${repo}/issues/${n}/comments`])), teamKey));
      }
      return comments.get(n);
    };

    const open = JSON.parse(run(['issue', 'list', '--repo', repo, '--state', 'open',
      '--limit', String(OPEN_LIMIT), '--json', 'number'])).map((i) => i.number);
    if (open.length >= OPEN_LIMIT) return unavailable;
    const openByKey = new Map();
    for (const n of open) {
      const k = keyOf(n);
      if (k) openByKey.set(k, [...(openByKey.get(k) ?? []), n]);
    }

    const out = {};
    for (const key of wanted) {
      const hits = JSON.parse(run(['search', 'issues', key, '--repo', repo, '--state', 'closed',
        '--json', 'number', '--limit', '100'])).map((i) => i.number);
      const closed = hits.filter((n) => keyOf(n) === key);
      const opened = openByKey.get(key) ?? [];
      const numbers = [...new Set([...opened, ...closed])].sort((a, b) => a - b);
      const status = numbers.length >= 2 ? 'ambiguous'
        : opened.length === 1 ? 'open'
          : closed.length === 1 ? 'closed'
            : 'unresolved';
      out[key] = { status, numbers };
    }
    return { available: true, keys: out };
  } catch {
    return unavailable;
  }
}

/** The repo root: git's answer when git is there, else the nearest `.git` above.
 *  A run from a subdirectory must not read "no ROADMAP.md" and skip a repo that
 *  is on the Linear variant. */
export function findRoot(start) {
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' });
  if (git.status === 0 && git.stdout.trim()) return resolve(git.stdout.trim());
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(start);
    dir = up;
  }
}

function gh(args, cwd) {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`gh could not run: ${r.error.code ?? r.error.message}`);
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1] ?? ''} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
}

const USAGE = 'usage: node board.mjs <issue-number> [--wait] | node board.mjs --resolve <KEY>...';

function readLinearBoard(cwd) {
  const root = findRoot(cwd);
  const roadmap = join(root, 'ROADMAP.md');
  return { root, board: existsSync(roadmap) ? readBoard(readFileSync(roadmap, 'utf8')) : null };
}

// `--resolve`: the key map /continuum hands the launch-pad validator. Under the
// same skip rule as dressing: no Linear board, no output and no `gh` call.
function resolveMain(keys, cwd) {
  if (keys.length === 0 || keys.some((k) => !/^[A-Z][A-Z0-9]*-\d+$/.test(k))) {
    console.error(USAGE);
    return 2;
  }
  const { root, board } = readLinearBoard(cwd);
  if (board?.variant !== 'linear') return 0;
  let result = { available: false, keys: {} };
  if (board.teamKey) {
    try {
      const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root).trim();
      result = resolveLinearKeys(keys, { repo, teamKey: board.teamKey, gh: (args) => gh(args, root) });
    } catch {
      // gh missing or failing: the map is unavailable, which the validator
      // reports as "could not verify". Never an error that fails the caller.
    }
  }
  console.log(JSON.stringify(result));
  return 0;
}

export async function main(argv, { cwd = process.cwd(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const rest = argv.slice(2);
  if (rest[0] === '--resolve') return resolveMain(rest.slice(1), cwd);
  if (rest.includes('--resolve')) {
    console.error(USAGE);
    return 2;
  }
  const wait = rest.includes('--wait');
  const positional = rest.filter((a) => !a.startsWith('--'));
  const number = Number(positional[0]);
  if (positional.length !== 1 || !Number.isInteger(number) || number <= 0 || rest.some((a) => a.startsWith('--') && a !== '--wait')) {
    console.error(USAGE);
    return 2;
  }

  const { root, board } = readLinearBoard(cwd);

  // The skip. Silent, and before any `gh` call: a repo not on the Linear variant
  // sees no behaviour change at all.
  if (board?.variant !== 'linear') return 0;

  const out = {
    variant: 'linear', shortName: board.shortName, teamKey: board.teamKey, projectUrl: board.projectUrl,
    repo: null, number, attachmentUrl: null, linearKey: null, priority: null, error: null,
  };
  const print = () => { console.log(JSON.stringify(out)); return 0; };

  if (!board.shortName || !board.teamKey) {
    out.error = 'the Board: line names Linear but its project link text or team key does not parse';
    return print();
  }

  try {
    out.repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root).trim();
    out.attachmentUrl = `https://github.com/${out.repo}/issues/${number}`;
    out.priority = priorityFromBody(gh(['issue', 'view', String(number), '--json', 'body', '-q', '.body'], root));
    const look = () => linearKeyFromComments(
      JSON.parse(gh(['api', `repos/${out.repo}/issues/${number}/comments`], root)), board.teamKey);
    out.linearKey = wait ? await waitForLinkback(look, { sleep }) : look();
    if (out.linearKey === null) {
      out.error = 'no Linear linkback yet (sync pending, or imported before the integration posted one)';
    }
  } catch (e) {
    out.error = e.message;
  }
  return print();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => process.exit(code));
}
