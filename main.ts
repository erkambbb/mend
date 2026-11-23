// mend: applies an edit an AI model wrote (a unified diff, SEARCH/REPLACE blocks, a V4A patch or JSON tool calls) to
// the tree of text files under the working directory, as SPEC.md specifies. Node 22 and its standard library alone;
// run it as `node main.ts [--format=NAME] [--check] [--strict] [PATCH]`.
//
// Layout: the command line (section 1), the file and patch line model (section 3), format detection (section 4), line
// matching at three tiers (section 5), one reader per format (sections 6 to 9), and the run that applies every edit
// to an in-memory tree and writes it all or nothing (sections 2 and 10).

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------------------------------------------
// Outcomes

/** An exit-2 answer: usage, no-patch, format or parse. */
class Stop {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}

/** A parse fault at a 1-based patch line. */
const parseError = (lineNo: number): Stop => new Stop(`error: parse ${lineNo}`);

/** One failed edit: its code and the path the failure concerns. */
class Failure {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers

const isBlank = (s: string): boolean => s.trim() === '';
const dropTrailingSpaceTab = (s: string): string => s.replace(/[ \t]+$/, '');
const dropOuterSpaceTab = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const indentOf = (s: string): string => /^[ \t]*/.exec(s)![0];

/** A patch's lines: split at \n, one trailing \r removed from each, no empty piece after a final \n. */
function patchLinesOf(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** Section 3: not empty, no leading /, no backslash, no empty, . or .. segment. */
function isSafePath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.includes('\\')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** A text file as lines: its own break, and whether it ends with that break. */
interface Doc {
  lines: string[];
  br: string;
  eol: boolean;
}

function docOf(text: string): Doc {
  if (text === '') return { lines: [], br: '\n', eol: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const lines = text.split(br);
  const eol = text.endsWith(br);
  if (eol) lines.pop();
  return { lines, br, eol };
}

/** A file of no lines is written empty; otherwise its lines joined by its break, plus a final one when it has one. */
function textOf(doc: Doc): string {
  if (doc.lines.length === 0) return '';
  return doc.lines.join(doc.br) + (doc.eol ? doc.br : '');
}

/** A file an edit creates: LF breaks, ended by a line break unless `eol` is false. */
const createdText = (lines: string[], eol = true): string => textOf({ lines, br: '\n', eol });

// ---------------------------------------------------------------------------------------------------------------
// Section 5: matching lines at three tiers

const TIERS: Array<(s: string) => string> = [(s) => s, dropTrailingSpaceTab, dropOuterSpaceTab];

interface Found {
  tier: number;
  /** Every accepted occurrence at that tier, ascending. */
  at: number[];
}

/**
 * The occurrences of `old` in `lines` at the first tier with at least one that `accept` takes (tier 0 alone when
 * strict), or null when there is none at any tier. Occurrences may overlap.
 */
function locate(lines: string[], old: string[], strict: boolean, accept: (pos: number) => boolean = () => true): Found | null {
  const last = strict ? 0 : 2;
  for (let tier = 0; tier <= last; tier += 1) {
    const norm = TIERS[tier]!;
    const want = old.map(norm);
    const have = lines.map(norm);
    const at: number[] = [];
    for (let pos = 0; pos + want.length <= have.length; pos += 1) {
      if (!accept(pos)) continue;
      let ok = true;
      for (let k = 0; k < want.length; k += 1) {
        if (have[pos + k] !== want[k]) {
          ok = false;
          break;
        }
      }
      if (ok) at.push(pos);
    }
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** One line of a hunk or chunk body: context (' '), old ('-') or new ('+'). */
interface BodyLine {
  kind: ' ' | '-' | '+';
  text: string;
}

const oldSide = (body: BodyLine[]): string[] => body.filter((b) => b.kind !== '+').map((b) => b.text);
const newSide = (body: BodyLine[]): string[] => body.filter((b) => b.kind !== '-').map((b) => b.text);

/**
 * The lines that replace the matched lines at `pos` (found at `tier`): a context line is the file's own matched line;
 * at tier 2 every other non-blank line that starts with the indent of O's first line has it swapped for the indent
 * of the file's first matched line.
 */
function replacement(lines: string[], pos: number, tier: number, body: BodyLine[]): string[] {
  const old = oldSide(body);
  const fileIndent = old.length > 0 && pos < lines.length ? indentOf(lines[pos]!) : '';
  const patchIndent = old.length > 0 ? indentOf(old[0]!) : '';
  const out: string[] = [];
  let oi = 0;
  for (const b of body) {
    if (b.kind === '-') {
      oi += 1;
    } else if (b.kind === ' ') {
      out.push(lines[pos + oi]!);
      oi += 1;
    } else if (tier === 2 && old.length > 0 && !isBlank(b.text) && b.text.startsWith(patchIndent)) {
      out.push(fileIndent + b.text.slice(patchIndent.length));
    } else {
      out.push(b.text);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The tree as the edits leave it

class Tree {
  private readonly before = new Map<string, string | null>();
  readonly after = new Map<string, string | null>();

  /** The file's text before the patch, or null when there is no such regular file. */
  original(p: string): string | null {
    if (!this.before.has(p)) {
      let text: string | null = null;
      try {
        if (statSync(p).isFile()) text = readFileSync(p, 'utf8');
      } catch {
        text = null;
      }
      this.before.set(p, text);
    }
    return this.before.get(p)!;
  }

  get(p: string): string | null {
    return this.after.has(p) ? this.after.get(p)! : this.original(p);
  }

  /** Whether a path is taken: a file as the edits left it, or a directory on disk the patch has not touched. */
  taken(p: string): boolean {
    if (this.get(p) !== null) return true;
    if (this.after.has(p)) return false;
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  set(p: string, text: string | null): void {
    this.after.set(p, text);
  }
}

/** One edit of a patch. It throws a Failure, or records its changes in the tree. A move reports its pair. */
type Edit = (tree: Tree, strict: boolean) => { from: string; to: string } | void;

const checkSafe = (...paths: string[]): void => {
  for (const p of paths) if (!isSafePath(p)) throw new Failure('unsafe', p);
};

function mustExist(tree: Tree, p: string): string {
  const text = tree.get(p);
  if (text === null) throw new Failure('missing', p);
  return text;
}

function mustBeFree(tree: Tree, p: string): void {
  if (tree.taken(p)) throw new Failure('exists', p);
}

// ---------------------------------------------------------------------------------------------------------------
// Section 4: detecting the format

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.startsWith('diff --git ')) return 'unified';
    if (lines[i]!.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) return 'unified';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 6: unified diffs

interface Hunk {
  /** A of `@@ -A[,B] +C[,D] @@`. */
  a: number;
  body: BodyLine[];
  /** A `\` line follows the hunk's last context or `+` line. */
  noEol: boolean;
  /** A `\` line follows the hunk's last `+` line (for a creation). */
  noEolAfterPlus: boolean;
}

interface Section {
  gitOld: string | null;
  gitNew: string | null;
  pair: { old: string | null; neu: string | null } | null;
  renameFrom: string | null;
  renameTo: string | null;
  newFile: boolean;
  deletedFile: boolean;
  hunks: Hunk[];
}

/** The path of a `--- ` or `+++ ` line: after the four characters, up to the first tab, trimmed, a/ or b/ removed. */
function headerPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

/** The two paths of `diff --git a/<X> b/<Y>`, or null when the line is not of that form. */
function gitPaths(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return null;
  const splits: Array<[string, string]> = [];
  for (let k = rest.indexOf(' b/', 2); k >= 0; k = rest.indexOf(' b/', k + 1)) {
    const x = rest.slice(2, k);
    const y = rest.slice(k + 3);
    if (x !== '' && y !== '') splits.push([x, y]);
  }
  if (splits.length === 0) return null;
  return splits.find(([x, y]) => x === y) ?? splits[splits.length - 1]!;
}

function parseUnified(L: string[]): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inHeader = false;
  const pairAt = (i: number): boolean => L[i]!.startsWith('--- ') && i + 1 < L.length && L[i + 1]!.startsWith('+++ ');
  const open = (gitOld: string | null, gitNew: string | null): Section => {
    const s: Section = { gitOld, gitNew, pair: null, renameFrom: null, renameTo: null, newFile: false, deletedFile: false, hunks: [] };
    sections.push(s);
    inHeader = true;
    return s;
  };

  let i = 0;
  while (i < L.length) {
    const line = L[i]!;
    if (line.startsWith('diff --git ')) {
      const paths = gitPaths(line);
      if (paths === null) throw parseError(i + 1);
      cur = open(paths[0], paths[1]);
      i += 1;
      continue;
    }
    if (pairAt(i)) {
      // A pair inside a section's header (before its first hunk) is part of that header; anywhere else it starts one.
      if (!(cur !== null && inHeader)) cur = open(null, null);
      cur.pair = { old: headerPath(line), neu: headerPath(L[i + 1]!) };
      i += 2;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m === null || cur === null) throw parseError(i + 1);
      inHeader = false;
      const raw: string[] = [];
      let j = i + 1;
      while (j < L.length) {
        const b = L[j]!;
        if (b.startsWith('diff --git ') || pairAt(j)) break;
        if (b !== '' && !' -+\\'.includes(b[0]!)) break;
        raw.push(b);
        j += 1;
      }
      while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
      cur.hunks.push(hunkOf(Number(m[1]), raw));
      i = j;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('--- ')) throw parseError(i + 2);
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice('rename from '.length);
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice('rename to '.length);
      else if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deletedFile = true;
    }
    i += 1;
  }
  return sections;
}

/** A hunk from its header's A and its body lines (a `\` line kept only as a mark on the line before it). */
function hunkOf(a: number, raw: string[]): Hunk {
  const body: BodyLine[] = [];
  /** For each body line, whether a `\` line follows it. */
  const marked: boolean[] = [];
  for (const r of raw) {
    if (r.startsWith('\\')) {
      if (marked.length > 0) marked[marked.length - 1] = true;
      continue;
    }
    if (r === '') body.push({ kind: ' ', text: '' });
    else body.push({ kind: r[0] as ' ' | '-' | '+', text: r.slice(1) });
    marked.push(false);
  }
  let lastKept = -1;
  let lastPlus = -1;
  body.forEach((b, k) => {
    if (b.kind !== '-') lastKept = k;
    if (b.kind === '+') lastPlus = k;
  });
  return { a, body, noEol: lastKept >= 0 && marked[lastKept]!, noEolAfterPlus: lastPlus >= 0 && marked[lastPlus]! };
}

/** Applies a section's hunks in order to a file's lines; a hunk that finds nothing fails with no-match at `path`. */
function applyHunks(doc: Doc, hunks: Hunk[], strict: boolean, path: string): Doc {
  const lines = [...doc.lines];
  let eol = doc.eol;
  let d = 0;
  for (const h of hunks) {
    const old = oldSide(h.body);
    const neu = newSide(h.body);
    let pos: number;
    let tier = 0;
    if (old.length > 0) {
      const found = locate(lines, old, strict);
      if (found === null) throw new Failure('no-match', path);
      tier = found.tier;
      const target = h.a - 1 + d;
      pos = found.at[0]!;
      for (const p of found.at) if (Math.abs(p - target) < Math.abs(pos - target)) pos = p;
    } else {
      pos = Math.min(Math.max(h.a + d, 0), lines.length);
    }
    const toEnd = pos + old.length === lines.length;
    lines.splice(pos, old.length, ...replacement(lines, pos, tier, h.body));
    if (toEnd) eol = !h.noEol;
    d += neu.length - old.length;
  }
  return { lines, br: doc.br, eol };
}

function unifiedEdits(L: string[]): Edit[] {
  const sections = parseUnified(L);
  return sections.map((s): Edit => {
    const oldPath = s.pair !== null ? s.pair.old : s.renameFrom ?? s.gitOld;
    const newPath = s.pair !== null ? s.pair.neu : s.renameTo ?? s.gitNew;
    const creation = s.newFile || (s.pair !== null && s.pair.old === null);
    const deletion = !creation && (s.deletedFile || (s.pair !== null && s.pair.neu === null));

    if (creation) {
      return (tree) => {
        const p = newPath ?? oldPath ?? '/dev/null';
        checkSafe(p);
        mustBeFree(tree, p);
        const plus: string[] = [];
        let eol = true;
        for (const h of s.hunks) {
          for (const b of h.body) if (b.kind === '+') plus.push(b.text);
          if (h.body.some((b) => b.kind === '+')) eol = !h.noEolAfterPlus;
        }
        tree.set(p, createdText(plus, eol));
      };
    }
    if (deletion) {
      return (tree) => {
        const p = oldPath ?? newPath ?? '/dev/null';
        checkSafe(p);
        mustExist(tree, p);
        tree.set(p, null);
      };
    }
    const from = oldPath ?? '/dev/null';
    const to = newPath ?? from;
    if (from !== to) {
      return (tree, strict) => {
        checkSafe(from, to);
        const text = mustExist(tree, from);
        mustBeFree(tree, to);
        const out = applyHunks(docOf(text), s.hunks, strict, from);
        tree.set(from, null);
        tree.set(to, textOf(out));
        return { from, to };
      };
    }
    return (tree, strict) => {
      checkSafe(from);
      const text = mustExist(tree, from);
      tree.set(from, textOf(applyHunks(docOf(text), s.hunks, strict, from)));
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Section 7: SEARCH/REPLACE blocks

const isMarker = (line: string, marker: string): boolean => line.trimEnd() === marker;

function searchReplaceEdits(L: string[]): Edit[] {
  const edits: Edit[] = [];
  let start = 0;
  let prevPath: string | null = null;
  for (let i = 0; i < L.length; i += 1) {
    if (!isMarker(L[i]!, '<<<<<<< SEARCH')) continue;
    let path: string | null = null;
    for (let k = i - 1; k >= start; k -= 1) {
      const t = L[k]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw parseError(i + 1);
    let sep = -1;
    for (let k = i + 1; k < L.length && sep < 0; k += 1) if (isMarker(L[k]!, '=======')) sep = k;
    let end = -1;
    if (sep >= 0) for (let k = sep + 1; k < L.length && end < 0; k += 1) if (isMarker(L[k]!, '>>>>>>> REPLACE')) end = k;
    if (end < 0) throw parseError(i + 1);
    edits.push(blockEdit(path, L.slice(i + 1, sep), L.slice(sep + 1, end)));
    prevPath = path;
    start = end + 1;
    i = end;
  }
  return edits;
}

function blockEdit(p: string, old: string[], neu: string[]): Edit {
  return (tree, strict) => {
    checkSafe(p);
    if (old.length === 0) {
      mustBeFree(tree, p);
      tree.set(p, createdText(neu));
      return;
    }
    const doc = docOf(mustExist(tree, p));
    const found = locate(doc.lines, old, strict);
    if (found === null) throw new Failure('no-match', p);
    if (found.at.length > 1) throw new Failure('ambiguous', p);
    const pos = found.at[0]!;
    const body: BodyLine[] = [...old.map((text): BodyLine => ({ kind: '-', text })), ...neu.map((text): BodyLine => ({ kind: '+', text }))];
    doc.lines.splice(pos, old.length, ...replacement(doc.lines, pos, found.tier, body));
    tree.set(p, textOf(doc));
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Section 8: V4A patches

interface Chunk {
  anchor: string | null;
  body: BodyLine[];
  eof: boolean;
}

function v4aEdits(L: string[]): Edit[] {
  const nonBlank: number[] = [];
  L.forEach((l, i) => {
    if (!isBlank(l)) nonBlank.push(i);
  });
  if (nonBlank.length === 0) throw parseError(1);
  const first = nonBlank[0]!;
  const last = nonBlank[nonBlank.length - 1]!;
  if (L[first]!.trim() !== '*** Begin Patch') throw parseError(first + 1);
  if (last === first || L[last]!.trim() !== '*** End Patch') throw parseError(L.length + 1);

  interface Raw {
    kind: 'add' | 'delete' | 'update';
    path: string;
    lineNo: number;
    rows: number[];
  }
  const raws: Raw[] = [];
  const heads: Array<[string, Raw['kind']]> = [
    ['*** Add File: ', 'add'],
    ['*** Delete File: ', 'delete'],
    ['*** Update File: ', 'update'],
  ];
  for (let i = first + 1; i < last; i += 1) {
    const line = L[i]!;
    const head = heads.find(([h]) => line.startsWith(h));
    if (head !== undefined) {
      raws.push({ kind: head[1], path: line.slice(head[0].length).trim(), lineNo: i + 1, rows: [] });
      continue;
    }
    if (raws.length === 0) {
      if (isBlank(line)) continue;
      throw parseError(i + 1);
    }
    raws[raws.length - 1]!.rows.push(i);
  }

  const edits: Edit[] = [];
  for (const r of raws) {
    while (r.rows.length > 0 && isBlank(L[r.rows[r.rows.length - 1]!]!)) r.rows.pop();
    if (r.kind === 'add') {
      const content: string[] = [];
      for (const i of r.rows) {
        const line = L[i]!;
        if (line === '') content.push('');
        else if (line.startsWith('+')) content.push(line.slice(1));
        else throw parseError(i + 1);
      }
      const p = r.path;
      edits.push((tree) => {
        checkSafe(p);
        mustBeFree(tree, p);
        tree.set(p, createdText(content));
      });
    } else if (r.kind === 'delete') {
      if (r.rows.length > 0) throw parseError(r.rows[0]! + 1);
      const p = r.path;
      edits.push((tree) => {
        checkSafe(p);
        mustExist(tree, p);
        tree.set(p, null);
      });
    } else {
      edits.push(updateEdit(L, r.path, r.lineNo, r.rows));
    }
  }
  return edits;
}

function updateEdit(L: string[], p: string, lineNo: number, rows: number[]): Edit {
  let moveTo: string | null = null;
  let k = 0;
  if (rows.length > 0 && L[rows[0]!]!.startsWith('*** Move to: ')) {
    moveTo = L[rows[0]!]!.slice('*** Move to: '.length).trim();
    k = 1;
  }
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  for (; k < rows.length; k += 1) {
    const i = rows[k]!;
    const line = L[i]!;
    if (line.startsWith('@@')) {
      const anchor = line.slice(2).trim();
      cur = { anchor: anchor === '' ? null : anchor, body: [], eof: false };
      chunks.push(cur);
    } else if (line === '*** End of File') {
      if (cur === null) throw parseError(i + 1);
      cur.eof = true;
      cur = null;
    } else if (line === '' || line[0] === ' ' || line[0] === '-' || line[0] === '+') {
      if (cur === null) {
        if (chunks.length > 0) throw parseError(i + 1);
        cur = { anchor: null, body: [], eof: false };
        chunks.push(cur);
      }
      cur.body.push(line === '' ? { kind: ' ', text: '' } : { kind: line[0] as ' ' | '-' | '+', text: line.slice(1) });
    } else {
      throw parseError(i + 1);
    }
  }
  if (chunks.length === 0 && moveTo === null) throw parseError(lineNo);

  return (tree, strict) => {
    checkSafe(p);
    if (moveTo !== null) checkSafe(moveTo);
    const doc = docOf(mustExist(tree, p));
    if (moveTo !== null) mustBeFree(tree, moveTo);
    const lines = doc.lines;
    let cursor = 0;
    for (const c of chunks) {
      if (c.anchor !== null) {
        const at = anchorLine(lines, c.anchor, cursor, strict);
        if (at < 0) throw new Failure('no-match', p);
        cursor = at + 1;
      }
      const old = oldSide(c.body);
      let pos: number;
      let tier = 0;
      if (old.length > 0) {
        const from = cursor;
        const found = locate(lines, old, strict, (q) => q >= from && (!c.eof || q + old.length === lines.length));
        if (found === null) throw new Failure('no-match', p);
        pos = found.at[0]!;
        tier = found.tier;
      } else {
        pos = c.eof ? lines.length : cursor;
      }
      const written = replacement(lines, pos, tier, c.body);
      lines.splice(pos, old.length, ...written);
      cursor = pos + written.length;
    }
    const text = textOf(doc);
    if (moveTo === null) {
      tree.set(p, text);
      return;
    }
    tree.set(p, null);
    tree.set(moveTo, text);
    return { from: p, to: moveTo };
  };
}

/** The first line at or after `from` equal to the anchor at the first tier with one, or -1. */
function anchorLine(lines: string[], anchor: string, from: number, strict: boolean): number {
  const last = strict ? 0 : 2;
  for (let tier = 0; tier <= last; tier += 1) {
    const norm = TIERS[tier]!;
    const want = norm(anchor);
    for (let i = from; i < lines.length; i += 1) if (norm(lines[i]!) === want) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 9: JSON edits

/** One edit object, or null when it is not a valid one (a parse fault). */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;

  if (o.command === 'create') {
    const fileText = o.file_text;
    if (typeof fileText !== 'string') return null;
    return (tree) => {
      checkSafe(p);
      mustBeFree(tree, p);
      tree.set(p, fileText);
    };
  }

  if (o.command === 'str_replace') {
    const oldStr = o.old_str;
    const newStr = o.new_str === undefined ? '' : o.new_str;
    if (typeof oldStr !== 'string' || oldStr === '' || typeof newStr !== 'string') return null;
    return (tree) => {
      checkSafe(p);
      const text = mustExist(tree, p);
      const crlf = docOf(text).br === '\r\n';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const hay = lf(text);
      const needle = lf(oldStr);
      let count = 0;
      for (let at = hay.indexOf(needle); at >= 0 && count < 2; at = hay.indexOf(needle, at + 1)) count += 1;
      if (count === 0) throw new Failure('no-match', p);
      if (count > 1) throw new Failure('ambiguous', p);
      const at = hay.indexOf(needle);
      const out = hay.slice(0, at) + lf(newStr) + hay.slice(at + needle.length);
      tree.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }

  if (o.command === 'insert') {
    const line = o.insert_line;
    const newStr = o.new_str;
    if (typeof line !== 'number' || !Number.isInteger(line) || typeof newStr !== 'string') return null;
    const added = patchLinesOf(newStr);
    return (tree) => {
      checkSafe(p);
      const doc = docOf(mustExist(tree, p));
      if (line < 0 || line > doc.lines.length) throw new Failure('no-match', p);
      doc.lines.splice(line, 0, ...added);
      tree.set(p, textOf(doc));
    };
  }

  return null;
}

function jsonEdits(text: string, L: string[]): Edit[] {
  const first = L.findIndex((l) => !isBlank(l));
  if (first < 0) return [];
  const edits: Edit[] = [];
  if (L[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw parseError(first + 1);
    }
    if (!Array.isArray(v)) throw parseError(first + 1);
    for (const item of v) {
      const e = jsonEdit(item);
      if (e === null) throw parseError(first + 1);
      edits.push(e);
    }
    return edits;
  }
  L.forEach((l, i) => {
    if (isBlank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw parseError(i + 1);
    edits.push(e);
  });
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections 1, 2 and 10: the run

const FORMAT_NAMES = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

interface Answer {
  code: number;
  out: string[];
}

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

function run(args: string[]): Answer {
  let format: string | null = null;
  let check = false;
  let strict = false;
  let ended = false;
  const positional: string[] = [];
  for (const a of args) {
    if (!ended && a === '--') {
      ended = true;
    } else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMAT_NAMES.includes(a.slice('--format='.length))) format = a.slice('--format='.length);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) return { code: 2, out: ['error: usage'] };

  const file = positional.length === 0 || positional[0] === '-' ? null : positional[0]!;
  let text = '';
  if (file === null) {
    try {
      text = readFileSync(0, 'utf8');
    } catch {
      text = '';
    }
  } else {
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return { code: 2, out: ['error: no-patch'] };
    }
  }

  const L = patchLinesOf(text);
  const kind = format === null || format === 'auto' ? detect(L) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };

  let edits: Edit[];
  try {
    if (kind === 'unified') edits = unifiedEdits(L);
    else if (kind === 'search-replace') edits = searchReplaceEdits(L);
    else if (kind === 'v4a') edits = v4aEdits(L);
    else edits = jsonEdits(text, L);
    if (edits.length === 0) throw parseError(1);
  } catch (e) {
    if (e instanceof Stop) return { code: 2, out: [e.line] };
    throw e;
  }

  const tree = new Tree();
  const failures: Failure[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  for (const edit of edits) {
    const saved = new Map(tree.after);
    try {
      const moved = edit(tree, strict);
      if (moved) moves.push(moved);
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      tree.after.clear();
      for (const [k, v] of saved) tree.after.set(k, v);
      failures.push(e);
    }
  }
  if (failures.length > 0) {
    return { code: 1, out: [...failures.map((f) => `error: ${f.code} ${f.path}`), `failed: ${failures.length} of ${edits.length} edits`] };
  }

  // What changed: A, D and M rows by path, a successful move's D and A pair folded into one R row sorted by its new path.
  const changed = [...tree.after.keys()].filter((p) => tree.original(p) !== tree.after.get(p));
  const rows = new Map<string, string>();
  for (const p of changed) rows.set(p, `${tree.original(p) === null ? 'A' : tree.after.get(p) === null ? 'D' : 'M'} ${p}`);
  const folded = new Set<string>();
  const renames = new Map<string, string>();
  for (const { from, to } of moves) {
    if (folded.has(from) || folded.has(to)) continue;
    if (tree.original(from) !== null && tree.get(from) === null && tree.original(to) === null && tree.get(to) !== null) {
      folded.add(from);
      folded.add(to);
      rows.delete(from);
      rows.delete(to);
      renames.set(to, `R ${from} -> ${to}`);
    }
  }
  for (const [to, row] of renames) rows.set(to, row);
  const out = [...rows.keys()].sort(byteOrder).map((k) => rows.get(k)!);

  if (!check) {
    for (const p of changed) if (tree.after.get(p) === null) rmSync(p, { force: true });
    for (const p of changed) {
      const now = tree.after.get(p);
      if (now === null || now === undefined) continue;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...out, `ok: ${out.length} ${out.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
