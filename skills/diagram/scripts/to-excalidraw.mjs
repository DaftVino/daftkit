#!/usr/bin/env node
// Zero-dependency converter: a diagram MODEL -> { .excalidraw, .mmd }.
//
// Self-contained by design: imports nothing outside this file, so it runs
// standalone once the /diagram skill is installed to ~/.claude/skills/diagram/.
// Deterministic: element ids and Excalidraw seeds are counter-derived, so an
// unchanged model yields byte-identical output (diffable, testable).
//
// Usage: node to-excalidraw.mjs <model.json> <out-base> [--type <flowchart|er|sequence>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED = {
  flowchart: ['nodes'],
  er: ['entities'],
  sequence: ['participants', 'messages'],
  structure: [],
};

export function validateModel(model) {
  if (!model || typeof model !== 'object') throw new Error('model must be an object');
  const req = REQUIRED[model.type];
  if (!req) throw new Error(`unknown diagram type: ${model.type}`);
  for (const key of req) {
    if (!Array.isArray(model[key])) throw new Error(`a ${model.type} model needs an array "${key}"`);
  }
  if (model.type === 'structure') {
    if (!model.tree || typeof model.tree !== 'object' || typeof model.tree.name !== 'string') {
      throw new Error('a structure model needs a "tree" object with a name');
    }
    if (model.relations !== undefined && !Array.isArray(model.relations)) {
      throw new Error('structure "relations" must be an array of {from, to}');
    }
  }
  return model;
}

// Text/box sizing. Boxes are sized to fit their (wrapped) label so multi-line or
// long content never overflows — the original failure that made real diagrams
// unreadable. Virgil (fontFamily 1) at 16px is ~9px/char.
const FONT = 16;
const LINE_H = Math.round(FONT * 1.25);   // 20
const CHAR_W = 9;
const PAD_X = 14;
const PAD_Y = 12;
const MIN_W = 120;
const MAX_W = 300;
const GAP = 60;                            // space between boxes within a rank
const RANK_GAP = 110;                       // space between ranks (gives edges room)

// Fit a box to a (possibly multi-line, possibly long) label: long lines wrap to
// the max content width, and the height counts the wrapped lines so the container
// is always tall enough (otherwise Excalidraw grows it and boxes overlap).
function measureBox(labelText) {
  const raw = String(labelText ?? '').split('\n');
  const longest = Math.max(1, ...raw.map((l) => l.length));
  const contentW = Math.min(MAX_W - 2 * PAD_X, Math.max(MIN_W - 2 * PAD_X, longest * CHAR_W));
  let wrapped = 0;
  for (const l of raw) wrapped += Math.max(1, Math.ceil((l.length * CHAR_W) / contentW));
  return { w: contentW + 2 * PAD_X, h: Math.max(44, wrapped * LINE_H + 2 * PAD_Y) };
}

// Where a ray from a box centre toward (tx,ty) exits the box — a clean arrow
// anchor on the edge facing the other box, for any relative position.
function edgePoint(box, tx, ty) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx !== 0 ? (box.width / 2) / Math.abs(dx) : Infinity,
    dy !== 0 ? (box.height / 2) / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// The shortest arrow Excalidraw will keep. Two boxes dragged flush together (or
// on top of each other) share their facing edge point, and a zero-length arrow
// is silently DISCARDED by the app on load — the relation would vanish from the
// board. Fall back to the centre-to-centre segment, then to a short stub.
const MIN_ARROW = 2;
function edgeSegment(a, b) {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const start = edgePoint(a, bc.x, bc.y);
  const end = edgePoint(b, ac.x, ac.y);
  if (Math.hypot(end.x - start.x, end.y - start.y) >= MIN_ARROW) return { start, end };
  if (Math.hypot(bc.x - ac.x, bc.y - ac.y) >= MIN_ARROW) return { start: ac, end: bc };
  return { start: ac, end: { x: bc.x, y: bc.y + MIN_ARROW } };
}

// --- the deterministic Excalidraw element factory ------------------------------

export function newFactory() {
  let n = 0;
  const base = (type, { x, y, w, h }) => {
    const seed = n;
    const el = {
      id: `el-${n}`, type, x, y, width: w, height: h, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
      strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
      groupIds: [], frameId: null, roundness: null, seed, version: 1,
      versionNonce: seed, isDeleted: false, boundElements: [], updated: 1,
      link: null, locked: false, index: null,
    };
    n += 1;
    return el;
  };

  const label = (text, { x, y, w, h, containerId, fontSize = 20 }) => {
    const t = base('text', { x, y, w, h });
    return Object.assign(t, {
      text: String(text), originalText: String(text), fontSize, fontFamily: 1,
      textAlign: 'center', verticalAlign: 'middle', containerId,
      autoResize: true, lineHeight: 1.25,
    });
  };

  return {
    rect({ x, y, w, h, label: labelText, detail, backgroundColor, strokeStyle, fontSize }) {
      const box = base('rectangle', { x, y, w, h });
      box.roundness = { type: 3 };
      if (backgroundColor) box.backgroundColor = backgroundColor;
      if (strokeStyle) box.strokeStyle = strokeStyle;
      // Bound text fills the box interior; Excalidraw wraps and centres it, and
      // the box was sized (measureBox) to hold the wrapped result.
      const text = label(labelText ?? '', {
        x: x + PAD_X, y: y + PAD_Y, w: w - 2 * PAD_X, h: h - 2 * PAD_Y,
        containerId: box.id, fontSize: fontSize ?? FONT,
      });
      box.boundElements = [{ type: 'text', id: text.id }];
      if (!detail) return { box, text };
      // A muted secondary line at the card bottom. It cannot be part of the
      // bound label (one style per text element), so it is a free text grouped
      // with the card — dragging either moves both.
      text.verticalAlign = 'top';
      const dt = label(detail, {
        x: x + 8, y: y + h - 20, w: w - 16, h: 14, containerId: null, fontSize: 11,
      });
      dt.textAlign = 'left';
      dt.verticalAlign = 'top';
      dt.strokeColor = '#868e96';
      const gid = `g-${box.id}`;
      box.groupIds = [gid];
      dt.groupIds = [gid];
      return { box, text, detail: dt };
    },

    // A folder frame. Excalidraw renders the name above the top edge; children
    // reference it via frameId and move with it.
    frame({ x, y, w, h, name }) {
      const el = base('frame', { x, y, w, h });
      el.strokeColor = '#bbb';
      el.roughness = 0;
      el.name = String(name);
      return el;
    },

    // A straight arrow from `start` to `end`. When `from`/`to` container elements
    // are given, it binds to them (legacy focus/gap shape) and they reciprocally
    // list it; omit them (e.g. sequence messages between lifelines) for a free arrow.
    arrow({ from, to, start, end, label: labelText }) {
      const arr = base('arrow', { x: start.x, y: start.y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) });
      arr.roundness = { type: 2 };
      arr.points = [[0, 0], [end.x - start.x, end.y - start.y]];   // local, starts at [0,0]
      arr.startArrowhead = null;
      arr.endArrowhead = 'arrow';
      arr.elbowed = false;
      arr.startBinding = from ? { elementId: from.id, focus: 0, gap: 4 } : null;
      arr.endBinding = to ? { elementId: to.id, focus: 0, gap: 4 } : null;
      if (from) from.boundElements.push({ type: 'arrow', id: arr.id });
      if (to) to.boundElements.push({ type: 'arrow', id: arr.id });
      const elements = [arr];
      if (labelText) {
        const lw = Math.max(40, String(labelText).length * 8 + 8);
        const mid = { x: start.x + (end.x - start.x) / 2 - lw / 2, y: start.y + (end.y - start.y) / 2 - 11 };
        const lt = label(labelText, { x: mid.x, y: mid.y, w: lw, h: 22, containerId: arr.id, fontSize: 14 });
        arr.boundElements.push({ type: 'text', id: lt.id });
        elements.push(lt);
      }
      return { arrow: arr, elements };
    },

    line({ x, y, points }) {
      const last = points[points.length - 1];
      const el = base('line', { x, y, w: Math.abs(last[0]), h: Math.abs(last[1]) });
      el.points = points;
      el.startArrowhead = null;
      el.endArrowhead = null;
      el.startBinding = null;
      el.endBinding = null;
      el.polygon = false;
      return el;
    },
  };
}

