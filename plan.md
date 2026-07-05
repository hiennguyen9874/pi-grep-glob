# pi grep/glob extension implementation plan

Implement Pi `grep` and `glob` tools by porting the focused oh-my-pi native grep/glob stack into this package.

## Observed facts

- Current package is a Pi package already:
  - `package.json` has `"pi": { "extensions": ["./src/index.ts"] }`
- `src/index.ts` is empty.
- Current package has `typebox` installed transitively, but `package.json` currently lists `@sinclair/typebox` as a peer. Pi extension docs use `typebox`.
- `grep-glob-sources.md` and `grep-glob-tools.md` confirm the relevant oh-my-pi implementation is:
  - Rust native layer: `crates/pi-natives/src/{grep.rs,glob.rs,glob_util.rs,iofs.rs,task.rs,utils.rs}`
  - Walker engine: `crates/pi-walker/src/{lib.rs,cache.rs}`
  - TS tool behavior reference: `packages/coding-agent/src/tools/{grep.ts,glob.ts,path-utils.ts,grouped-file-output.ts,match-line-format.ts}`
- Pi extension API supports `pi.registerTool()`. Registering `grep` intentionally overrides Pi's built-in `grep`; registering `glob` adds a tool.
- oh-my-pi TS tool files cannot be copied directly because they depend on `@oh-my-pi/*`, `arktype`, internal URL routing, TUI renderers, archive handling, settings, and session internals.

## Recommended design

### Architecture

```text
pi-grep-glob
├── src/
│   ├── index.ts                 # Pi extension entrypoint
│   ├── native.ts                # Loads our local .node addon and exports JS enums
│   ├── types.ts                 # Minimal TS types for native grep/glob
│   ├── tools/
│   │   ├── grep.ts              # Pi ToolDefinition wrapper
│   │   └── glob.ts              # Pi ToolDefinition wrapper
│   └── utils/
│       ├── path-utils.ts        # Small portable subset, not full oh-my-pi copy
│       ├── format.ts            # Match/path formatting
│       └── errors.ts            # Small local error helpers if needed
├── native/
│   ├── Cargo.toml               # New N-API crate, no pi-natives dependency
│   ├── build.rs
│   ├── src/
│   │   ├── lib.rs               # Exports only grep/glob/search/hasMatch/invalidate cache
│   │   ├── grep.rs              # Copied/adapted from oh-my-pi
│   │   ├── glob.rs              # Copied/adapted from oh-my-pi
│   │   ├── glob_util.rs
│   │   ├── iofs.rs
│   │   ├── utils.rs             # Needed for clamp_u32 used by grep.rs
│   │   └── task.rs              # Local async/cancel implementation
│   └── crates/
│       └── pi-walker/
│           ├── Cargo.toml
│           └── src/
│               ├── lib.rs
│               └── cache.rs
└── test/
    ├── native.test.ts
    └── tools.test.ts
```

### What to copy

Copy these from `/home/hiennx/Documents/oh-my-pi`:

| Source | Destination |
|---|---|
| `crates/pi-walker/src/lib.rs` | `native/crates/pi-walker/src/lib.rs` |
| `crates/pi-walker/src/cache.rs` | `native/crates/pi-walker/src/cache.rs` |
| `crates/pi-walker/Cargo.toml` | `native/crates/pi-walker/Cargo.toml` then adapt workspace deps |
| `crates/pi-natives/src/grep.rs` | `native/src/grep.rs` |
| `crates/pi-natives/src/glob.rs` | `native/src/glob.rs` |
| `crates/pi-natives/src/glob_util.rs` | `native/src/glob_util.rs` |
| `crates/pi-natives/src/iofs.rs` | `native/src/iofs.rs` |
| `crates/pi-natives/src/utils.rs` | `native/src/utils.rs` |

Do **not** copy the whole `pi-natives` crate. It pulls in unrelated native features: clipboard, PTY, shell, AST, ISO, syntax highlighting, token counting, images, etc.

