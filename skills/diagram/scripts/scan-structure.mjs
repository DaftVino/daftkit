#!/usr/bin/env node
// Zero-dependency structure scanner: a directory -> a `structure` MODEL for
// to-excalidraw.mjs (the frames-and-cards working board).
//
// Discovery is git-aware: `git ls-files --cached --others --exclude-standard`
// lists tracked + untracked files while .gitignore rules apply for free. Outside
// a repo (or without git) it falls back to a walk with a fixed ignore list.
//
// Self-contained by design: imports nothing outside this directory, so it runs
// standalone once the /diagram skill is installed to ~/.claude/skills/diagram/.
//
// Usage: node scan-structure.mjs <dir> [--depth 3] [--max-files 25] [--name <label>] [--out <path>]
import { readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DEPTH = 3;      // folder levels below the root that render as frames
const DEFAULT_MAX_FILES = 25; // direct files per folder before they collapse to a summary card

// Walk-fallback ignores only. In git mode .gitignore already handles these.
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.venv', '__pycache__']);

function gitList(dir) {
  const run = spawnSync('git', ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  return run.stdout.split('\n').filter(Boolean);
}

function walkList(dir, prefix = '') {
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) paths.push(...walkList(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
    } else if (entry.isFile()) {
      paths.push(`${prefix}${entry.name}`);
    }
  }
  return paths;
}

export function buildTree(paths, rootName) {
  const root = { name: rootName, dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(parts[parts.length - 1]);
  }
  const finish = (node) => ({
    name: node.name,
    dirs: [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(finish),
    files: [...node.files].sort((a, b) => a.localeCompare(b)),
  });
  return finish(root);
}

const countFiles = (node) => node.files.length + node.dirs.reduce((sum, d) => sum + countFiles(d), 0);

export function collapseTree(tree, { depth = DEFAULT_DEPTH, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const visit = (node, level) => {
    const out = { name: node.name, dirs: [], files: node.files };
    if (node.files.length > maxFiles) {
      out.files = [];
      out.filesCollapsed = node.files.length;
    }
    for (const d of node.dirs) {
      if (level + 1 > depth) out.dirs.push({ name: d.name, collapsed: true, fileCount: countFiles(d) });
      else out.dirs.push(visit(d, level + 1));
    }
    return out;
  };
  return visit(tree, 0);
}

export function scan(dir, { depth, maxFiles, name } = {}) {
  const target = resolve(dir);
  const listed = gitList(target);
  if (!listed) {
    console.error(`note: ${target} is not a git repository — walk fallback in effect `
      + '(fixed ignore list only; .gitignore rules do not apply)');
  }
  const paths = listed ?? walkList(target);
  const rootName = name || basename(target);
  return {
    type: 'structure',
    root: rootName,
    tree: collapseTree(buildTree(paths, rootName), { depth, maxFiles }),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (flag) => {
    const at = args.indexOf(flag);
    return at !== -1 ? args[at + 1] : undefined;
  };
  const flagIdx = new Set();
  for (const flag of ['--depth', '--max-files', '--name', '--out']) {
    const at = args.indexOf(flag);
    if (at !== -1) { flagIdx.add(at); flagIdx.add(at + 1); }
  }
  const dir = args.find((a, i) => !flagIdx.has(i) && !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node scan-structure.mjs <dir> [--depth 3] [--max-files 25] [--name <label>] [--out <path>]');
    return 2;
  }
  let model;
  try {
    model = scan(dir, {
      depth: opt('--depth') ? Number(opt('--depth')) : undefined,
      maxFiles: opt('--max-files') ? Number(opt('--max-files')) : undefined,
      name: opt('--name'),
    });
  } catch (err) {
    console.error(`cannot scan ${dir}: ${err.message}`);
    return 1;
  }
  const json = `${JSON.stringify(model, null, 2)}\n`;
  const out = opt('--out');
  if (out) {
    writeFileSync(out, json, 'utf8');
    console.error(`wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

export { main };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