// --- Mermaid emitter -----------------------------------------------------------

const escLabel = (s) => String(s).replace(/"/g, "'");

export function toMermaid(model) {
  validateModel(model);
  if (model.type === 'flowchart') return mermaidFlowchart(model);
  if (model.type === 'er') return mermaidEr(model);
  if (model.type === 'sequence') return mermaidSequence(model);
  if (model.type === 'structure') return mermaidStructure(model);
  throw new Error(`toMermaid: unsupported type ${model.type}`);
}

// The structure tree as nested subgraphs: the clean read-only view of the board.
// Cards keyed by root-relative path (or explicit id) so relations render as edges.
function mermaidStructure(m) {
  const lines = ['flowchart TB'];
  let s = 0;
  let n = 0;
  const key = new Map();
  const reg = (mid, ...keys) => { for (const k of keys) if (k != null) key.set(k, mid); };
  const leaf = (indent, label, ...keys) => {
    lines.push(`${indent}n${n}["${escLabel(label)}"]`);
    reg(`n${n}`, ...keys);
    n += 1;
  };
  const visit = (node, indent, path) => {
    const sid = `s${s++}`;
    reg(sid, path || node.name);
    lines.push(`${indent}subgraph ${sid}["${escLabel(node.name)}"]`);
    for (const d of node.dirs ?? []) {
      const p = path ? `${path}/${d.name}` : d.name;
      if (d.collapsed) leaf(`${indent}  `, `${d.name}/ (${d.fileCount} files)`, p);
      else if (d.card) leaf(`${indent}  `, d.label ?? d.name, p, d.id);
      else visit(d, `${indent}  `, p);
    }
    for (const file of node.files ?? []) {
      const fd = typeof file === 'string' ? { name: file } : file;
      const p = path ? `${path}/${fd.name ?? fd.label}` : (fd.name ?? fd.label);
      leaf(`${indent}  `, fd.label ?? fd.name, p, fd.id);
    }
    if (node.filesCollapsed) leaf(`${indent}  `, `(${node.filesCollapsed} files)`);
    lines.push(`${indent}end`);
  };
  visit(m.tree, '  ', '');
  for (const r of normalizeRelations(m)) {
    const a = key.get(r.from);
    const b = key.get(r.to);
    if (a && b) lines.push(r.label ? `  ${a} -->|${escLabel(r.label)}| ${b}` : `  ${a} --> ${b}`);
  }
  return lines.join('\n');
}

function mermaidSequence(m) {
  const lines = ['sequenceDiagram'];
  for (const p of m.participants) lines.push(`  participant ${p.id} as ${p.label}`);
  for (const msg of [...m.messages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    lines.push(`  ${msg.from}->>${msg.to}: ${escLabel(msg.label ?? '')}`);
  }
  return lines.join('\n');
}

const CARD_SYMBOL = {
  '1..1': '||--||', '1': '||--||',
  '1..N': '||--o{', '1..*': '||--o{',
  '0..N': '|o--o{', '0..*': '|o--o{',
  'N..N': '}o--o{', '*..*': '}o--o{',
};
const cardSymbol = (c) => CARD_SYMBOL[c] ?? '||--o{';

function mermaidEr(m) {
  const lines = ['erDiagram'];
  for (const e of m.entities) {
    if (e.attributes?.length) {
      lines.push(`  ${e.name} {`);
      for (const a of e.attributes) {
        const parts = [a.type ?? 'string', a.name];
        if (a.key) parts.push(a.key);
        lines.push(`    ${parts.join(' ')}`);
      }
      lines.push('  }');
    } else {
      lines.push(`  ${e.name}`);
    }
  }
  for (const r of m.relations ?? []) {
    lines.push(`  ${r.from} ${cardSymbol(r.cardinality)} ${r.to} : "${escLabel(r.label || 'relates')}"`);
  }
  return lines.join('\n');
}

function mermaidFlowchart(m) {
  const dir = m.direction === 'LR' ? 'LR' : 'TB';
  const lines = [`flowchart ${dir}`];
  const groups = new Map();
  const ungrouped = [];
  for (const nd of m.nodes) {
    if (nd.group) {
      if (!groups.has(nd.group)) groups.set(nd.group, []);
      groups.get(nd.group).push(nd);
    } else {
      ungrouped.push(nd);
    }
  }
  for (const nd of ungrouped) lines.push(`  ${nd.id}["${escLabel(nd.label)}"]`);
  for (const [g, nodes] of groups) {
    lines.push(`  subgraph ${g}`);
    for (const nd of nodes) lines.push(`    ${nd.id}["${escLabel(nd.label)}"]`);
    lines.push('  end');
  }
  for (const e of m.edges ?? []) {
    lines.push(e.label ? `  ${e.from} -->|${escLabel(e.label)}| ${e.to}` : `  ${e.from} --> ${e.to}`);
  }
  return lines.join('\n');
}

// --- layout --------------------------------------------------------------------

export function layout(model) {
  validateModel(model);
  if (model.type === 'flowchart') return layoutFlowchart(model);
  if (model.type === 'er') return layoutEr(model);
  if (model.type === 'sequence') return layoutSequence(model);
  if (model.type === 'structure') return layoutStructure(model);
  throw new Error(`layout: unsupported type ${model.type}`);
}

// --- structure: the working board ----------------------------------------------
// A folder tree is containment, not a graph: folders are frames sized to hold
// their children, files are cards inside them. No edges, so nothing crosses.

const CARD_H = 34;
const CARD_FONT = 14;
const CARD_LINE_H = 18;   // wrapped line increment at the card font size
const CARD_GAP = 10;
const CARD_MIN_W = 90;
const CARD_MAX_W = 240;
const FRAME_PAD = 16;     // frame side/bottom padding
const FRAME_TOP = 44;     // headroom under a frame's top edge (nested frame names render above it)
const BLOCK_GAP = 24;     // gap between packed child blocks
const EMPTY_W = 180;      // minimum frame size — an empty folder is still a drop target
const EMPTY_H = 100;

const cardW = (label) =>
  Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, String(label).length * 8 + 18));
const detailW = (detail) => Math.min(CARD_MAX_W, String(detail).length * 6 + 16);
const DETAIL_H = 20;      // extra card height when a detail line is present

// Seat related pairs next to each other on the ring: a greedy chain walk over
// the relation adjacency, so most arrows are short hops between neighbours.
function orderByRelations(defs, pairs) {
  const canonical = (c) => c.path ?? c.id;
  const byAny = new Map();
  for (const c of defs) {
    if (c.path != null) byAny.set(c.path, c);
    if (c.id != null) byAny.set(c.id, c);
  }
  const adj = new Map(defs.map((c) => [canonical(c), []]));
  for (const [a, b] of pairs) {
    const ca = byAny.get(a);
    const cb = byAny.get(b);
    if (ca && cb && ca !== cb) {
      adj.get(canonical(ca)).push(canonical(cb));
      adj.get(canonical(cb)).push(canonical(ca));
    }
  }
  const byCanon = new Map(defs.map((c) => [canonical(c), c]));
  const out = [];
  const seen = new Set();
  for (const c of defs) {
    let k = canonical(c);
    while (k != null && !seen.has(k)) {
      seen.add(k);
      out.push(byCanon.get(k));
      k = adj.get(k).find((nk) => !seen.has(nk));
    }
  }
  return out;
}