### What to rewrite

- `native/src/lib.rs`
  - Export only local modules:
    - `grep`
    - `glob`
    - `iofs`
    - `glob_util`
    - `task`
    - `utils`
  - Do not copy oh-my-pi module init, crash handling, shell, PTY, tokio setup, or Windows rayon setup unless a compile failure proves it is required.

- `native/src/task.rs`
  - Replace oh-my-pi's `pi-shell`, profiling, and crash-handler dependencies.
  - Keep only the API used by `grep.rs` and `glob.rs`:
    - `CancelToken::new(timeout_ms, signal)`
    - `CancelToken::heartbeat()`
    - `CancelToken::aborted()`
    - `Clone` and `Default`
    - `Promise<T> = AsyncTask<Blocking<T>>`
    - `blocking(tag, cancel_token, work)`
  - Implement timeout with `Instant`/deadline or a small shared atomic state.
  - Hook JS `AbortSignal` using napi-rs `AbortSignal::from_unknown(...).on_abort(...)` if available in the installed napi version.
  - Use `catch_unwind` around blocking work and convert panics to a N-API error; do not pull `crash_handler`.

- TypeScript tool layer
  - Write local Pi extension `ToolDefinition`s using `pi.registerTool()`.
  - Use `typebox` schemas, not `arktype`.
  - Do not copy oh-my-pi classes/renderers/session/internal URL/archive logic.
  - Keep only local filesystem behavior needed for this package.

## Native crate dependencies

`native/Cargo.toml` should depend directly on crates.io dependencies plus vendored `pi-walker`:

```toml
[dependencies]
napi = { version = "3", features = ["napi8", "async"] }
napi-derive = "3"
grep-matcher = "0.1"
grep-regex = "0.1"
grep-searcher = "0.1"
globset = "0.4"
ignore = "0.4"
dashmap = "6"
parking_lot = "0.12"
rayon = "1"
smallvec = "1"
memmap2 = "0.9"
regex = "1"
pi-walker = { path = "crates/pi-walker" }

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Wdk_Storage_FileSystem"] }

[build-dependencies]
napi-build = "2"
```

`native/crates/pi-walker/Cargo.toml` should remove workspace inheritance and declare direct dependencies:

```toml
[dependencies]
dashmap = "6"
globset = "0.4"
ignore = "0.4"
parking_lot = "0.12"
rayon = "1"

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Wdk_Storage_FileSystem"] }
```

Adjust exact versions to compile with napi-rs and the copied code; prefer the latest compatible stable versions already resolved by npm/cargo when possible.

## Native JS loader

`src/native.ts` should:

- Load the built `.node` with `createRequire(import.meta.url)`.
- Try likely local napi-rs output names, e.g. package binary name plus platform suffix, instead of hardcoding only one path.
- Export typed functions:
  - `grep`
  - `glob`
  - `search` if kept
  - `hasMatch` if kept
  - `invalidateFsScanCache` if kept
- Export runtime enum objects manually because napi-rs TS enums are not reliable runtime JS values:

```ts
export const FileType = {
  File: 1,
  Dir: 2,
  Symlink: 3,
} as const;

export const GrepOutputMode = {
  Content: "content",
  Count: "count",
  FilesWithMatches: "filesWithMatches",
} as const;
```

## Tool behavior

### Shared guardrails

- Default working directory should be `ctx.cwd` from the Pi extension context if available; otherwise `process.cwd()`.
- Reject search roots that resolve to `/`.
- Normalize output paths to forward slashes.
- Return directories with trailing `/` for `glob`.
- Keep output under Pi's truncation limits with `truncateHead` from `@earendil-works/pi-coding-agent`.
- Throw clear tool errors by returning `isError: true` result content or throwing normal `Error`, matching Pi extension examples.

### `grep` tool

Register tool name: `grep`.

Recommended schema:

```ts
{
  pattern: string,
  path?: string,
  case?: boolean,
  gitignore?: boolean,
  skip?: number,
  contextBefore?: number,
  contextAfter?: number
}
```

