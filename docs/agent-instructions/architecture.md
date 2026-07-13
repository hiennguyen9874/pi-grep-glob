# Architecture

## Read When

- You change `grep` or `glob` behavior, path parsing, output formatting, or filesystem traversal.
- You change the TypeScript/native API boundary or add a native export.

## Purpose

Keep the TypeScript tool contract, native addon contract, and shared filesystem walker aligned.

## Rules

- `src/index.ts` is the Pi extension entrypoint and registers the tools created by `src/tools/grep.ts` and `src/tools/glob.ts`; keep registration separate from tool implementation.
- The TypeScript tool wrappers own Pi schemas, user-facing defaults, path-list parsing, limits, pagination, errors, and output formatting. The Rust addon owns filesystem traversal and content search.
- `src/native.ts` is the native loading boundary. It searches platform-specific addon names/locations, normalizes camelCase and snake_case exports, and re-exports the native functions and public constants.
- Keep `src/types.ts` synchronized with the N-API DTOs and exports implemented under `native/src/`. A boundary change requires a native rebuild and tests of the affected public behavior.
- `native/src/grep.rs` implements in-memory and filesystem search; `native/src/glob.rs` implements filesystem matching; `native/src/iofs.rs` converts walker data to N-API data; `native/src/task.rs` handles blocking work, cancellation, and timeouts.
- `native/crates/pi-walker/` is a reusable Rust traversal layer. It owns directory walking, ignore handling, scan caching, metadata, and parallel traversal; do not duplicate those policies in the N-API glue.
- Keep path interpretation in `src/utils/path-utils.ts` and native glob normalization in `native/src/glob_util.rs`; update the relevant tests when changing either layer.

## Key Paths

- `src/tools/grep.ts` — public `grep` schema, limits, pagination, and native call orchestration
- `src/tools/glob.ts` — public `glob` schema, limits, and native call orchestration
- `src/native.ts` — addon discovery, loading, export normalization, and public native exports
- `src/types.ts` — TypeScript representation of native options and results
- `src/utils/path-utils.ts` — cwd resolution, path-list splitting, glob-root parsing, and display paths
- `src/utils/format.ts` — user-facing grep/glob output and truncation
- `native/src/grep.rs` — Rust regex and file-content search
- `native/src/glob.rs` — Rust filesystem glob operation
- `native/src/glob_util.rs` — native glob normalization and matching fast paths
- `native/crates/pi-walker/src/` — shared traversal and scan cache

## Gotchas

- A leading glob is intentionally recursive: `*.ts` behaves like `**/*.ts`, while `src/*.ts` remains non-recursive. This behavior is covered by `test/tools.test.ts` and documented in `README.md`.
- The public tools default to `gitignore: true`; `glob` and `grep` also default to including hidden entries at the TypeScript wrapper layer. Do not infer wrapper defaults solely from the lower-level Rust defaults.
- `grep` limits total collected matches and separately paginates matching files; `skip` advances by files, not individual matches.
- Importing `src/native.ts` immediately attempts to load a compatible `.node` addon, so missing or incompatible native artifacts fail before a tool can execute.

## Related Instructions

- [`build-system.md`](build-system.md) — native build, addon discovery, and packaging
- [`testing.md`](testing.md) — test coverage and native prerequisites
