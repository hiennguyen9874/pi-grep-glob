
# [oh-my-pi](/home/hiennx/Documents/oh-my-pi) grep/glob sources

## Architecture Layers

```
Packages (TypeScript) – tools, renderers, commands, CLI, tests
        │
        ▼
pi-natives (Rust N-API) – JS-callable native functions
        │
        ▼
pi-uu-grep (Rust) – shell builtins (grep, rg commands)
        ├── pi-walker (Rust) – directory traversal engine
        └── pi-uutils-ctx (Rust) – I/O context
```

---

## 1. Rust crates (engine + native layer)

### `crates/pi-walker/` – Core directory traversal + cache engine
| File | Lines | Role |
|------|-------|------|
| `crates/pi-walker/Cargo.toml` | 29 | Dependencies: `dashmap`, `rayon`, `ignore`, `crossbeam`, `serde` |
| `crates/pi-walker/src/lib.rs` | 4712 | Walker entry point, ignore rules, symlink policy, parallel traversal, visitor pattern |
| `crates/pi-walker/src/cache.rs` | 669 | `DashMap`-based scan cache with TTL, empty-result recheck |

### `crates/pi-natives/` – N-API native bindings (gọi từ JS)
| File | Lines | Role |
|------|-------|------|
| `crates/pi-natives/Cargo.toml` | 36 | Dependencies: `grep-regex`, `grep-searcher`, `globset`, `pi-walker`, `napi` |
| `crates/pi-natives/src/grep.rs` | 3139 | **`grep()`**, **`search()`**, **`hasMatch()`** – regex search engine |
| `crates/pi-natives/src/glob.rs` | 381 | **`glob()`** – filesystem entry discovery |
| `crates/pi-natives/src/fd.rs` | 334 | **`fuzzyFind()`** – fuzzy path matching |
| `crates/pi-natives/src/glob_util.rs` | 281 | Shared glob compilation, fast-path optimizations |
| `crates/pi-natives/src/iofs.rs` | 149 | Walk dispatch, cache key construction, `fs:readFile` |
| `crates/pi-natives/src/lib.rs` | — | N-API module registration |
| `crates/pi-natives/src/shell.rs` | — | Shell integration (uses pi-uu-grep) |
| `crates/pi-natives/src/snapcompact.rs` | — | Snapshot compaction (uses iofs/fs_cache) |

### `crates/pi-uu-grep/` – Shell builtin grep + rg
| File | Lines | Role |
|------|-------|------|
| `crates/pi-uu-grep/Cargo.toml` | 22 | Dependencies: `grep-regex`, `grep-searcher`, `grep-printer`, `pi-walker`, `pi-uutils-ctx` |
| `crates/pi-uu-grep/src/lib.rs` | 969 | **`grep` shell builtin** – GNU grep semantics, exit codes, all flags |
| `crates/pi-uu-grep/src/rg.rs` | 1486 | **`rg` shell builtin** – ripgrep semantics, `--fixed-strings`, `--smart-case`, `--multiline`, `--binary`, `--unrestricted`, v.v. |

### `crates/pi-uutils-ctx/` – Shell I/O context
| File | Role |
|------|------|
| `crates/pi-uutils-ctx/src/lib.rs` | I/O abstraction: stdin/stdout/stderr, working dir, cancellation, used by pi-uu-grep |

### Supporting Rust crates
| File | Role |
|------|------|
| `crates/pi-shell/Cargo.toml` | Depends on `pi-uu-grep` |
| `crates/pi-shell/src/coreutils.rs` | Registers `grep`/`rg` as shell builtins |
| `crates/pi-shell/src/shell.rs` | Shell execution dispatches to pi-uu-grep |
| `Cargo.toml` (root) | Workspace root includes all crates |
| `Cargo.lock` | Locked dependency graph (grep-regex, grep-searcher, ignore, globset, etc.) |

---

## 2. TypeScript – Tools layer (pi agent calls these)

### Tool definitions (how agent sees grep/glob)
| File | Role |
|------|------|
| `packages/coding-agent/src/tools/grep.ts` | **`grep` tool** – regex search tool definition, path resolution, output formatting |
| `packages/coding-agent/src/tools/glob.ts` | **`glob` tool** – glob search tool definition, path resolution, output formatting |
| `packages/coding-agent/src/tools/index.ts` | Tool registry, registers grep/glob/astGrep |
| `packages/coding-agent/src/tools/builtin-names.ts` | Tool name constants |

### Tool support utilities
| File | Role |
|------|------|
| `packages/coding-agent/src/tools/path-utils.ts` | Path normalization, relative path helpers |
| `packages/coding-agent/src/tools/grouped-file-output.ts` | Output grouping for multi-file results |
| `packages/coding-agent/src/tools/renderers.ts` | Tool output renderers |
| `packages/coding-agent/src/tools/render-utils.ts` | Render utility functions |
| `packages/coding-agent/src/tools/match-line-format.ts` | Line match formatting for grep output |
| `packages/coding-agent/src/tools/fs-cache-invalidation.ts` | Cache invalidation after file writes (invalidates fs_cache) |