Behavior:

- Use native `grep()` from this addon's loader.
- Default `path` to `"."`.
- Default `case` to `true`; pass native `ignoreCase: !(case ?? true)`.
- Default `gitignore` to `true`.
- Default `hidden` to `true`, matching oh-my-pi grep.
- Use native timeout, e.g. `30_000ms`.
- Treat `skip` as **file pagination skip**, not native match `offset`.
- Group results by file.
- Format match lines like oh-my-pi plain mode:
  - `*42|matched line`
  - ` 43|context line`
- Limit output:
  - file page limit: 20 files
  - per-file match limit: 20 for multi-file search
  - single-file match limit: 200
  - native internal cap: about 2000 matches
  - truncate final text with Pi's `truncateHead`.
- Invalid regex should be surfaced as `Invalid regex: ...`.
- Timeout should suggest narrowing `path` or using `glob` first.

Initial implementation can support local file, directory, glob, and semicolon-delimited paths only. Do not implement oh-my-pi internal URLs, archive member search, hashline snapshots, or TUI-specific rendering unless explicitly requested later.

### `glob` tool

Register tool name: `glob`.

Schema:

```ts
{
  path?: string,
  hidden?: boolean,
  gitignore?: boolean,
  limit?: number
}
```

Behavior:

- Parse `path` as file, directory, glob, or semicolon-delimited list.
- Use native `glob()` for directory/glob searches.
- For explicit file path with no glob, return that file directly if it exists.
- Default:
  - `path: "."`
  - `hidden: true`
  - `gitignore: true`
  - `limit: 200`
- Clamp `limit` to `1..200`.
- Use `sortByMtime: true`.
- Pass `recursive: false` after JS parsing has made recursive intent explicit.
- Return directories with trailing `/`.
- Skip missing paths in multi-path calls, but error if all paths are missing.
- Timeout should return partial streamed matches if practical; otherwise return a clear timeout error.

## Package/build plan

### `package.json` updates

Recommended scripts:

```json
{
  "scripts": {
    "build:native": "napi build --manifest-path native/Cargo.toml --release",
    "test": "vitest run"
  }
}
```

Add native build dependency. If the package must build during Pi install, this needs to be in `dependencies`, not only `devDependencies`, because Pi package installs may omit dev deps.

```json
{
  "dependencies": {
    "@napi-rs/cli": "^3.0.0"
  },
  "peerDependencies": {
    "typebox": "*"
  }
}
```

Remove the incorrect `@sinclair/typebox` peer unless another local file truly imports it.

### Source-build vs prebuilt

Source-build package:

- Simpler to implement now.
- Requires user machines to have Rust and native build tooling.
- Needs an install hook, e.g. `postinstall`, or clear manual build docs.
- `files` must include `src`, `native`, and any generated JS/native artifacts required by napi-rs.

Prebuilt package:

- Better user experience for distribution.
- Requires release automation for platform `.node` files.
- `files` should include built `.node` artifacts and the JS loader, not necessarily full Rust sources.

For this repo, start with source-build unless publishing to broad external users immediately.

### Attribution

The copied Rust files are from oh-my-pi, which is MIT licensed. Keep this package MIT and add attribution/notice before publishing.

## Implementation phases

### Phase 1 — Native crate skeleton — Done

- [x] Create `native/Cargo.toml` and `native/build.rs`.
- [x] Create minimal `native/src/lib.rs`.
- [x] Copy `pi-walker` files and adapt `Cargo.toml` away from workspace dependencies.
- [x] Copy `grep.rs`, `glob.rs`, `glob_util.rs`, `iofs.rs`, and `utils.rs`.
- [x] Replace `task.rs` with local implementation.
- [x] Run:

```bash
cargo test --manifest-path native/Cargo.toml
```

Success: Rust compiles and copied native unit tests pass.

Phase 1 file changes:

