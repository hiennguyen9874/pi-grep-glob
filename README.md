# pi-grep-glob

Pi extension that registers native-backed `grep` and `glob` tools.

## Tool behavior

Both tools accept a single `path` string that can be:

- a file path
- a directory path
- a glob pattern
- a semicolon- or whitespace-delimited path list like `src/**/*.ts;test/**/*.ts` or `src test`

Defaults are aimed at code search:

- `gitignore: true`
- `hidden: true` for `glob`
- `case: true` for `grep`

### Important glob semantics

This tool treats a leading glob as recursive:

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

If `glob` hits the limit, the result is partial. Increase `limit` or narrow the path.

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

### `grep limit`

`grep.limit` means the maximum total matches collected across all searched files.

It does **not** mean:

- files returned
- lines shown
- page size

`grep` still pages matching files separately, so use `skip` to view later file groups.

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
