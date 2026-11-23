// Edge cases of SPEC.md beyond the practice set, each with the outcome the sentence it tests asks for.
// Run: node test/edge.ts [name prefix...]

import { runCheck } from '../runner.ts';

interface Case {
  name: string;
  argv: string[];
  stdin?: string;
  files: Record<string, string>;
  exit: number;
  stdout: string;
  /** Files afterwards that differ from the start (null: gone). Omitted: the start files unchanged. */
  changes?: Record<string, string | null>;
}

const J = (o: unknown): string => JSON.stringify(o);

const cases: Case[] = [
  // ---- section 1: invocation
  { name: 'c-unknown-option', argv: ['-x'], files: {}, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-format-bad-value', argv: ['--format=diff', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-format-no-value', argv: ['--format', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-format-empty-value', argv: ['--format=', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-twice-check', argv: ['--check', 'p', '--check'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-twice-format-same', argv: ['--format=json', '--format=json', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-two-positionals', argv: ['p', 'q'], files: { p: 'x', q: 'y' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-usage-beats-no-patch', argv: ['nope.patch', '--bogus'], files: {}, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-dash-and-file', argv: ['-', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'c-no-patch', argv: ['nope.patch'], files: {}, exit: 2, stdout: 'error: no-patch\n' },
  { name: 'c-no-patch-dir', argv: ['dir'], files: { 'dir/a.txt': 'a\n' }, exit: 2, stdout: 'error: no-patch\n' },
  { name: 'c-no-patch-beats-format', argv: ['--format=json', 'nope'], files: {}, exit: 2, stdout: 'error: no-patch\n' },
  {
    name: 'c-dashdash-positional',
    argv: ['--strict', '--', '-p.json'],
    files: { '-p.json': J({ command: 'create', path: 'n.txt', file_text: 'hi' }) },
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    changes: { 'n.txt': 'hi' },
  },
  {
    name: 'c-dashdash-then-option-like',
    argv: ['--', '--check'],
    files: { '--check': J({ command: 'create', path: 'n.txt', file_text: 'hi' }) },
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    changes: { 'n.txt': 'hi' },
  },
  {
    name: 'c-dashdash-dash-is-stdin',
    argv: ['--', '-'],
    stdin: J({ command: 'create', path: 'n.txt', file_text: 'hi' }),
    files: {},
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    changes: { 'n.txt': 'hi' },
  },
  { name: 'c-empty-stdin', argv: [], stdin: '', files: {}, exit: 2, stdout: 'error: format\n' },
  { name: 'c-blank-stdin-forced', argv: ['--format=unified'], stdin: '\n  \n', files: {}, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'c-forced-v4a', argv: ['--format=v4a'], stdin: '\nhello\n', files: {}, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'c-forced-search-replace-none', argv: ['--format=search-replace'], stdin: '--- a/x\n+++ b/x\n', files: {}, exit: 2, stdout: 'error: parse 1\n' },
  {
    name: 'c-forced-json-lines',
    argv: ['--format=json', 'p'],
    files: { p: '\n\n*** Begin Patch\n' },
    exit: 2,
    stdout: 'error: parse 3\n',
  },
  {
    name: 'c-check-writes-nothing',
    argv: ['p', '--check'],
    files: { p: J({ command: 'create', path: 'd/n.txt', file_text: 'hi' }), 'a.txt': 'a\n' },
    exit: 0,
    stdout: 'A d/n.txt\nok: 1 file\n',
  },
  {
    name: 'c-parse-before-files',
    argv: ['p'],
    files: { p: `${J({ command: 'str_replace', path: 'missing.txt', old_str: 'a', new_str: 'b' })}\nnot json\n` },
    exit: 2,
    stdout: 'error: parse 2\n',
  },

  // ---- section 3: paths and lines
  {
    name: 'p-unsafe-forms',
    argv: ['p'],
    files: {
      p: [
        { command: 'create', path: './a', file_text: '' },
        { command: 'create', path: 'a/../b', file_text: '' },
        { command: 'create', path: 'a//b', file_text: '' },
        { command: 'create', path: '', file_text: '' },
        { command: 'create', path: 'a\\b', file_text: '' },
        { command: 'create', path: 'a/', file_text: '' },
        { command: 'create', path: '/abs', file_text: '' },
        { command: 'create', path: 'ok.txt', file_text: '' },
      ]
        .map((o) => J(o))
        .join('\n'),
    },
    exit: 1,
    stdout: 'error: unsafe ./a\nerror: unsafe a/../b\nerror: unsafe a//b\nerror: unsafe \nerror: unsafe a\\b\nerror: unsafe a/\nerror: unsafe /abs\nfailed: 7 of 8 edits\n',
  },
  {
    name: 'p-dir-created',
    argv: ['p'],
    files: { p: 'deep/er/x.txt\n<<<<<<< SEARCH\n=======\nhi\n>>>>>>> REPLACE\n' },
    exit: 0,
    stdout: 'A deep/er/x.txt\nok: 1 file\n',
    changes: { 'deep/er/x.txt': 'hi\n' },
  },
  {
    name: 'p-no-lines-written-empty',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\na\nb\n=======\n>>>>>>> REPLACE\n', x: 'a\nb\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: '' },
  },
  {
    name: 'p-crlf-kept',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\nb\n=======\nB\nB2\n>>>>>>> REPLACE\n', x: 'a\r\nb\r\nc' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\r\nB\r\nB2\r\nc' },
  },
  {
    name: 'p-unchanged-not-listed',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\nx\n<<<<<<< SEARCH\nb\n=======\na\n>>>>>>> REPLACE\n', x: 'a\n' },
    exit: 0,
    stdout: 'ok: 0 files\n',
  },
  {
    name: 'p-delete-then-recreate-same',
    argv: ['p'],
    files: { p: `${J({ command: 'create', path: 'y', file_text: 'q' })}\n`, x: 'a\n' },
    exit: 0,
    stdout: 'A y\nok: 1 file\n',
    changes: { y: 'q' },
  },

  // ---- section 4: detection
  {
    name: 'd-search-replace-before-unified',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\nx\n<<<<<<< SEARCH   \na\n=======\nb\n>>>>>>> REPLACE\t\n', x: 'a\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'b\n' },
  },
  { name: 'd-v4a-indented-begin', argv: ['p'], files: { p: '\n   *** Begin Patch  \n*** Add File: n\n+z\n *** End Patch\n' }, exit: 0, stdout: 'A n\nok: 1 file\n', changes: { n: 'z\n' } },
  { name: 'd-none', argv: ['p'], files: { p: 'just prose\n--- not a header\n' }, exit: 2, stdout: 'error: format\n' },

  // ---- section 6: unified
  {
    name: 'u-git-paths-only',
    argv: ['p'],
    files: { p: 'diff --git a/x b/x\nindex 1..2 100644\n@@ -2 +2 @@\n-b\n+B\n', x: 'a\nb\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nB\nc\n' },
  },
  { name: 'u-hunk-before-section', argv: ['p'], files: { p: '@@ -1 +1 @@\n-a\n+b\n--- a/x\n+++ b/x\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'u-bad-hunk-header', argv: ['p'], files: { p: '--- a/x\n+++ b/x\n@@ -1,2 @@\n-a\n+b\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'u-bare-at-at', argv: ['p'], files: { p: '--- a/x\n+++ b/x\n@@\n-a\n+b\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 3\n' },
  {
    name: 'u-minus-without-plus-in-header',
    argv: ['p'],
    files: { p: 'diff --git a/x b/x\n--- a/x\n@@ -1 +1 @@\n-a\n+b\n', x: 'a\n' },
    exit: 2,
    stdout: 'error: parse 3\n',
  },
  {
    name: 'u-minus-last-line-in-header',
    argv: ['p'],
    files: { p: 'diff --git a/x b/x\n--- a/x' },
    exit: 2,
    stdout: 'error: parse 3\n',
  },
  { name: 'u-bad-git-line', argv: ['p'], files: { p: 'diff --git x y\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 1\n' },
  {
    name: 'u-tab-timestamp',
    argv: ['p'],
    files: { p: '--- a/x y.txt\t2024-01-01 00:00\n+++ b/x y.txt\t2024-01-02 00:00\n@@ -1 +1 @@\n-a\n+b\n', 'x y.txt': 'a\n' },
    exit: 0,
    stdout: 'M x y.txt\nok: 1 file\n',
    changes: { 'x y.txt': 'b\n' },
  },
  {
    name: 'u-pure-rename',
    argv: ['p'],
    files: { p: 'diff --git a/old.txt b/new/n.txt\nsimilarity index 100%\nrename from old.txt\nrename to new/n.txt\n', 'old.txt': 'a\n' },
    exit: 0,
    stdout: 'R old.txt -> new/n.txt\nok: 1 file\n',
    changes: { 'old.txt': null, 'new/n.txt': 'a\n' },
  },
  {
    name: 'u-rename-target-exists',
    argv: ['p'],
    files: { p: 'diff --git a/o b/n\nrename from o\nrename to n\n', o: 'a\n', n: 'b\n' },
    exit: 1,
    stdout: 'error: exists n\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'u-delete-ignores-hunks',
    argv: ['p'],
    files: { p: '--- a/x\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-zzz\n-yyy\n', x: 'a\nb\n' },
    exit: 0,
    stdout: 'D x\nok: 1 file\n',
    changes: { x: null },
  },
  {
    name: 'u-deleted-file-mode',
    argv: ['p'],
    files: { p: 'diff --git a/x b/x\ndeleted file mode 100644\nindex e69de29..0000000\n', x: 'a\n' },
    exit: 0,
    stdout: 'D x\nok: 1 file\n',
    changes: { x: null },
  },
  {
    name: 'u-new-file-mode-empty',
    argv: ['p'],
    files: { p: 'diff --git a/e.txt b/e.txt\nnew file mode 100644\nindex 0000000..e69de29\n' },
    exit: 0,
    stdout: 'A e.txt\nok: 1 file\n',
    changes: { 'e.txt': '' },
  },
  { name: 'u-create-exists', argv: ['p'], files: { p: '--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+hi\n', x: 'a\n' }, exit: 1, stdout: 'error: exists x\nfailed: 1 of 1 edits\n' },
  {
    name: 'u-create-no-eol',
    argv: ['p'],
    files: { p: '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n' },
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    changes: { 'n.txt': 'a\nb' },
  },
  {
    name: 'u-create-plus-only',
    argv: ['p'],
    files: { p: '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n ctx\n-gone\n+b\n' },
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    changes: { 'n.txt': 'a\nb\n' },
  },
  {
    name: 'u-nearest-tie-earlier',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -4 +4 @@\n-X\n+Y\n', x: 'a\nX\nb\nc\nd\nX\ne\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nY\nb\nc\nd\nX\ne\n' },
  },
  {
    name: 'u-offset-d',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1,0 +1,3 @@\n+n1\n+n2\n+n3\n@@ -5 +8 @@\n-X\n+Y\n', x: 'X\na\nb\nc\nX\nd\ne\nf\ng\nX\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'X\nn1\nn2\nn3\na\nb\nc\nY\nd\ne\nf\ng\nX\n' },
  },
  {
    name: 'u-insert-empty-old',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -2,0 +3 @@\n+new\n', x: 'a\nb\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nb\nnew\nc\n' },
  },
  {
    name: 'u-insert-past-end',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -40,0 +41 @@\n+new\n', x: 'a\nb' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nb\nnew\n' },
  },
  {
    name: 'u-insert-into-empty-file',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hello\n', x: '' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'hello\n' },
  },
  {
    name: 'u-delete-last-noeol-line',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -2 +1,0 @@\n-b\n\\ No newline at end of file\n', x: 'a\nb' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\n' },
  },
  {
    name: 'u-add-eol-at-end',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n', x: 'a\nb' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nb\n' },
  },
  {
    name: 'u-middle-keeps-noeol',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+A\n', x: 'a\nb\nc' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'A\nb\nc' },
  },
  {
    name: 'u-tier2-reindent',
    argv: ['p'],
    files: { p: '--- a/x.py\n+++ b/x.py\n@@ -2,2 +2,3 @@\n x = 1\n-return x\n+y = 2\n+return x + y\n', 'x.py': 'def f():\n    x = 1\n    return x\n' },
    exit: 0,
    stdout: 'M x.py\nok: 1 file\n',
    changes: { 'x.py': 'def f():\n    x = 1\n    y = 2\n    return x + y\n' },
  },
  {
    name: 'u-tier1-context-from-file',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+B  \n', x: 'a  \nb\t\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a  \nB  \n' },
  },
  { name: 'u-strict-no-match', argv: ['--strict', 'p'], files: { p: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', x: 'a \n' }, exit: 1, stdout: 'error: no-match x\nfailed: 1 of 1 edits\n' },
  {
    name: 'u-blank-context-and-prose',
    argv: ['p'],
    files: { p: 'Here you go:\n```diff\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n\n-c\n+C\n```\nThanks!\n', x: 'a\n\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\n\nC\n' },
  },
  {
    name: 'u-trailing-empty-body-lines',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n\n\n', x: 'a\nb\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'A\nb\nc\n' },
  },
  {
    name: 'u-two-sections-same-file',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-b\n+c\n', x: 'a\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'c\n' },
  },
  {
    name: 'u-section-fails-whole',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+A\n@@ -3 +3 @@\n-zz\n+Z\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-q\n+Q\n', x: 'a\nb\nc\n', y: 'q\n' },
    exit: 1,
    stdout: 'error: no-match x\nfailed: 1 of 2 edits\n',
  },
  {
    name: 'u-move-with-hunk-no-match',
    argv: ['p'],
    files: { p: '--- a/o.txt\n+++ b/n.txt\n@@ -1 +1 @@\n-zz\n+Z\n', 'o.txt': 'a\n' },
    exit: 1,
    stdout: 'error: no-match o.txt\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'u-unsafe-after-prefix',
    argv: ['p'],
    files: { p: '--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n' },
    exit: 1,
    stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'u-missing-change',
    argv: ['p'],
    files: { p: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' },
    exit: 1,
    stdout: 'error: missing x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'u-crlf-patch-and-file',
    argv: ['p'],
    files: { p: '--- a/x\r\n+++ b/x\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+B\r\n', x: 'a\r\nb\r\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\r\nB\r\n' },
  },

  // ---- section 7: SEARCH/REPLACE
  { name: 's-first-block-no-path', argv: ['p'], files: { p: '\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 's-no-replace', argv: ['p'], files: { p: 'x\n<<<<<<< SEARCH\na\n=======\nb\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 's-no-divider', argv: ['p'], files: { p: 'x\n<<<<<<< SEARCH\na\n>>>>>>> REPLACE\n', x: 'a\n' }, exit: 2, stdout: 'error: parse 2\n' },
  {
    name: 's-path-carried',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n\n```\n<<<<<<< SEARCH\nc\n=======\nC\n>>>>>>> REPLACE\n', x: 'a\nb\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'A\nb\nC\n' },
  },
  {
    name: 's-path-skips-fence',
    argv: ['p'],
    files: { p: 'Edit:\n  dir/x.py  \n```python\n<<<<<<< SEARCH\na\n=======\nA\n>>>>>>> REPLACE\n```\n', 'dir/x.py': 'a\n' },
    exit: 0,
    stdout: 'M dir/x.py\nok: 1 file\n',
    changes: { 'dir/x.py': 'A\n' },
  },
  { name: 's-overlap-ambiguous', argv: ['p'], files: { p: 'x\n<<<<<<< SEARCH\na\na\n=======\nb\n>>>>>>> REPLACE\n', x: 'a\na\na\n' }, exit: 1, stdout: 'error: ambiguous x\nfailed: 1 of 1 edits\n' },
  {
    name: 's-tier0-beats-tier2',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n', x: '  foo\nfoo\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: '  foo\nbar\n' },
  },
  {
    name: 's-tier2-reindent',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\nif a:\n  b()\n=======\nif a:\n  c()\n\n  d()\n>>>>>>> REPLACE\n', x: 'def f():\n\tif a:\n\t  b()\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'def f():\n\tif a:\n\t  c()\n\n\t  d()\n' },
  },
  { name: 's-create-exists', argv: ['p'], files: { p: 'x\n<<<<<<< SEARCH\n=======\nz\n>>>>>>> REPLACE\n', x: 'a\n' }, exit: 1, stdout: 'error: exists x\nfailed: 1 of 1 edits\n' },
  { name: 's-missing', argv: ['p'], files: { p: 'x\n<<<<<<< SEARCH\na\n=======\nz\n>>>>>>> REPLACE\n' }, exit: 1, stdout: 'error: missing x\nfailed: 1 of 1 edits\n' },
  {
    name: 's-create-then-edit',
    argv: ['p'],
    files: { p: 'n\n<<<<<<< SEARCH\n=======\na\nb\n>>>>>>> REPLACE\nn\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n' },
    exit: 0,
    stdout: 'A n\nok: 1 file\n',
    changes: { n: 'a\nB\n' },
  },
  {
    name: 's-failures-in-order',
    argv: ['p'],
    files: { p: 'x\n<<<<<<< SEARCH\nzz\n=======\nb\n>>>>>>> REPLACE\ny\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\nx\n<<<<<<< SEARCH\na\n=======\nB\n>>>>>>> REPLACE\n', x: 'a\n' },
    exit: 1,
    stdout: 'error: no-match x\nerror: missing y\nfailed: 2 of 3 edits\n',
  },

  // ---- section 8: V4A
  { name: 'v-no-end', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: a\n+x\n' }, exit: 2, stdout: 'error: parse 4\n' },
  { name: 'v-no-end-trailing-blank', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: a\n+x\n\n' }, exit: 2, stdout: 'error: parse 5\n' },
  { name: 'v-update-no-chunk', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a\n\n*** End Patch\n', a: 'x\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'v-delete-with-lines', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File: a\n-x\n*** End Patch\n', a: 'x\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'v-junk-before-section', argv: ['p'], files: { p: '*** Begin Patch\n\nhello\n*** Add File: a\n+x\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'v-add-bad-line', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: a\n+x\ny\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 4\n' },
  { name: 'v-only-begin-end', argv: ['p'], files: { p: '*** Begin Patch\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 1\n' },
  {
    name: 'v-add-trailing-blank-dropped',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Add File: d/a.txt\n+x\n\n+y\n\n\n*** Delete File: z\n\n*** End Patch\n', z: 'q\n' },
    exit: 0,
    stdout: 'A d/a.txt\nD z\nok: 2 files\n',
    changes: { 'd/a.txt': 'x\n\ny\n', z: null },
  },
  {
    name: 'v-anchor-and-cursor',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: x\n@@ def g():\n-    return 1\n+    return 2\n*** End Patch\n', x: 'def f():\n    return 1\ndef g():\n    return 1\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'def f():\n    return 1\ndef g():\n    return 2\n' },
  },
  {
    name: 'v-anchor-missing',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: x\n@@ def h():\n-    return 1\n+    return 2\n*** End Patch\n', x: 'def f():\n    return 1\n' },
    exit: 1,
    stdout: 'error: no-match x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'v-cursor-order',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: x\n-b\n+B\n@@\n-a\n+A\n*** End Patch\n', x: 'a\nb\nc\n' },
    exit: 1,
    stdout: 'error: no-match x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'v-eof-insert',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: x\n@@\n+z\n*** End of File\n*** End Patch\n', x: 'a\nb' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nb\nz' },
  },
  {
    name: 'v-eof-only-last',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: x\n-a\n+A\n*** End of File\n*** End Patch\n', x: 'a\nb\na\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nb\nA\n' },
  },
  {
    name: 'v-move-exists',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: a\n*** Move to: b\n*** End Patch\n', a: '1\n', b: '2\n' },
    exit: 1,
    stdout: 'error: exists b\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'v-move-only',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: a\n*** Move to: z/b\n*** End Patch\n', a: '1\n' },
    exit: 0,
    stdout: 'R a -> z/b\nok: 1 file\n',
    changes: { a: null, 'z/b': '1\n' },
  },
  {
    name: 'v-add-exists-delete-missing',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Add File: a\n+x\n*** Delete File: b\n*** Update File: c\n-q\n+Q\n*** End Patch\n', a: '1\n' },
    exit: 1,
    stdout: 'error: exists a\nerror: missing b\nerror: missing c\nfailed: 3 of 3 edits\n',
  },
  {
    name: 'v-crlf-patch',
    argv: ['p'],
    files: { p: '*** Begin Patch\r\n*** Update File: x\r\n a\r\n-b\r\n+B\r\n*** End Patch\r\n', x: 'a\r\nb\r\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\r\nB\r\n' },
  },

  // ---- section 9: JSON
  {
    name: 'j-overlap-ambiguous',
    argv: ['p'],
    files: { p: J({ command: 'str_replace', path: 'x', old_str: 'aa', new_str: 'b' }), x: 'aaa' },
    exit: 1,
    stdout: 'error: ambiguous x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'j-insert-out-of-range',
    argv: ['p'],
    files: { p: J({ command: 'insert', path: 'x', insert_line: 3, new_str: 'z' }), x: 'a\nb\n' },
    exit: 1,
    stdout: 'error: no-match x\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'j-insert-end-noeol',
    argv: ['p'],
    files: { p: J({ command: 'insert', path: 'x', insert_line: 2, new_str: 'z\r\nw\n' }), x: 'a\r\nb' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\r\nb\r\nz\r\nw' },
  },
  {
    name: 'j-array-fault-line',
    argv: ['p'],
    files: { p: `\n[\n  ${J({ command: 'create', path: 'n', file_text: 'x' })},\n  {"command": "view", "path": "n"}\n]\n` },
    exit: 2,
    stdout: 'error: parse 2\n',
  },
  { name: 'j-array-empty', argv: ['p'], files: { p: '\n[]\n' }, exit: 2, stdout: 'error: parse 1\n' },
  {
    name: 'j-lines-fault-line',
    argv: ['p'],
    files: { p: `${J({ command: 'create', path: 'n', file_text: 'x' })}\n\n${J({ command: 'insert', path: 'n', insert_line: 1.5, new_str: 'z' })}\n` },
    exit: 2,
    stdout: 'error: parse 3\n',
  },
  {
    name: 'j-new-str-absent-and-extra-keys',
    argv: ['p'],
    files: { p: J({ command: 'str_replace', path: 'x', old_str: 'b\n', note: 1 }), x: 'a\nb\nc\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'a\nc\n' },
  },
  {
    name: 'j-empty-old-str-fault',
    argv: ['p'],
    files: { p: J({ command: 'str_replace', path: 'x', old_str: '', new_str: 'b' }), x: 'a\n' },
    exit: 2,
    stdout: 'error: parse 1\n',
  },
  {
    name: 'j-crlf-str-replace',
    argv: ['p'],
    files: { p: J({ command: 'str_replace', path: 'x', old_str: 'a\nb', new_str: 'A\r\nB\nC' }), x: 'a\r\nb\r\nc\r\n' },
    exit: 0,
    stdout: 'M x\nok: 1 file\n',
    changes: { x: 'A\r\nB\r\nC\r\nc\r\n' },
  },
  {
    name: 'j-sees-earlier-edits',
    argv: ['p'],
    files: {
      p: [J({ command: 'create', path: 'n', file_text: 'one\n' }), J({ command: 'str_replace', path: 'n', old_str: 'one', new_str: 'two' }), J({ command: 'create', path: 'n', file_text: 'z' })].join('\n'),
    },
    exit: 1,
    stdout: 'error: exists n\nfailed: 1 of 3 edits\n',
  },

  // ---- sections 2 and 10: listing
  {
    name: 'o-byte-order-and-rename',
    argv: ['p'],
    files: {
      p: '*** Begin Patch\n*** Add File: b.txt\n+b\n*** Update File: z.txt\n*** Move to: a.txt\n*** Add File: B.txt\n+B\n*** Add File: é.txt\n+e\n*** End Patch\n',
      'z.txt': 'z\n',
    },
    exit: 0,
    stdout: 'A B.txt\nR z.txt -> a.txt\nA b.txt\nA é.txt\nok: 4 files\n',
    changes: { 'b.txt': 'b\n', 'z.txt': null, 'a.txt': 'z\n', 'B.txt': 'B\n', 'é.txt': 'e\n' },
  },
  {
    name: 'o-move-chain-no-rename',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: a\n*** Move to: b\n*** Update File: b\n*** Move to: c\n*** End Patch\n', a: '1\n' },
    exit: 0,
    stdout: 'D a\nA c\nok: 2 files\n',
    changes: { a: null, c: '1\n' },
  },
];

const only = process.argv.slice(2);
let passed = 0;
let ran = 0;
for (const c of cases) {
  if (only.length > 0 && !only.some((o) => c.name.startsWith(o))) continue;
  ran += 1;
  const want: Record<string, string> = { ...c.files };
  for (const [p, v] of Object.entries(c.changes ?? {})) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin ?? null, files: c.files });
  const why: string[] = [];
  if (got.exit !== c.exit) why.push(`exit ${got.exit}, expected ${c.exit}`);
  if (got.stdout !== c.stdout) why.push(`stdout ${J(got.stdout)}, expected ${J(c.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p}: expected ${J(want[p])}, got ${J(got.files[p])}`);
  }
  if (why.length === 0) passed += 1;
  else process.stdout.write(`FAIL ${c.name}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`${passed} of ${ran} edge cases passed\n`);