- Added `native/Cargo.toml` and `native/Cargo.lock` for the standalone native crate.
- Added `native/build.rs` for napi-rs build setup.
- Added `native/src/lib.rs` with only the focused grep/glob modules.
- Added copied/adapted native modules:
  - `native/src/grep.rs`
  - `native/src/glob.rs`
  - `native/src/glob_util.rs`
  - `native/src/iofs.rs`
  - `native/src/utils.rs`
- Added local `native/src/task.rs` to replace oh-my-pi task/profiling/crash/shell dependencies.
- Added vendored walker crate:
  - `native/crates/pi-walker/Cargo.toml`
  - `native/crates/pi-walker/src/lib.rs`
  - `native/crates/pi-walker/src/cache.rs`
- Adapted `native/src/grep.rs` to avoid unstable `str::floor_char_boundary` on the current Rust toolchain.

Validation: `cargo test --manifest-path native/Cargo.toml` passed with 50 unit tests; the copied glob doc test is ignored.

### Phase 2 — Native loader — Done

- [x] Create `src/types.ts`.
- [x] Create `src/native.ts`.
- [x] Build native addon:

```bash
npm run build:native
```

- [x] Add a Vitest that imports `src/native.ts` and calls native `glob()` on a temp fixture.

Success: a TypeScript test can load the `.node` and call `glob()`.

Phase 2 file changes:

- Added `src/types.ts` with TypeScript DTOs for the native grep/glob exports.
- Added `src/native.ts` with a resilient `.node` loader, runtime enum objects, and normalized native exports.
- Added `test/native.test.ts` to load the native addon and call `glob()` against a temp fixture.
- Added `build:native` and `@napi-rs/cli` so `npm run build:native` can build the addon.
- Ignored generated local N-API output:
  - `native/index.d.ts`
  - `native/index.node`

Validation:

- `npm run build:native` passed and produced `native/index.node`.
- `npx vitest run test/native.test.ts` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed.

### Phase 3 — Tool wrappers

1. Create `src/tools/glob.ts`.
2. Create `src/tools/grep.ts`.
3. Create minimal `src/utils/path-utils.ts` and `src/utils/format.ts`.
4. Update `src/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "./tools/grep.js";
import { createGlobTool } from "./tools/glob.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(createGrepTool());
  pi.registerTool(createGlobTool());
}
```

Success: `pi -e ./src/index.ts` exposes `grep` and `glob`.

### Phase 4 — Tests

Add focused tests for:

- `glob`
  - finds `src/**/*.ts`
  - respects `gitignore`
  - includes hidden files when requested
  - returns dirs with `/`
  - enforces/clamps limit
  - skips missing entries in multi-path calls
- `grep`
  - finds line matches
  - respects case sensitivity
  - respects gitignore
  - handles invalid regex
  - paginates by file with `skip`
  - formats context lines with `*N|` and ` N|`
  - truncates long output

### Phase 5 — Packaging

1. Decide source-build or prebuilt before publishing.
2. Ensure `files` includes required outputs:
   - source-build: `src`, `native`, `README.md`, `LICENSE`
   - prebuilt: JS loader plus platform `.node` files
3. Add attribution/notice for copied MIT oh-my-pi code.
4. Run a package smoke test from a packed tarball if publishing:

```bash
npm pack
npm install -g ./pi-grep-glob-*.tgz
```

## Key risks

1. **Native packaging** is the highest risk. Source-build is easiest but requires Rust on user machines; prebuilt is better but needs release automation.
2. **Copied Rust dependency drift** can cause compile failures. Keep the copied subset small and avoid importing oh-my-pi infrastructure.
3. **Tool API mismatch** is possible if the extension imports `@oh-my-pi/*` or `arktype`. Use Pi's `ToolDefinition` plus `typebox` only.
4. **Pagination semantics** can regress if `grep.skip` is passed to native `offset`. Keep `skip` as file-page skip in JS.
5. **Root search** must stay blocked to avoid accidentally walking the entire filesystem.
