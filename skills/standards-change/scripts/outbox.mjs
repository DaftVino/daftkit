#!/usr/bin/env node
// The deviation outbox behind /standards-change. Queues a note saying which
// daftplate standard a repo deliberately broke and why; --flush turns one
// queued note into a daftplate ADR or a private GitHub issue.
//
// Notes queue locally under ~/.daftplate/outbox/ rather than going straight to
// GitHub because daftplate publishes a curated public export (ADR 0004) and a
// note names a private repo and the rule it broke.
//
// NOTHING HERE EVER REMOVES A FILE. A flush *moves* the note into flushed/,
// and only after the artifact exists, so a wrong flush is recoverable and a
// failed one leaves the note pending. A test asserts this against the source.
//
// Every import is a node builtin, deliberately. This file installs into
// ~/.claude/skills/standards-change/scripts/ (ADR 0002) and runs from repos
// that have no daftplate checkout, so importing scripts/lib/cli.mjs would
// ship a skill that throws on a missing module the moment anyone used it.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 1;

/**
 * Node's homedir(), never `~`, never $HOME, never %USERPROFILE%. Under Git Bash
 * on Windows $HOME and homedir() disagree, and homedir() is where every other
 * daftplate artifact lives. scripts/install-skills.mjs sets the precedent.
 */
export function defaultOutboxRoot() {
  return join(homedir(), '.daftplate', 'outbox');
}