// Cards that relations point at sit on a ring with an empty interior, so a
// straight chord between any two of them cannot pass through a third. The
// binding constraint is the chord that skips one neighbour: its clearance is
// r·(1−cos α), kept above a card's half-diagonal. Closed form — no routing.
function makeRing(defs, uw, ch) {
  const n = defs.length;
  const halfDiag = Math.hypot(uw / 2, ch / 2);
  if (n === 2) {
    const gap = Math.max(120, uw / 2);
    return {
      cards: defs.map((c, i) => ({ ...c, w: uw, h: ch, dx: i * (uw + gap), dy: 0 })),
      w: 2 * uw + gap,
      h: ch,
    };
  }
  const alpha = (2 * Math.PI) / n;
  const r = Math.ceil(Math.max(
    (uw + 40) / (2 * Math.sin(alpha / 2)),   // adjacent cards don't touch
    (halfDiag + 24) / (1 - Math.cos(alpha)), // chords clear every card
  ));
  const cx = r + uw / 2;
  const cy = r + ch / 2;
  return {
    cards: defs.map((c, i) => {
      const th = -Math.PI / 2 + i * alpha;
      return {
        ...c, w: uw, h: ch,
        dx: Math.round(cx + r * Math.cos(th) - uw / 2),
        dy: Math.round(cy + r * Math.sin(th) - ch / 2),
      };
    }),
    w: 2 * r + uw,
    h: 2 * r + ch,
  };
}

const BAND_GAP_X = 60;    // extra horizontal gap between cards within a band
const BAND_GAP_Y = 100;   // vertical corridor between grid/bands — arrows travel here
const MAX_BANDS = 6;      // a longer chain clamps here — bounded board height

// Status is data, not paint: canonical colors match the legend. An explicit
// `color` on the entry overrides its status color.
const STATUS_COLORS = {
  done: '#b2f2bb', 'in-progress': '#ffec99', error: '#ffc9c9', gap: '#a5d8ff',
};

// One walk of the tree: every addressable entry claims its root-relative path
// (and its explicit id as an alias). A key claimed twice is a hard error —
// a relation must never bind the wrong card silently.
function collectStructureKeys(tree) {
  const canon = new Map();   // raw key (path or id) → canonical path key
  const claim = (raw, canonical, what) => {
    if (raw == null || raw === '') return;
    if (canon.has(raw)) throw new Error(`duplicate structure key "${raw}" (${what})`);
    canon.set(raw, canonical);
  };
  const checkStatus = (e, what) => {
    if (e.status !== undefined && !STATUS_COLORS[e.status]) {
      throw new Error(`unknown status "${e.status}" on ${what} — use done | in-progress | error | gap`);
    }
  };
  const visit = (node, path) => {
    for (const d of node.dirs ?? []) {
      const p = path ? `${path}/${d.name}` : d.name;
      claim(p, p, `dir ${p}`);
      if (d.id != null && d.id !== p) claim(d.id, p, `dir ${p}`);
      checkStatus(d, `dir ${p}`);
      if (!d.collapsed && !d.card) visit(d, p);
    }
    for (const f of node.files ?? []) {
      const fd = typeof f === 'string' ? { name: f } : f;
      const p = path ? `${path}/${fd.name ?? fd.label}` : (fd.name ?? fd.label);
      claim(p, p, `file ${p}`);
      if (fd.id != null && fd.id !== p) claim(fd.id, p, `file ${p}`);
      checkStatus(fd, `file ${p}`);
    }
  };
  visit(tree, '');
  return canon;
}

