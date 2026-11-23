# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/erkambbb/mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/erkambbb/mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend applies the edits AI models write to a tree of text files, in four formats: unified diffs (wrong line numbers,
drifted whitespace, prose and code fences around them), SEARCH/REPLACE blocks, V4A patches and JSON text-editor tool
calls. Every edit's lines are found at the first of three matching tiers (exact, trailing whitespace ignored, all outer
whitespace ignored, re-indenting the new lines), and the whole patch is written or nothing is. `SPEC.md` is the
contract; `main.ts` implements it with Node 22's standard library alone.

## Run it

```sh
node main.ts [--format=auto|unified|search-replace|v4a|json] [--check] [--strict] [PATCH]
```

- PATCH absent or `-`: the patch is read from standard input.
- `--check`: everything but the write.
- `--strict`: exact line matching only.

Exit 0 lists each changed path (`A`, `D`, `M`, `R old -> new`) and `ok: <n> files`; exit 1 lists each failed edit
(`no-match`, `ambiguous`, `missing`, `exists`, `unsafe`) and writes nothing; exit 2 is a usage, no-patch, format or
parse error.

## Tests

```sh
node check.ts <kit>/program/generator/practice.json   # the kit's 100 practice checks
node test/edge.ts             # edge cases of SPEC.md beyond the practice set
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
