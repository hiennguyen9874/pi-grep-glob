# pi-grep-glob

Pi extension that registers native-backed `grep` and `glob` tools.

## Tool behavior

Both tools accept a single `path` string that can be:

- a file path
- a directory path
- a glob pattern
- a semicolon- or whitespace-delimited path list like `src/**/*.ts;test/**/*.ts` or `src test`

The wrappers process path-list roots in the order supplied and preserve deterministic first-seen output; `glob` de-duplicates paths returned by overlapping roots.

Defaults are aimed at code search:

- `gitignore: true`
- `hidden: true` for `glob`
- `case: true` for `grep`
- `glob.limit: 50` (maximum 1,000)
- `scanLimit: 50,000` total per tool call across all traversal roots (maximum 1,000,000)

### Important glob semantics

A plain directory path is searched recursively. Use `dir/*` to inspect only one level. This tool also treats a leading glob as recursive:

- `*.ts` behaves like `**/*.ts`
- `src/*.ts` stays non-recursive

That is intentional, but it is different from many shell globs.

## Usage examples

### `glob`

Find all TypeScript files recursively from the current working directory:

```json
{ "path": "*.ts" }
```

Find only direct `.ts` files under `src`:

```json
{ "path": "src/*.ts" }
```

Search multiple globs in one call:

```json
{ "path": "src/**/*.ts;test/**/*.ts" }
```

Search multiple directories in one call:

```json
{ "path": "src test" }
```

List everything under `src` while ignoring `.gitignore` rules:

```json
{ "path": "src", "gitignore": false }
```

Limit the number of returned paths:

```json
{ "path": "*.ts", "limit": 50 }
```

Exclude a bulk directory relative to the traversal root:

```json
{ "path": ".", "exclude": ["dataset/**", "**/generated/**"] }
```

`exclude` is independent of `gitignore`; setting `gitignore: false` still applies explicit exclusions. Exclude patterns do not support negation. Direct file operands override exclusions, so `{ "path": "dataset/index.json", "exclude": ["dataset/**"] }` can still search that file. Invalid exclusion patterns report the offending pattern.

A scan budget stops traversal after the configured number of encountered entries across the entire tool call (including all path-list roots):

```json
{ "path": ".", "scanLimit": 50000 }
```

If `glob` hits the result or scan limit, the result is partial. Increase `limit` or `scanLimit`, narrow the path, or add exclude patterns. `totalMatches` is a lower bound whenever a limit is reached.

### `grep`

Regex search:

```json
{ "pattern": "foo.*bar", "path": "src/**/*.ts" }
```

Literal search for text that contains regex characters:

```json
{ "pattern": "foo.bar(", "path": "src/**/*.ts", "literal": true }
```

Case-insensitive search:

```json
{ "pattern": "hello", "path": "*.txt", "case": false }
```

Show context lines:

```json
{ "pattern": "needle", "path": "a.txt", "contextBefore": 1, "contextAfter": 1 }
```

Page through matching files:

```json
{ "pattern": "needle", "path": "*.txt", "skip": 20 }
```

Exclude generated content and bound traversal:

```json
{
  "pattern": "needle",
  "path": ".",
  "exclude": ["dist/**", "**/generated/**"],
  "scanLimit": 50000
}
```

The same exclusion and direct-file override rules apply to `grep`. Exclude patterns do not support negation, and `exclude` remains active when `gitignore: false`. Its scan budget is also global across path-list roots. When `resultLimitReached` or `scanLimitReached` is true, `totalMatches` is a lower bound rather than an exact total.

### `grep limit`

`grep.limit` means the maximum total matches collected across all searched files.

It does **not** mean:

- files returned
- lines shown
- page size

`grep` still pages matching files separately, so use `skip` to view later file groups. Each response renders at most 10 matching files and 10 matches per file. The final response is capped at 16 KiB or 300 lines, whichever comes first; collection limits remain separate so pagination does not silently reduce search recall.

Result-limit responses include `[More matches omitted. Narrow path/glob or increase limit.]`. Scan-limit responses include `[Search stopped after scanning N entries. Results may be incomplete; narrow the path/glob or add exclude patterns.]`.

### `gitignore` behavior

With `gitignore: true`, ignored files are skipped during normal traversal.

Examples:

```json
{ "path": "*.ts", "gitignore": true }
```

```json
{ "pattern": "needle", "path": "src", "gitignore": true }
```

## Requirements

This package currently uses source-build packaging. Installing it builds the local N-API addon, so the target machine needs:

- Node.js compatible with Pi
- Rust toolchain and Cargo
- native build tools for the platform

## Development

```bash
npm install
npm run build:native
npm test
```

The Pi extension entrypoint is `src/index.ts` and registers both tools with `pi.registerTool()`.

## Packaging

The npm package includes `src`, `native`, `README.md`, `LICENSE`, and `NOTICE`. `postinstall` runs:

```bash
napi build --manifest-path native/Cargo.toml --release
```

This builds the native addon from source during install.