// Resolve, validate, self-drop, and dedupe relations ONCE; every consumer
// (connectedness, mode pick, layout, arrows, mermaid) uses this set, so an
// unknown endpoint or a duplicate edge can never distort the board.
function normalizeRelations(model) {
  const canon = collectStructureKeys(model.tree);
  const seen = new Set();
  const out = [];
  for (const r of model.relations ?? []) {
    const a = canon.get(r.from);
    const b = canon.get(r.to);
    if (a == null || b == null || a === b) continue;
    const key = `${a}\u0000${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: a, to: b, label: r.label });
  }
  return out;
}

// The user-pattern layout (from their reference boards): ONE global grid for
// everything that never needs to move — plain cards first, then cards that only
// RECEIVE lines (sinks) on their own bottom rows, same columns. Only cards that
// ORIGINATE lines drop below, into spaced bands ranked by nearest target
// (band 1 points at the grid, band 2 points at band 1, …). Odd bands sit half a
// column pitch off the grid, even bands return to the columns — a brick
// lattice, so arrows run short diagonals through the gaps. Adjacent-band
// arrows cannot pass through a card; a band-skipping one may — accepted,
// because this board exists to be rearranged and the grid is already parked
// out of the way. (Quarter-pitch stagger is the manual escalation if half
// lanes ever conflict.)
function makeBands(plainDefs, connDefs, pairs, uw, ch) {
  const canonical = (c) => c.path ?? c.id;
  const byAny = new Map();
  for (const c of connDefs) {
    if (c.path != null) byAny.set(c.path, c);
    if (c.id != null) byAny.set(c.id, c);
  }
  const out = new Map(connDefs.map((c) => [canonical(c), []]));
  for (const [a, b] of pairs) {
    const ca = byAny.get(a);
    const cb = byAny.get(b);
    if (ca && cb && ca !== cb) out.get(canonical(ca)).push(canonical(cb));
  }
  const sinks = connDefs.filter((c) => out.get(canonical(c)).length === 0);
  const bandDefs = connDefs.filter((c) => out.get(canonical(c)).length > 0);

  // Band rank = shortest hop to the grid: 1 + min over targets (grid → 0,
  // band card → its rank), with an on-stack guard so cycles terminate.
  const sinkKeys = new Set(sinks.map(canonical));
  const rank = new Map();
  const onStack = new Set();
  const rankOf = (k) => {
    if (rank.has(k)) return rank.get(k);
    if (onStack.has(k)) return 0;
    onStack.add(k);
    const vals = out.get(k).map((t) => (sinkKeys.has(t) || !out.has(t) ? 0 : rankOf(t)));
    onStack.delete(k);
    const r = 1 + (vals.length ? Math.min(...vals) : 0);
    rank.set(k, r);
    return r;
  };
  for (const c of bandDefs) rankOf(canonical(c));

  // Cycle members share one band: mutual reachability (tiny graphs — a plain
  // closure beats SCC machinery) takes the group to its minimum rank, so a
  // cycle is a row, not a traversal-order staircase. Ranks then clamp so a
  // long chain cannot grow the board without bound.
  const bandKeys = bandDefs.map(canonical);
  const reach = new Map(bandKeys.map((k) => [k, new Set([k])]));
  for (const k of bandKeys) {
    const seen = reach.get(k);
    const stack = [k];
    while (stack.length) {
      for (const t of out.get(stack.pop()) ?? []) {
        if (out.has(t) && !seen.has(t)) { seen.add(t); stack.push(t); }
      }
    }
  }
  const grouped = new Set();
  for (const a of bandKeys) {
    if (grouped.has(a)) continue;
    const grp = bandKeys.filter((b) => reach.get(a).has(b) && reach.get(b).has(a));
    const r = Math.min(MAX_BANDS, ...grp.map((g) => rank.get(g)));
    for (const g of grp) { rank.set(g, r); grouped.add(g); }
  }

  // The global grid: plain rows, then sink rows, same columns.
  const pitch = uw + CARD_GAP;
  const gridAll = [...plainDefs, ...sinks];
  const cols = Math.max(1, Math.ceil(Math.sqrt(gridAll.length || bandDefs.length)));
  const cards = [];
  const centerOf = new Map();   // canonical key → placed center x, for lane alignment
  let row = 0;
  const placeRows = (defs) => {
    defs.forEach((c, i) => {
      const dx = (i % cols) * pitch;
      const dy = (row + Math.floor(i / cols)) * (ch + CARD_GAP);
      cards.push({ ...c, w: uw, h: ch, dx, dy });
      centerOf.set(canonical(c), dx + uw / 2);
    });
    row += Math.ceil(defs.length / cols);
  };
  if (plainDefs.length) placeRows(plainDefs);
  if (sinks.length) placeRows(sinks);
  const gridH = row * (ch + CARD_GAP) - (row ? CARD_GAP : 0);
  let w = cols * pitch - CARD_GAP;

  // Bands below, nearest-target order within each: arrows land in short
  // near-vertical lanes.
  const bands = [];
  for (const c of bandDefs) {
    const r = rank.get(canonical(c));
    if (!bands[r]) bands[r] = [];
    bands[r].push(c);
  }
  let y = gridH;
  bands.forEach((band, k) => {
    if (!band) return;
    y += BAND_GAP_Y;
    const bary = new Map(band.map((c, i) => {
      const seen = out.get(canonical(c)).filter((t) => centerOf.has(t));
      return [canonical(c), seen.length
        ? seen.reduce((sum, t) => sum + centerOf.get(t), 0) / seen.length : i * pitch];
    }));
    const ordered = [...band].sort((a, b) => bary.get(canonical(a)) - bary.get(canonical(b)));
    const x0 = k % 2 === 1 ? Math.round(pitch / 2) : 0;
    ordered.forEach((c, i) => {
      const dx = x0 + i * (uw + BAND_GAP_X);
      cards.push({ ...c, w: uw, h: ch, dx, dy: y });
      centerOf.set(canonical(c), dx + uw / 2);
      w = Math.max(w, dx + uw);
    });
    y += ch;
  });
  return { cards, w, h: y };
}

// Size every folder frame bottom-up to hold its children — sub-frames and file
// cards — shelf-packed into rows aimed at a square-ish aspect. `path` is the
// root-relative address each card and frame answers to in `relations`; `rel`
// carries the relation keys/pairs so connected cards get tier or ring placement.
function packDir(node, path = '', rel = { keys: new Set(), pairs: [] }) {
  const childPath = (name) => (path ? `${path}/${name}` : name);
  const cardDefs = [];
  const childBlocks = [];
  for (const d of node.dirs ?? []) {
    if (d.collapsed) {
      cardDefs.push({ label: `${d.name}/ (${d.fileCount} files)`, dashed: true, path: childPath(d.name) });
    } else if (d.card) {
      // A folder that IS a unit (a skill, an item) renders as one semantic card.
      cardDefs.push({
        label: d.label ?? d.name, detail: d.detail, color: d.color, status: d.status,
        id: d.id, path: childPath(d.name),
      });
    } else {
      childBlocks.push(packDir(d, childPath(d.name), rel));
    }
  }
  for (const file of node.files ?? []) {
    const fd = typeof file === 'string' ? { name: file } : file;
    cardDefs.push({
      label: fd.label ?? fd.name, detail: fd.detail, color: fd.color, status: fd.status,
      id: fd.id, path: childPath(fd.name ?? fd.label),
    });
  }
  if (node.filesCollapsed) cardDefs.push({ label: `(${node.filesCollapsed} files)`, dashed: true });

  // Cards share one width and height per folder so grids and rings stay
  // aligned; the height allows for wrapped labels and any detail line.
  let ringBlock = null;
  let gridBlock = null;
  if (cardDefs.length) {
    const uw = Math.max(...cardDefs.map(
      (c) => Math.max(cardW(c.label), c.detail ? detailW(c.detail) : 0),
    ));
    const lines = (label) => Math.max(1, Math.ceil((String(label).length * 8) / (uw - 2 * PAD_X)));
    const ch = CARD_H + (Math.max(...cardDefs.map((c) => lines(c.label))) - 1) * CARD_LINE_H
      + (cardDefs.some((c) => c.detail) ? DETAIL_H : 0);

    // Cards with relations get their own spread-out block (needs at least
    // two); the rest stay in the dense grid, packed above/left of it.
    const isConn = (c) => !c.dashed && (rel.keys.has(c.path) || rel.keys.has(c.id));
    let connDefs = cardDefs.filter(isConn);
    if (connDefs.length < 2) connDefs = [];
    const gridDefs = cardDefs.filter((c) => !connDefs.includes(c));

    // Pairs whose both ends are cards of THIS folder decide the shape:
    // sparse/hub-shaped graphs use the banded grid (one global grid, bands
    // below for line-originators); dense tangles fall back to the ring, which
    // keeps the hard no-through-card guarantee for every chord.
    const here = new Set();
    for (const c of connDefs) {
      if (c.path != null) here.add(c.path);
      if (c.id != null) here.add(c.id);
    }
    const intraPairs = rel.pairs.filter(([a, b]) => here.has(a) && here.has(b));
    if (connDefs.length && intraPairs.length > connDefs.length) {
      ringBlock = makeRing(orderByRelations(connDefs, intraPairs), uw, ch);
      connDefs = [];
    }
    if (connDefs.length) {
      gridBlock = makeBands(gridDefs, connDefs, intraPairs, uw, ch);
    } else if (gridDefs.length) {
      const cols = Math.ceil(Math.sqrt(gridDefs.length));
      const rows = Math.ceil(gridDefs.length / cols);
      gridBlock = {
        cards: gridDefs.map((c, i) => ({
          ...c, w: uw, h: ch,
          dx: (i % cols) * (uw + CARD_GAP),
          dy: Math.floor(i / cols) * (ch + CARD_GAP),
        })),
        w: cols * uw + (cols - 1) * CARD_GAP,
        h: rows * ch + (rows - 1) * CARD_GAP,
      };
    }
  }

  // Pack order is the user's stable-zone rule: things without lines (frames,
  // then the plain grid) sit above/left; the connected block comes last so it
  // lands below/right, where rearranging happens anyway.
  const items = childBlocks.map((b) => ({ kind: 'frame', block: b, w: b.w, h: b.h }));
  for (const cb of [gridBlock, ringBlock]) {
    if (cb) items.push({ kind: 'cards', block: cb, w: cb.w, h: cb.h });
  }

  const area = items.reduce((sum, it) => sum + it.w * it.h, 0);
  const target = Math.max(Math.ceil(Math.sqrt(area) * 1.15), ...items.map((it) => it.w), 0);
  const frames = [];
  const cards = [];
  let x = 0; let y = 0; let rowH = 0; let packedW = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > target) { y += rowH + BLOCK_GAP; x = 0; rowH = 0; }
    const dx = FRAME_PAD + x;
    const dy = FRAME_TOP + y;
    if (it.kind === 'frame') frames.push({ block: it.block, dx, dy });
    else for (const c of it.block.cards) cards.push({ ...c, dx: dx + c.dx, dy: dy + c.dy });
    x += it.w + BLOCK_GAP;
    rowH = Math.max(rowH, it.h);
    packedW = Math.max(packedW, x - BLOCK_GAP);
  }
  return {
    name: node.name,
    path,
    frames,
    cards,
    w: Math.max(EMPTY_W, packedW + 2 * FRAME_PAD),
    h: Math.max(EMPTY_H, (items.length ? y + rowH : 0) + FRAME_TOP + FRAME_PAD),
  };
}

function layoutStructure(m) {
  const rels = normalizeRelations(m);
  const keys = new Set();
  const pairs = [];
  for (const r of rels) {
    keys.add(r.from);
    keys.add(r.to);
    pairs.push([r.from, r.to]);
  }
  return { root: packDir(m.tree, '', { keys, pairs }), rels };
}

const SEQ_COL_W = 200;
const SEQ_BOX_W = 150;
const SEQ_BOX_H = 44;
const SEQ_FIRST_Y = 90;
const SEQ_MSG_GAP = 54;

function layoutSequence(m) {
  const lifelineX = new Map();
  const boxX = new Map();
  m.participants.forEach((p, i) => {
    const bx = i * SEQ_COL_W + (SEQ_COL_W - SEQ_BOX_W) / 2;
    boxX.set(p.id, bx);
    lifelineX.set(p.id, bx + SEQ_BOX_W / 2);
  });
  const messages = [...m.messages]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((msg, i) => ({ ...msg, y: SEQ_FIRST_Y + i * SEQ_MSG_GAP }));
  const bottomY = SEQ_FIRST_Y + messages.length * SEQ_MSG_GAP + 30;
  return { lifelineX, boxX, messages, bottomY, boxW: SEQ_BOX_W, boxH: SEQ_BOX_H };
}

export function erLabel(e) {
  const attrLines = (e.attributes ?? []).map(
    (a) => `${a.name}${a.key ? ` (${a.key})` : ''}${a.type ? `: ${a.type}` : ''}`,
  );
  return [e.name, ...attrLines].join('\n');
}

function layoutEr(m) {
  const entities = m.entities;
  const cols = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
  const rows = Math.ceil(entities.length / cols);
  const sizes = new Map(entities.map((e) => [e.name, measureBox(erLabel(e))]));

  // Column widths and row heights follow the widest / tallest box in each, so
  // variable-size entity boxes still align on a clean grid.
  const colW = new Array(cols).fill(0);
  const rowH = new Array(rows).fill(0);
  entities.forEach((e, i) => {
    const s = sizes.get(e.name);
    colW[i % cols] = Math.max(colW[i % cols], s.w);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], s.h);
  });
  const colX = []; let x = 0;
  for (let c = 0; c < cols; c += 1) { colX[c] = x; x += colW[c] + GAP; }
  const rowY = []; let y = 0;
  for (let r = 0; r < rows; r += 1) { rowY[r] = y; y += rowH[r] + GAP; }

  const positions = new Map();
  entities.forEach((e, i) => positions.set(e.name, { x: colX[i % cols], y: rowY[Math.floor(i / cols)] }));
  return { positions, sizes };
}

function layoutFlowchart(m) {
  const ids = m.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const edges = (m.edges ?? []).filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);
  const sizes = new Map(m.nodes.map((n) => [n.id, measureBox(n.label)]));

  const out = new Map(ids.map((id) => [id, []]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) {
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }

  // Roots = zero in-degree. An all-cycle component has none: fall back to the
  // lowest-in-degree node (ties broken by input order) so ranking is defined.
  let roots = ids.filter((id) => indeg.get(id) === 0);
  if (roots.length === 0 && ids.length) {
    const min = Math.min(...ids.map((id) => indeg.get(id)));
    roots = [ids.find((id) => indeg.get(id) === min)];
  }

  // Longest-path rank via DFS; the on-stack guard ignores back-edges (cycles).
  const rank = new Map(ids.map((id) => [id, 0]));
  const onStack = new Set();
  const dfs = (id, depth) => {
    if (onStack.has(id)) return;                 // back-edge — do not follow or re-rank
    rank.set(id, Math.max(rank.get(id), depth));
    onStack.add(id);
    for (const nxt of out.get(id)) dfs(nxt, depth + 1);
    onStack.delete(id);
  };
  for (const r of roots) dfs(r, 0);

  const byRank = new Map();
  for (const id of ids) {
    const r = rank.get(id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(id);
  }
  // rankIndex[k] is the ordered list of node ids in the k-th rank.
  const rankIndex = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);

  // Barycenter crossing reduction: repeatedly reorder each rank so a node sits
  // near the average position of its neighbours in the adjacent rank. A few
  // alternating down/up sweeps markedly cut edge crossings (the Sugiyama idea,
  // minus the heavy machinery). Nodes with no neighbour keep their slot.
  const inn = new Map(ids.map((id) => [id, []]));
  for (const e of edges) inn.get(e.to).push(e.from);
  for (let pass = 0; pass < 4; pass += 1) {
    const down = pass % 2 === 0;
    const order = down
      ? rankIndex.map((_, k) => k).slice(1)
      : rankIndex.map((_, k) => k).slice(0, -1).reverse();
    for (const k of order) {
      const adj = rankIndex[down ? k - 1 : k + 1];
      const posOf = new Map(adj.map((id, i) => [id, i]));
      const cur = rankIndex[k];
      const bary = new Map();
      cur.forEach((id, i) => {
        const neigh = (down ? inn.get(id) : out.get(id)).filter((n) => posOf.has(n));
        bary.set(id, neigh.length ? neigh.reduce((sum, n) => sum + posOf.get(n), 0) / neigh.length : i);
      });
      rankIndex[k] = [...cur].sort((a, b) => bary.get(a) - bary.get(b));
    }
  }

  // TB: ranks stack down (y), nodes spread across a rank (x). LR: ranks progress
  // right (x), nodes spread down a rank (y). Placement uses each node's real size
  // so nothing overlaps regardless of label length.
  const TB = m.direction !== 'LR';
  const positions = new Map();
  let cross = 0;
  for (const group of rankIndex) {
    const thick = Math.max(...group.map((id) => (TB ? sizes.get(id).h : sizes.get(id).w)));
    let along = 0;
    for (const id of group) {
      const s = sizes.get(id);
      positions.set(id, TB ? { x: along, y: cross } : { x: cross, y: along });
      along += (TB ? s.w : s.h) + GAP;
    }
    cross += thick + RANK_GAP;
  }
  return { positions, sizes, rank, edges };
}

// --- assembly ------------------------------------------------------------------

export function toExcalidraw(model) {
  validateModel(model);
  const f = newFactory();
  // Z-order: edges (arrows, lifelines) render BEHIND nodes so lines never paint
  // over boxes or their text; arrow labels render on TOP so they stay readable.
  // Frames (structure boards) come first of all — folders sit behind their cards.
  const frameEls = [];
  const edgeEls = [];
  const nodeEls = [];
  const labelEls = [];
  const bucket = (arrowEls) => {
    for (const el of arrowEls) (el.type === 'text' ? labelEls : edgeEls).push(el);
  };

  // Anchor an arrow between two boxes at the edges facing each other.
  const connect = (a, b, labelText, customData) => {
    const { start, end } = edgeSegment(a, b);
    const r = f.arrow({ from: a, to: b, start, end, label: labelText });
    if (customData) r.arrow.customData = customData;
    bucket(r.elements);
  };

  if (model.type === 'flowchart') {
    const { positions, sizes, edges } = layout(model);
    const boxes = new Map();
    for (const nd of model.nodes) {
      const p = positions.get(nd.id);
      const s = sizes.get(nd.id);
      const { box, text } = f.rect({ x: p.x, y: p.y, w: s.w, h: s.h, label: nd.label });
      boxes.set(nd.id, box);
      nodeEls.push(box, text);
    }
    for (const e of edges) connect(boxes.get(e.from), boxes.get(e.to), e.label);
  } else if (model.type === 'er') {
    const { positions, sizes } = layoutEr(model);
    const boxes = new Map();
    for (const e of model.entities) {
      const p = positions.get(e.name);
      const s = sizes.get(e.name);
      const { box, text } = f.rect({ x: p.x, y: p.y, w: s.w, h: s.h, label: erLabel(e) });
      boxes.set(e.name, box);
      nodeEls.push(box, text);
    }
    for (const r of model.relations ?? []) {
      const a = boxes.get(r.from);
      const b = boxes.get(r.to);
      if (a && b) connect(a, b, r.cardinality || r.label);
    }
  } else if (model.type === 'sequence') {
    const L = layoutSequence(model);
    for (const p of model.participants) {
      const { box, text } = f.rect({ x: L.boxX.get(p.id), y: 0, w: L.boxW, h: L.boxH, label: p.label });
      nodeEls.push(box, text);
      const cx = L.lifelineX.get(p.id);
      edgeEls.push(f.line({ x: cx, y: L.boxH, points: [[0, 0], [0, L.bottomY - L.boxH]] }));   // behind boxes
    }
    for (const msg of L.messages) {
      const fromX = L.lifelineX.get(msg.from);
      const toX = L.lifelineX.get(msg.to);
      if (fromX == null || toX == null) continue;
      const start = { x: fromX, y: msg.y };
      // self-message: a small loop back to the same lifeline
      const end = msg.from === msg.to ? { x: fromX + 46, y: msg.y + 18 } : { x: toX, y: msg.y };
      bucket(f.arrow({ start, end, label: msg.label }).elements);   // unbound: connects lifelines, not boxes
    }
  } else if (model.type === 'structure') {
    const { root, rels } = layoutStructure(model);
    // Cards and frames answer to their root-relative path (or explicit id) so
    // `relations` can bind arrows to them. Every generated element carries a
    // namespaced ownership marker (customData.daftplate) so a future update
    // mode can match units in an edited board without guessing from labels.
    const byKey = new Map();
    const emitCard = (c, x, y, frameId) => {
      const r = f.rect({
        x: x + c.dx, y: y + c.dy, w: c.w, h: c.h ?? CARD_H, label: c.label, detail: c.detail,
        fontSize: CARD_FONT, strokeStyle: c.dashed ? 'dashed' : undefined,
        backgroundColor: c.backgroundColor ?? c.color ?? (c.status && STATUS_COLORS[c.status]),
      });
      r.box.frameId = frameId;
      r.text.frameId = frameId;
      if (c.path) {
        // Snapshot the generator's own output so update mode can tell a user's
        // edit from an untouched default: an edited label or a chosen color
        // survives, an unedited one refreshes. `geom` records where the card was
        // written, which separates a move the user made from one the app's
        // frame-drag desync inflicted.
        const lastGenerated = { label: String(c.label ?? ''), backgroundColor: r.box.backgroundColor };
        if (c.detail !== undefined) lastGenerated.detail = String(c.detail);
        if (c.status !== undefined) lastGenerated.status = c.status;
        r.box.customData = {
          daftplate: { path: c.path, lastGenerated, geom: { x: r.box.x, y: r.box.y } },
        };
      } else if (c.kind) r.box.customData = { daftplate: { kind: c.kind } };
      nodeEls.push(r.box, r.text);
      if (r.detail) {
        r.detail.frameId = frameId;
        if (c.path) r.detail.customData = { daftplate: { path: c.path, kind: 'detail' } };
        nodeEls.push(r.detail);
      }
      if (c.path) byKey.set(c.path, r.box);
      if (c.id) byKey.set(c.id, r.box);
    };
    // Frames are emitted parent-before-child; every child element carries the
    // frameId of its immediate folder so dragging a folder moves its contents.
    const walk = (block, x, y, parentId) => {
      const fr = f.frame({ x, y, w: block.w, h: block.h, name: block.name });
      fr.frameId = parentId;
      fr.customData = { daftplate: { path: block.path || '' } };
      frameEls.push(fr);
      byKey.set(block.path || block.name, fr);
      for (const c of block.cards) emitCard(c, x, y, fr.id);
      for (const child of block.frames) walk(child.block, x + child.dx, y + child.dy, fr.id);
    };
    walk(root, 0, 0, null);

    // Semantic relations, pre-normalized (resolved, deduped, self-dropped):
    // arrows bound card-to-card (or to a folder's frame), so they stay
    // attached while the board is rearranged.
    for (const r of rels) {
      const a = byKey.get(r.from);
      const b = byKey.get(r.to);
      if (a && b) connect(a, b, r.label, { daftplate: { rel: [r.from, r.to] } });
    }

    // The annotation kit, parked beside the tree: a status legend to recolor
    // cards from, and an empty workbench frame for gaps, notes, and staging.
    const lx = root.w + 60;
    const legendCards = [
      { label: 'Done', backgroundColor: STATUS_COLORS.done },
      { label: 'In progress', backgroundColor: STATUS_COLORS['in-progress'] },
      { label: 'Error to fix', backgroundColor: STATUS_COLORS.error },
      { label: 'Gap / missing', backgroundColor: STATUS_COLORS.gap },
    ];
    const legendW = 170 + 2 * FRAME_PAD;
    const legendH = FRAME_TOP + legendCards.length * (CARD_H + CARD_GAP) - CARD_GAP + FRAME_PAD;
    const legend = f.frame({ x: lx, y: 0, w: legendW, h: legendH, name: 'Legend' });
    legend.customData = { daftplate: { kind: 'legend' } };
    frameEls.push(legend);
    legendCards.forEach((c, i) => emitCard(
      { ...c, kind: 'legend-card', w: 170, dx: FRAME_PAD, dy: FRAME_TOP + i * (CARD_H + CARD_GAP) },
      lx, 0, legend.id,
    ));
    const benchH = Math.max(400, Math.min(root.h - legendH - 40, 1000));
    const bench = f.frame({
      x: lx, y: legendH + 40, w: Math.max(460, legendW), h: benchH, name: 'Gaps / To do',
    });
    bench.customData = { daftplate: { kind: 'workbench' } };
    frameEls.push(bench);
  } else {
    throw new Error(`toExcalidraw: unsupported type ${model.type}`);
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'daftplate/diagram',
    elements: [...frameEls, ...edgeEls, ...nodeEls, ...labelEls],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
}

export function render(model) {
  return { excalidraw: toExcalidraw(model), mermaid: toMermaid(model) };
}

// --- update mode: merge a fresh render into a hand-edited board ------------------
// A separate, deterministic step over (rendered, existing). render() never reads
// files; merge() never renders. Generator-owned elements are matched ONLY by their
// customData.daftplate marker — never by label text — so a user's moves, recolors,
// and frame reorganizations survive regeneration.

// User-owned fields on a matched element: the ones a person edits on the canvas.
const USER_FIELDS = ['x', 'y', 'width', 'height', 'frameId', 'backgroundColor'];

const contains = (frame, el) => el.x >= frame.x && el.y >= frame.y
  && el.x + el.width <= frame.x + frame.width && el.y + el.height <= frame.y + frame.height;

// The single matching key for a generator-owned element. Cards, frames, and a
// card's detail line key on `path` (the detail's kind:'detail' keeps it distinct
// from its card); the annotation frames key on `kind`; a relation arrow keys on
// the pair it joins (relations are deduped, so the pair is unique). The legend's
// four palette swatches deliberately share kind:'legend-card' and have no
// identity of their own — they key to null and ride their frame instead.
function markerKey(d) {
  if (!d) return null;
  if (d.path !== undefined) return d.kind ? `${d.path}#${d.kind}` : d.path;
  if (d.kind === 'legend' || d.kind === 'workbench') return `kind:${d.kind}`;
  if (Array.isArray(d.rel)) return `rel:${d.rel[0]}>${d.rel[1]}`;
  return null;
}

// The elements whose user-owned geometry we carry forward: cards and every
// frame (tree frames by path, legend/workbench by kind). A detail line rides its
// card and the four legend palette cards ride their frame, so neither overlays
// directly — they move in the re-anchor pass instead.
const isOverlayTarget = (d) => !!d && ((d.path !== undefined && d.kind === undefined)
  || d.kind === 'legend' || d.kind === 'workbench');

export function merge(rendered, existing) {
  // Index existing generator-owned elements by their marker. Elements with no
  // identity of their own (the legend's four palette swatches) key to null and
  // are skipped — expected, not an ambiguity.
  const index = new Map();
  let markers = 0;
  for (const e of existing.elements) {
    const d = e.customData?.daftplate;
    if (!d) continue;
    markers += 1;
    const key = markerKey(d);
    if (key === null) continue;
    if (index.has(key)) throw new Error(`ambiguous board: two elements claim marker "${key}" — refusing merge`);
    index.set(key, e);
  }
  // A board with no marker at all is not a generated board: never guess at it.
  if (markers === 0) throw new Error('existing board carries no daftplate markers — refusing merge');

  // --- id preservation ---------------------------------------------------------
  // A matched element keeps the id it already carries in the user's board. Every
  // reference a hand-drawn element holds — an arrow binding, containerId,
  // frameId, and whatever reference field Excalidraw adds next — therefore still
  // names the same card after the merge, without the merge knowing the field
  // exists. Only genuinely new elements are given ids, and never one the existing
  // board already uses, so no id can come to mean a different element.
  const existingIds = new Set(existing.elements.map((e) => e.id));
  // A bound label carries no marker of its own; it is identified by the element
  // it labels, in both boards.
  const boundTextOf = (els, container) => els.find(
    (t) => t.type === 'text' && t.containerId === container.id,
  );
  const idMap = new Map();
  for (const el of rendered.elements) {
    const key = markerKey(el.customData?.daftplate);
    if (key === null) continue;
    const match = index.get(key);
    if (!match) continue;
    idMap.set(el.id, match.id);
    const rText = boundTextOf(rendered.elements, el);
    const eText = boundTextOf(existing.elements, match);
    if (rText && eText && !idMap.has(rText.id)) idMap.set(rText.id, eText.id);
  }
  const assigned = new Set(idMap.values());
  let nextId = 0;
  for (const el of rendered.elements) {
    if (idMap.has(el.id)) continue;
    let id = el.id;
    while (existingIds.has(id) || assigned.has(id)) { id = `el-n${nextId}`; nextId += 1; }
    idMap.set(el.id, id);
    assigned.add(id);
  }
  const mapId = (id) => (idMap.has(id) ? idMap.get(id) : id);

  const out = structuredClone(rendered);
  for (const el of out.elements) {
    // Each element is visited once, so every field still holds a rendered id
    // when it is read.
    el.id = mapId(el.id);
    if (el.containerId != null) el.containerId = mapId(el.containerId);
    if (el.frameId != null) el.frameId = mapId(el.frameId);
    // A card's group id is derived from its box id, so it follows the box.
    if (Array.isArray(el.groupIds)) {
      el.groupIds = el.groupIds.map((g) => (g.startsWith('g-') ? `g-${mapId(g.slice(2))}` : g));
    }
    if (Array.isArray(el.boundElements)) {
      el.boundElements = el.boundElements.map((b) => ({ ...b, id: mapId(b.id) }));
    }
    if (el.startBinding?.elementId) {
      el.startBinding = { ...el.startBinding, elementId: mapId(el.startBinding.elementId) };
    }
    if (el.endBinding?.elementId) {
      el.endBinding = { ...el.endBinding, elementId: mapId(el.endBinding.elementId) };
    }
  }
  // The fresh render's own geometry, under the final ids — the reference every
  // pass below measures its offsets against.
  const renById = new Map(out.elements.map((e) => [e.id, structuredClone(e)]));

  // Move a card's markerless companions with it: the bound title text (keyed by
  // containerId) and the grouped detail line (keyed by shared groupId). Neither
  // is matched on its own, so both track the card's box whenever it moves —
  // whether a user drag (overlay) or a re-anchor.
  const moveCompanions = (box, dx, dy, frameId) => {
    const group = box.groupIds[0];
    for (const t of out.elements) {
      const title = t.type === 'text' && t.containerId === box.id;
      const detail = t.customData?.daftplate?.kind === 'detail'
        && group != null && t.groupIds.includes(group);
      if (!title && !detail) continue;
      t.x += dx;
      t.y += dy;
      if (frameId !== undefined) t.frameId = frameId;
    }
  };

  // --- ownership ---------------------------------------------------------------
  // An existing element belongs to the generator iff the fresh render claimed its
  // id, or it carries a marker (a unit dropped from the model, or furniture that
  // is regenerated wholesale). One further case: a markerless text labelling a
  // marked element the render did NOT claim — a legend swatch, a relation arrow
  // the model no longer draws — is that element's own label and goes with it.
  // Everything else is the user's, including a caption they bound to a card.
  const claimed = new Set(idMap.values());
  const markedIds = new Set(existing.elements.filter((e) => e.customData?.daftplate).map((e) => e.id));
  const isGenerated = (e) => claimed.has(e.id)
    || e.customData?.daftplate !== undefined
    || (e.type === 'text' && e.containerId != null
      && markedIds.has(e.containerId) && !claimed.has(e.containerId));
  const generatedExisting = new Set(existing.elements.filter(isGenerated).map((e) => e.id));

  // Find the bound title text (by containerId) of a card in a given element list.
  const titleOf = (els, box) => els.find((t) => t.type === 'text' && t.containerId === box.id);
  // Find a card's grouped detail line (kind:'detail', same path) in a given list.
  const detailOf = (els, path) => els.find(
    (t) => t.customData?.daftplate?.kind === 'detail' && t.customData.daftplate.path === path,
  );

  for (const el of out.elements) {
    const d = el.customData?.daftplate;
    if (!isOverlayTarget(d)) continue;
    const match = index.get(markerKey(d));
    if (!match) continue;
    const orig = renById.get(el.id);
    const dx = match.x - orig.x;
    const dy = match.y - orig.y;
    for (const k of USER_FIELDS) if (match[k] !== undefined) el[k] = match[k];
    moveCompanions(el, dx, dy, el.frameId);

    // A status change repaints a card the user never recolored; a color they
    // picked themselves always wins. The snapshot is what the generator last
    // wrote, so "still that color" means "untouched".
    const lastBg = match.customData?.daftplate?.lastGenerated?.backgroundColor;
    if (lastBg !== undefined && match.backgroundColor === lastBg) el.backgroundColor = orig.backgroundColor;

    // A user's arrow lists itself on the card it binds to, and the fresh render
    // knows nothing about it. Union the two lists rather than taking the render's.
    if (Array.isArray(match.boundElements)) {
      for (const b of match.boundElements) {
        if (generatedExisting.has(b.id)) continue;
        if (el.boundElements.some((x) => x.id === b.id)) continue;
        el.boundElements.push({ ...b });
      }
    }

    // Keep a user's edited label/detail; refresh an untouched one. The match's
    // lastGenerated snapshot is what the generator last wrote — if the board's
    // current text differs, the user changed it, so carry their text onto the
    // fresh render. If it matches (or there is no snapshot), the render's text
    // stands, so an unedited card refreshes from the new model.
    if (el.type === 'rectangle' && d.path !== undefined && d.kind === undefined) {
      const last = match.customData?.daftplate?.lastGenerated;
      if (last) {
        const exTitle = titleOf(existing.elements, match);
        const outTitle = titleOf(out.elements, el);
        if (exTitle && outTitle && last.label !== undefined && exTitle.text !== last.label) {
          outTitle.text = exTitle.text;
          outTitle.originalText = exTitle.text;
        }
        const exDetail = detailOf(existing.elements, d.path);
        const outDetail = detailOf(out.elements, d.path);
        if (exDetail && outDetail && last.detail !== undefined && exDetail.text !== last.detail) {
          outDetail.text = exDetail.text;
          outDetail.originalText = exDetail.text;
        }
      }
    }
  }

  // Re-anchor pass — repair the confirmed Excalidraw drag desync. Dragging a
  // frame carries only its direct members one level, so a grandchild card is
  // left behind: its frameId still names its frame, but it now sits outside it.
  // Such a card is moved back to its generated offset within that frame — but
  // only when it has not budged since the board was last written (`geom`), which
  // is the desync's signature. A card the user moved out themselves shows a
  // different position and is left exactly where they put it. A legacy board
  // with no geometry snapshot keeps the old unconditional repair, once.
  // (Frames themselves are not re-anchored: the confirmed desync only ever
  // strands cards, never frames.) The legend's palette cards are the exception:
  // they are never matched individually, so they always come from the fresh
  // render and are always re-seated against the preserved legend frame — a small
  // shift would otherwise leave them inside the frame's slack, sitting crooked.
  const outById = new Map(out.elements.map((e) => [e.id, e]));
  for (const el of out.elements) {
    // Cards only — a title or detail line rides its card through moveCompanions,
    // and re-anchoring one on its own would tear it off the box it belongs to.
    if (el.type !== 'rectangle' || !el.customData?.daftplate || el.frameId == null) continue;
    const frameOut = outById.get(el.frameId);
    const ridesFrame = el.customData.daftplate.kind === 'legend-card';
    if (!frameOut || (!ridesFrame && contains(frameOut, el))) continue;
    const match = index.get(markerKey(el.customData?.daftplate));
    const geom = match?.customData?.daftplate?.geom;
    if (geom && (match.x !== geom.x || match.y !== geom.y)) continue;   // a deliberate move
    const origEl = renById.get(el.id);
    const origFrame = renById.get(el.frameId);
    if (!origEl || !origFrame) continue;         // moved to a frame it never belonged to
    const nx = frameOut.x + (origEl.x - origFrame.x);
    const ny = frameOut.y + (origEl.y - origFrame.y);
    const ddx = nx - el.x;
    const ddy = ny - el.y;
    el.x = nx;
    el.y = ny;
    moveCompanions(el, ddx, ddy);
  }

  // Inbox pass — a unit new in the model (no match in the old board) is not
  // dropped into its folder; it lands in the "Gaps / To do" workbench frame,
  // flagged inbox:true, for the user to place. Runs after re-anchor: a new card
  // still sits inside its tree folder at this point, so re-anchor leaves it
  // alone, and nothing disturbs it once it is reparented into the workbench.
  const bench = out.elements.find(
    (e) => e.type === 'frame' && e.customData?.daftplate?.kind === 'workbench',
  );
  if (bench) {
    const newCards = out.elements
      .filter((el) => {
        const d = el.customData?.daftplate;
        return el.type === 'rectangle' && d?.path !== undefined && d.kind === undefined
          && !index.has(d.path);
      })
      .sort((a, b) => (a.customData.daftplate.path < b.customData.daftplate.path ? -1 : 1));
    let cy = bench.y + FRAME_TOP;
    for (const el of newCards) {
      const nx = bench.x + FRAME_PAD;
      const ddx = nx - el.x;
      const ddy = cy - el.y;
      el.x = nx;
      el.y = cy;
      el.frameId = bench.id;
      el.customData.daftplate.inbox = true;
      moveCompanions(el, ddx, ddy, bench.id);
      cy += el.height + CARD_GAP;
    }
  }

  // Relation re-binding — arrows are regenerated from the model (they carry a
  // `rel` marker and bind to card ids). After every card has moved to its final
  // position, recompute each arrow's geometry from its bound boxes so the board
  // reads correctly even in a viewer that does not re-route bindings on load.
  for (const el of out.elements) {
    if (el.type !== 'arrow' || !el.customData?.daftplate?.rel) continue;
    const a = el.startBinding && outById.get(el.startBinding.elementId);
    const b = el.endBinding && outById.get(el.endBinding.elementId);
    if (!a || !b) continue;
    const { start, end } = edgeSegment(a, b);
    el.x = start.x;
    el.y = start.y;
    el.width = Math.abs(end.x - start.x);
    el.height = Math.abs(end.y - start.y);
    el.points = [[0, 0], [end.x - start.x, end.y - start.y]];
    const labelRef = el.boundElements?.find((be) => be.type === 'text');
    const lt = labelRef && outById.get(labelRef.id);
    if (lt) {
      lt.x = start.x + (end.x - start.x) / 2 - lt.width / 2;
      lt.y = start.y + (end.y - start.y) / 2 - 11;
    }
  }

  // Stale pass — a unit dropped from the model is never deleted. Its element is
  // carried back from the old board, kept exactly in place, tinted (dashed +
  // muted) and flagged stale:true so the user decides whether to remove it. It
  // keeps its own id and every reference it holds: no new element is ever given
  // an id the existing board used, so a verbatim carry cannot collide, and a
  // user's arrow into a unit that has left the model keeps pointing at the
  // tinted card — which is the behavior you want.
  const renderedPaths = new Set();
  for (const e of out.elements) {
    const d = e.customData?.daftplate;
    if (d && d.path !== undefined && d.kind === undefined) renderedPaths.add(d.path);
  }
  const staleUnits = existing.elements.filter((e) => {
    const d = e.customData?.daftplate;
    return d && d.path !== undefined && d.kind === undefined && !renderedPaths.has(d.path);
  });
  if (staleUnits.length) {
    const stalePaths = new Set(staleUnits.map((e) => e.customData.daftplate.path));
    const staleIds = new Set(staleUnits.map((e) => e.id));
    // A stale unit's companions: its bound title text and its grouped detail line.
    const companions = existing.elements.filter((e) => {
      const d = e.customData?.daftplate;
      return (d && d.kind === 'detail' && stalePaths.has(d.path))
        || (e.type === 'text' && e.containerId != null && staleIds.has(e.containerId));
    });
    const carry = (e, tint) => {
      const c = structuredClone(e);
      c.opacity = 60;
      tint(c);
      out.elements.push(c);
    };
    for (const e of staleUnits) {
      carry(e, (c) => {
        c.strokeStyle = 'dashed';
        c.strokeColor = '#adb5bd';
        c.customData = { daftplate: { ...e.customData.daftplate, stale: true } };
        if (c.type !== 'frame') c.backgroundColor = '#f1f3f5';
      });
    }
    for (const e of companions) carry(e, () => {});
  }

  // Pass user-created elements through verbatim — untouched, appended above the
  // regenerated board. Their references are never rewritten; id preservation is
  // what keeps them pointing where the user aimed them.
  for (const e of existing.elements) {
    if (!isGenerated(e)) out.elements.push(structuredClone(e));
  }

  // A carried stale element may still list a relation arrow the model no longer
  // draws; drop entries that no longer resolve rather than leave the board
  // holding dangling references.
  const finalIds = new Set(out.elements.map((e) => e.id));
  for (const el of out.elements) {
    if (!el.customData?.daftplate?.stale || !Array.isArray(el.boundElements)) continue;
    el.boundElements = el.boundElements.filter((b) => finalIds.has(b.id));
  }

  // Refuse rather than corrupt. If something the user drew points at an element
  // this update cannot preserve — an arrow bound to a legend swatch, which has no
  // identity of its own — the merge is abandoned whole. A board that looks valid
  // and means something else is worse than one that was never written.
  for (const e of existing.elements) {
    if (isGenerated(e)) continue;
    for (const ref of [e.containerId, e.frameId, e.startBinding?.elementId, e.endBinding?.elementId]) {
      if (ref != null && !finalIds.has(ref)) {
        throw new Error(`a hand-drawn element references ${ref}, which this update cannot preserve `
          + '— refusing merge');
      }
    }
  }

  // Record where each card was actually written. The next update compares a
  // card's position against it to tell a move the user made from one the app's
  // frame-drag desync inflicted.
  for (const el of out.elements) {
    const d = el.customData?.daftplate;
    if (el.type === 'rectangle' && d?.path !== undefined && d.kind === undefined) {
      d.geom = { x: el.x, y: el.y };
    }
  }

  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const [modelPath, outBase] = args.filter((a) => !a.startsWith('--'));
  const typeAt = args.indexOf('--type');
  if (!modelPath || !outBase) {
    console.error('usage: node to-excalidraw.mjs <model.json> <out-base> '
      + '[--type <flowchart|er|sequence>] [--update | --force]');
    return 2;
  }
  let model;
  try {
    model = JSON.parse(readFileSync(modelPath, 'utf8'));
  } catch (err) {
    console.error(`cannot read model: ${err.message}`);
    return 1;
  }
  if (typeAt !== -1 && args[typeAt + 1]) model.type = args[typeAt + 1];
  const force = args.includes('--force');
  const update = args.includes('--update');
  const outPath = `${outBase}.excalidraw`;
  const exists = existsSync(outPath);

  // A board the user may have reorganized is never silently overwritten:
  // --update merges into it, --force resets it, otherwise refuse.
  if (exists && !force && !update) {
    console.error(`${outPath} already exists — it may hold hand-edits. `
      + 'Pass --update to merge into it, or --force to overwrite deliberately.');
    return 1;
  }

  let out;
  try {
    out = render(model);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  // Update mode: merge the fresh render into the existing, hand-edited board.
  if (update && !force && exists) {
    let existingBoard;
    try {
      existingBoard = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch (err) {
      console.error(`cannot read existing board: ${err.message}`);
      return 1;
    }
    let merged;
    try {
      merged = merge(out.excalidraw, existingBoard);
    } catch (err) {
      // Refusal (markerless / ambiguous): never overwrite the user's board.
      // Write the fresh render to a suffixed name so nothing is lost.
      const alt = `${outBase}.new`;
      writeFileSync(`${alt}.excalidraw`, `${JSON.stringify(out.excalidraw, null, 2)}\n`, 'utf8');
      writeFileSync(`${alt}.mmd`, `${out.mermaid}\n`, 'utf8');
      console.error(`cannot merge: ${err.message}. Wrote a fresh board to ${alt}.excalidraw instead — `
        + `${outPath} left untouched.`);
      return 1;   // a refusal must never read as a successful update
    }
    writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    writeFileSync(`${outBase}.mmd`, `${out.mermaid}\n`, 'utf8');
    console.log(`merged into ${outPath} and refreshed ${outBase}.mmd`);
    return 0;
  }

  // Fresh render — a new board, or a --force reset from scratch.
  writeFileSync(outPath, `${JSON.stringify(out.excalidraw, null, 2)}\n`, 'utf8');
  writeFileSync(`${outBase}.mmd`, `${out.mermaid}\n`, 'utf8');
  console.log(`wrote ${outPath} and ${outBase}.mmd`);
  return 0;
}

export { main };

// Self-contained CLI entry — deliberately no scripts/lib/cli.mjs import, so the
// converter runs standalone from the installed skill directory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