export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// 2026-07-29T14:30:12.345Z -> 20260729T143012345Z. Sorts the queue by name.
function stamp(iso) {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T`
    + `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`;
}

// A repo that daftplate never scaffolded can still report a deviation, and a
// manifest somebody hand-edited into invalid JSON must not take the note down
// with it — both cases record null rather than throwing.
function readManifest(repoPath) {
  const path = join(repoPath, '.daftplate.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const filled = (value) => Boolean(value) && String(value).trim() !== '';

export function enqueue(outboxRoot, { repoPath, rule, reason, localAdr = null } = {}) {
  // Validated before mkdirSync: a refused note must not leave an empty outbox
  // behind, because an existing directory reads as "the queue is in use".
  if (!filled(rule)) throw new Error('refusing to enqueue: rule is required');
  if (!filled(reason)) throw new Error('refusing to enqueue: reason is required');

  const absolute = resolve(repoPath ?? process.cwd());
  const manifest = readManifest(absolute);
  const createdAt = new Date().toISOString();
  const id = randomUUID();

  // Only these fields. No project summary, no provenance tokens — a note is
  // evidence about one rule, not a copy of the repo's identity.
  const note = {
    schema: SCHEMA,
    id,
    createdAt,
    repository: basename(absolute),
    repositoryPath: absolute,
    profile: manifest?.profile ?? null,
    daftplate: manifest?.daftplate ?? null,
    rule: String(rule).trim(),
    reason: String(reason).trim(),
    localAdr: localAdr ?? null,
  };

  mkdirSync(outboxRoot, { recursive: true });
  const filename = `${stamp(createdAt)}--${note.repository}--${id}.json`;
  const path = join(outboxRoot, filename);
  // 'wx' fails rather than overwriting. randomUUID already makes a collision
  // implausible; this makes it impossible to lose a note to one.
  writeFileSync(path, `${JSON.stringify(note, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

  return { path, filename, note };
}

/**
 * Classify the outbox once, from one directory snapshot.
 *
 * `listPending()` filtered on `.endsWith('.json')`, so eleven hand-written
 * Markdown notes — queued before this tool existed, under the earlier convention
 * — sat in that exact directory while `--flush` reported `0 pending`. A queue
 * that under-reports is worse than one that errors: "nothing to do" and "eleven
 * notes I cannot parse" look identical, and the whole point of the outbox is
 * that a deviation reaches daftplate.
 *
 * Regular files only, and never a directory: `isFile()` is false for a symlink
 * too, so the existing traversal boundary is unchanged. Contents are never read
 * here — discovery is not selection, and parsing during listing would change the
 * existing malformed-JSON behaviour.
 */
export function inspectOutbox(outboxRoot) {
  const empty = { json: [], markdown: [], pending: [], unsupported: [] };
  if (!existsSync(outboxRoot)) return empty;

  const json = [];
  const markdown = [];
  const unsupported = [];
  for (const entry of readdirSync(outboxRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.json')) json.push(entry.name);
    else if (lower.endsWith('.md')) markdown.push(entry.name);
    else unsupported.push(entry.name);
  }
  const sorted = (a) => a.sort();
  return {
    json: sorted(json),
    markdown: sorted(markdown),
    pending: sorted([...json, ...markdown]),
    unsupported: sorted(unsupported),
  };
}

/** Pending note filenames, sorted. A missing outbox is empty, not an error. */
export function listPending(outboxRoot) {
  return inspectOutbox(outboxRoot).pending;
}

/** The first non-blank H1, or the filename stem. Never empty: a titleless issue
 *  is unfindable, and not every hand-written note has a heading. */
export function markdownTitle(text, filename) {
  const heading = text.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
  return heading ? heading.replace(/^#\s+/, '').trim() : filename.replace(/\.md$/i, '');
}

/** Deterministic identity for a note that never had an Outbox-ID.
 *
 *  Derived from the filename AND the original bytes, so a retry after a partial
 *  failure searches for the same value and finds the issue it already filed.
 *  A random id, or a search by title, would file the deviation twice — which is
 *  the failure the JSON path's Outbox-ID search already exists to prevent. */
export function legacyOutboxId(filename, text) {
  return createHash('sha256').update(filename).update('\0').update(text).digest('hex');
}

/** The issue body: the note verbatim, then the identity footer.
 *
 *  Verbatim and first, because the note is prose a human wrote and reordering or
 *  summarizing it loses the thing being escalated. The footer is appended to what
 *  GitHub receives only — the archived local file keeps the original bytes. */
export function markdownIssueBody(filename, text) {
  return `${text}\n\n---\n\nLegacy-Outbox-ID: ${legacyOutboxId(filename, text)}\n`
    + `Legacy-Outbox-File: ${filename}\n`;
}

/** Pure: the ADR body as a string, so it is testable without a filesystem. */
export function renderAdr(note, { number, decision, alternatives, consequences }) {
  const id = String(number).padStart(4, '0');
  const slug = slugify(decision);
  return `# ADR ${id}: ${decision}

<!-- File: docs/adr/${id}-${slug}.md — one page max. Never edited after acceptance; reversals are a new ADR. -->

**Status:** Proposed
**Date:** ${note.createdAt.slice(0, 10)}

## Context

The \`${note.repository}\` repository deliberately deviated from \`${note.rule}\`.

${note.reason}

Outbox-ID: ${note.id}

## Decision

${decision}

## Alternatives considered

${alternatives}

## Consequences

${consequences}
`;
}

export function issueTitle(note) {
  return `deviation: ${note.repository} breaks ${note.rule}`;
}

export function issueBody(note) {
  return `\`${note.repository}\` deliberately deviates from \`${note.rule}\`.

${note.reason}

- Repository path: \`${note.repositoryPath}\`
- Profile: ${note.profile ?? 'not scaffolded by daftplate'}
- Scaffolded with daftplate: ${note.daftplate ?? 'unknown'}
- Local ADR: ${note.localAdr ?? 'none'}
- Queued: ${note.createdAt}

Outbox-ID: ${note.id}
`;
}

// A runner may hand back a bare URL string or an object carrying one. The
// distinction matters because the URL is read BEFORE the note moves: the move
// is only licensed once GitHub has confirmed the artifact.
const urlOf = (result) => (typeof result === 'string' ? result : result?.url);

// The one place a note changes location. Move, never removal, and only ever
// after the caller has an artifact in hand.
function moveToFlushed(outboxRoot, filename) {
  const flushedDir = join(outboxRoot, 'flushed');
  mkdirSync(flushedDir, { recursive: true });
  const destination = join(flushedDir, filename);
  if (existsSync(destination)) {
    throw new Error(`refusing to flush ${filename}: a note of that name is already in flushed/; note left queued`);
  }
  renameSync(join(outboxRoot, filename), destination);
  return destination;
}

/**
 * With no filename: lists pending notes and touches nothing. There is
 * deliberately no "flush everything" path — one note, one decision.
 *
 * With a filename and a target: renders the artifact, then moves the note.
 */
export function flush(outboxRoot, filename, target) {
  if (filename === undefined || filename === null) return listPending(outboxRoot);

  // Membership in the listing is the path check: it admits exactly the files
  // the outbox itself holds, so `../secret.json` is refused before anything is
  // read rather than after it is parsed.
  if (!listPending(outboxRoot).includes(filename)) {
    throw new Error(`refusing to flush ${filename}: filename must name one pending note; note left queued`);
  }

  const raw = readFileSync(join(outboxRoot, filename), 'utf8');

  // Markdown is an OPAQUE upstream note: prose a human wrote before this tool
  // existed. It has no structured decision inputs, so it can only ever become an
  // issue — routing it through renderAdr() would publish a decision artifact
  // whose decision, alternatives and consequences nobody supplied.
  if (filename.toLowerCase().endsWith('.md')) {
    if (target?.as !== 'issue') {
      throw new Error(`refusing to flush ${filename}: a Markdown note can only flush as an issue, not an ADR; note left queued`);
    }
    const { repo, runner } = target;
    // Same order as the JSON path, and for the same reasons: privacy before any
    // network call, search before create.
    if (!runner.isPrivate(repo)) {
      throw new Error(`refusing to flush ${filename}: issue target is not private; note left queued`);
    }
    const id = legacyOutboxId(filename, raw);
    const existing = urlOf(runner.findIssue(repo, id));
    if (existing) {
      return {
        markdown: raw, issueUrl: existing, duplicate: true,
        flushedPath: moveToFlushed(outboxRoot, filename),
      };
    }
    const issueUrl = urlOf(runner.createIssue(
      repo, markdownTitle(raw, filename), markdownIssueBody(filename, raw),
    ));
    if (!issueUrl) {
      throw new Error(`refusing to flush ${filename}: issue creation returned no URL; note left queued`);
    }
    // Moved only after a URL exists, and moved byte-for-byte: the footer goes to
    // GitHub, never into the archived copy.
    return {
      markdown: raw, issueUrl, duplicate: false,
      flushedPath: moveToFlushed(outboxRoot, filename),
    };
  }

  let note;
  try {
    note = JSON.parse(raw);
  } catch {
    throw new Error(`refusing to flush ${filename}: pending note is not valid JSON; note left queued`);
  }

  if (target?.as === 'adr') {
    const {
      daftplateRoot, number, decision, alternatives, consequences,
    } = target;
    if (![decision, alternatives, consequences].every(filled)) {
      throw new Error(`refusing to flush ${filename}: ADR requires decision, alternatives and consequences; note left queued`);
    }
    const id = String(number).padStart(4, '0');
    const adrPath = join(daftplateRoot, 'docs', 'adr', `${id}-${slugify(decision)}.md`);
    if (existsSync(adrPath)) {
      throw new Error(`refusing to flush ${filename}: ADR already exists; note left queued`);
    }
    mkdirSync(dirname(adrPath), { recursive: true });
    writeFileSync(adrPath, renderAdr(note, {
      number, decision, alternatives, consequences,
    }), { encoding: 'utf8', flag: 'wx' });

    return { note, artifactPath: adrPath, flushedPath: moveToFlushed(outboxRoot, filename) };
  }

  if (target?.as === 'issue') {
    const { repo, runner } = target;
    // Privacy first, before any search or creation: a note names a private repo
    // and why it broke a rule, and that must not reach a public tracker.
    if (!runner.isPrivate(repo)) {
      throw new Error(`refusing to flush ${filename}: issue target is not private; note left queued`);
    }

    // Search before create, so a retry after a partial failure is idempotent
    // rather than filing the same deviation twice.
    const existing = urlOf(runner.findIssue(repo, note.id));
    if (existing) {
      return {
        note, issueUrl: existing, duplicate: true, flushedPath: moveToFlushed(outboxRoot, filename),
      };
    }

    const issueUrl = urlOf(runner.createIssue(repo, issueTitle(note), issueBody(note)));
    if (!issueUrl) {
      throw new Error(`refusing to flush ${filename}: issue creation returned no URL; note left queued`);
    }
    return {
      note, issueUrl, duplicate: false, flushedPath: moveToFlushed(outboxRoot, filename),
    };
  }

  throw new Error(`refusing to flush ${filename}: --as must be 'adr' or 'issue'; note left queued`);
}

/**
 * No `shell: true`, and the reason is a command injection rather than a style
 * preference. It does not escape an args array; it concatenates it into a command
 * line the shell then re-parses, so shell metacharacters in a note's own fields
 * execute. `rule` is operator input, it flows into issueTitle() and on into the
 * `gh issue create --title` argument, so a queued note carrying
 * `x & echo y> victim & rem` truncated `victim` when it was flushed — measured,
 * and a direct breach of "nothing deletes what it did not create". The same hole
 * let `--repo` forge `true` on stdout and walk straight through the is-it-private
 * gate that exists to keep a private repo's deviations off a public tracker.
 *
 * It also silently corrupted every argument holding a space. Proven against gh
 * 2.96.0: `--jq '.[0].url // empty'` arrived as three arguments and gh exited 2
 * with `unknown arguments ["//" "empty"]`, which findIssue's non-zero branch read
 * as "no existing issue" — so the Outbox-ID search failed open and a retry after
 * a partial failure filed the deviation twice.
 *
 * `gh` resolves without a shell on this platform; scripts/code-map.mjs:156
 * records the same rule for git. Exported so a test can prove a spaced argument
 * survives, because every other test here injects a fake runner and would not
 * notice this path at all.
 */
export function runCommand(bin, args, options = {}) {
  return spawnSync(bin, args, { encoding: 'utf8', ...options });
}

const gh = (args) => runCommand('gh', args);

/** The real GitHub runner. Used only by the CLI; tests inject their own. */
export const ghRunner = {
  isPrivate(repo) {
    const result = gh(['repo', 'view', repo, '--json', 'isPrivate', '--jq', '.isPrivate']);
    if (result.status !== 0) throw new Error(`gh repo view ${repo} failed: ${result.stderr?.trim()}`);
    return result.stdout.trim() === 'true';
  },
  findIssue(repo, outboxId) {
    const result = gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', outboxId, '--json', 'url', '--jq', '.[0].url // empty']);
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  },
  createIssue(repo, title, body) {
    const result = runCommand('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body-file', '-'], { input: body });
    if (result.status !== 0) throw new Error(`gh issue create failed: ${result.stderr?.trim()}`);
    return result.stdout.trim();
  },
};

const flag = (args, key) => {
  const hit = args.find((a) => a.startsWith(`--${key}=`));
  return hit === undefined ? undefined : hit.slice(key.length + 3);
};

function main(argv) {
  const args = argv.slice(2);
  const outboxRoot = flag(args, 'outbox') ?? defaultOutboxRoot();

  try {
    if (args.includes('--flush')) {
      const filename = flag(args, 'note');
      if (!filename) {
        const { pending, json, markdown, unsupported } = inspectOutbox(outboxRoot);
        for (const name of pending) console.log(name);
        // Subtotals, because "11 pending" and "11 pending, 0 of which this tool
        // can flush" are different situations and the first hides the second.
        console.log(
          `${pending.length} pending note(s) in ${outboxRoot}`
          + ` (${json.length} JSON, ${markdown.length} Markdown)`,
        );
        console.error('name one with --note=<filename> --as=adr|issue to flush it');
        if (unsupported.length) {
          // Reported and left alone. Nothing here deletes, and a file this tool
          // cannot read is not evidence that it should be removed.
          console.error(`${unsupported.length} file(s) in a format this tool cannot flush, left untouched:`);
          for (const name of unsupported) console.error(`  ${name}`);
        }
        // Non-zero ONLY for the unreadable ones. Pending work is the queue doing
        // its job; a file the queue cannot see is the queue failing at it.
        return unsupported.length ? 1 : 0;
      }
      const result = flush(outboxRoot, filename, {
        as: flag(args, 'as'),
        daftplateRoot: flag(args, 'daftplate'),
        number: flag(args, 'number'),
        decision: flag(args, 'decision'),
        alternatives: flag(args, 'alternatives'),
        consequences: flag(args, 'consequences'),
        repo: flag(args, 'repo'),
        runner: ghRunner,
      });
      console.log(result.issueUrl ?? result.artifactPath);
      console.log(`moved to ${result.flushedPath}`);
      if (result.duplicate) console.error('an issue with this Outbox-ID already existed; nothing was created');
      return 0;
    }

    const [repoPath] = args.filter((a) => !a.startsWith('--'));
    const result = enqueue(outboxRoot, {
      repoPath,
      rule: flag(args, 'rule'),
      reason: flag(args, 'reason'),
      localAdr: flag(args, 'adr') ?? null,
    });
    console.log(result.path);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

export { main };
if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