### Commands layer (CLI commands for grep/glob)
| File | Role |
|------|------|
| `packages/coding-agent/src/commands/grep.ts` | `grep` slash command |
| `packages/coding-agent/src/cli/grep-cli.ts` | CLI entry for standalone grep |
| `packages/coding-agent/src/cli/gallery-fixtures/search.ts` | Search gallery test fixtures |

### Tool renderers (UI display of grep/glob results)
| File | Role |
|------|------|
| `packages/coding-agent/src/tools/renderers.ts` | General tool rendering |

---

## 3. TypeScript – Collab Web renderers (web UI)

| File | Role |
|------|------|
| `packages/collab-web/src/tool-render/tools/grep.tsx` | Web UI renderer for grep results |
| `packages/collab-web/src/tool-render/tools/glob.tsx` | Web UI renderer for glob results |
| `packages/collab-web/src/tool-render/tools/ast-grep.tsx` | Web UI renderer for astGrep results |
| `packages/collab-web/src/tool-render/registry.ts` | Registers all tool renderers |
| `packages/collab-web/src/tool-render/types.ts` | Renderer type definitions |
| `packages/collab-web/src/tool-render/element.tsx` | Renderer element base |
| `packages/collab-web/src/tool-render/util.ts` | Renderer utilities |

---

## 4. TypeScript – Natives package (JS bindings to Rust)

| File | Role |
|------|------|
| `packages/natives/native/index.d.ts` | **Type declarations** for `grep()`, `glob()`, `fuzzyFind()`, `search()`, `hasMatch()` |
| `packages/natives/bench/grep.ts` | Grep benchmark |
| `packages/natives/scripts/build-native.ts` | Native build script |
| `packages/natives/scripts/gen-enums.ts` | Enum generation from Rust |
| `packages/natives/scripts/gen-npm-packages.ts` | NPM package generation |

---

---

## 6. Misc references to grep/glob in other files

| File | Relevance |
|------|-----------|
| `packages/utils/src/glob.ts` | Tiny path-glob utility (JS-side, unrelated to pi-natives glob) |
| `packages/utils/src/index.ts` | Re-exports glob |
| `packages/coding-agent/src/exec/bash-executor.ts` | Bash execution – may spawn external grep/rg |
| `packages/coding-agent/src/tools/bash.ts` | Bash tool – passes through to shell (may invoke grep builtin) |
| `packages/coding-agent/src/tools/bash-interceptor.ts` | Bash interception logic |
| `packages/coding-agent/src/tools/read.ts` | Read file tool – uses fs_cache |
| `packages/coding-agent/src/tools/write.ts` | Write file tool – invalidates fs_cache |
| `packages/coding-agent/src/edit/index.ts` | Edit tool – uses grep for finding code blocks |
| `packages/coding-agent/src/internal-urls/index.ts` | Internal URL routing (local:, history:...) – uses grep |
| `packages/coding-agent/src/session/agent-session.ts` | Agent session – tool dispatch includes grep/glob |
| `packages/coding-agent/src/system-prompt.ts` | System prompt – mentions grep/glob tools |
| `packages/agent/src/agent.ts` | Agent base – tool definitions |
| `packages/tui/bench/fuzzy.bench.ts` | Fuzzy matching benchmark |
| `packages/tui/src/autocomplete.ts` | Autocomplete – likely uses fuzzyFind |
| `docs/natives-text-search-pipeline.md` | **Design doc** – full architecture description |

---

## Summary: Core files you need to read

Để hiểu toàn bộ implementation, đây là các file cốt lõi nhất (theo thứ tự ưu tiên):

| Priority | File | What it does |
|----------|------|--------------|
| 1 | `crates/pi-natives/src/grep.rs` | grep() N-API implementation |
| 2 | `crates/pi-natives/src/glob.rs` | glob() N-API implementation |
| 3 | `crates/pi-natives/src/fd.rs` | fuzzyFind() N-API implementation |
| 4 | `crates/pi-natives/src/glob_util.rs` | Shared glob compilation |
| 5 | `crates/pi-natives/src/iofs.rs` | Walk dispatch + cache keys |
| 6 | `crates/pi-walker/src/lib.rs` | Directory traversal engine |
| 7 | `crates/pi-walker/src/cache.rs` | Scan cache (DashMap + TTL) |
| 8 | `crates/pi-uu-grep/src/lib.rs` | grep shell builtin |
| 9 | `crates/pi-uu-grep/src/rg.rs` | rg shell builtin |
| 10 | `packages/coding-agent/src/tools/grep.ts` | grep tool (JS side) |
| 11 | `packages/coding-agent/src/tools/glob.ts` | glob tool (JS side) |
| 12 | `packages/natives/native/index.d.ts` | Type declarations |
| 13 | `docs/natives-text-search-pipeline.md` | Architecture doc |