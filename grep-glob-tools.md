# [oh-my-pi](/home/hiennx/Documents/oh-my-pi) grep/glob tool

## grep/glob Tool in oh-my-pi

The grep and glob/file-walking capabilities in oh-my-pi are implemented across **three Rust crates** and integrated into the shell as **in-process builtins**.

### 1. `pi-walker` crate (`crates/pi-walker/`)

This is the **reusable platform directory traversal primitive**. It provides:

- **Native directory-read fast path** for globbing, grep candidate discovery, AST scans, and shell builtins
- **`WalkRequest`** builder API with options for hidden files, gitignore support, symlink following, depth limits, etc.
- **`WalkFilter`** — static compiled glob filters using the `globset` crate, with support for node_modules skipping, max file size filtering
- **`CompiledWalkGlob`** — pre-compiled glob patterns with `/`-normalized paths and `literal_separator` mode (wildcards don't cross path separators)
- **Streaming visitor** (`EntryVisitor` trait + `for_each_entry_with_heartbeat`) and **collected APIs** (`collect`, `collect_files`, etc.)
- **Shared scan cache** (`DashMap`-based, configurable via `FS_SCAN_CACHE_TTL_MS` env var)
- **Parallel file traversal** powered by `rayon` (configurable workers via `PI_WALK_WORKERS`)
- **Cancellation** via caller-supplied heartbeat closures checked every 128 entries

Key files: `crates/pi-walker/src/lib.rs`, `crates/pi-walker/src/cache.rs`

### 2. `pi-uu-grep` crate (`crates/pi-uu-grep/`)

This implements **two builtins**: `grep` (GNU-compatible) and `rg` (ripgrep-compatible). Both are built on top of the **ripgrep libraries** (`grep-regex`, `grep-searcher`, `grep-matcher`) but are standalone implementations (not forks of rg).

#### `grep` builtin (`src/lib.rs`)
- **GNU grep semantics**: positional arguments, `-e`, `-F`, `-E`, `-i`, `-v`, `-n`, `-c`, `-l`, `-H`, `-h`, `-r`, `-R`, `--include`, `-w`, `-x`, `-o`, `-A`/`-B`/`-C`, `-s`, `-q`, `--color` (silently accepted)
- **Per-pattern regex fallback**: when a pattern is not valid extended-regex syntax (like `fail)` with unbalanced parens), it falls back to literal matching — matching GNU basic grep behavior. `-E` makes it strict.
- **Directory recursion** uses `pi-walker`'s `WalkRequest` with `for_each_entry_with_heartbeat` for cancellation support
- **`--include` glob filtering** via the `globset` crate (`GlobSetBuilder`)
- **Output sink** (`GrepSink`) renders matches, context, counts, filenames in GNU format
- **Cancellation**: heartbeat checks `pi_uutils_ctx::is_cancelled()` every entry; aborts silently (shell owns diagnostics)

#### `rg` builtin (`src/rg.rs`)
- **Full ripgrep CLI surface**: `-e`, `-f`, `-F`, `-i`, `-s`, `-S`, `-v`, `-w`, `-x`, `-m`, `-U`, `--multiline-dotall`, `-a`, `--binary`, `-u` (repeatable), `-L`, `-g`/`--iglob`, `-t`/`-T`, `--type-add`/`--type-clear`, `-A`/`-B`/`-C`, `-n`/`-N`, `--column`, `-H`/`-I`, `-l`, `--files-without-match`, `-c`/`--count-matches`, `-o`, `-q`, `--vimgrep`, `-0`/`--null`, `--null-data`, `--files`, `--type-list`, `--sort`/`--sortr`, `--passthru`, `--trim`, `-M`/`--max-columns`, color/heading/stats flags (accepted/silently ignored)
- **File type filtering** via ripgrep's `ignore::types::Types` with `--type-add`/`--type-clear` support
- **Glob overrides** via ripgrep's `ignore::overrides::Override` for `-g`/`--iglob`
- **Binary detection**: automatic (quit on NUL), explicit (convert NUL), or none (`-a`)
- **Sort support**: `--sort path` uses `pi_walker::WalkOrder::Path`; `--sortr path` collects all files first, sorts descending, then processes
- **`--files` mode**: collects and prints matching file paths
- **`--type-list`**: prints all registered file type definitions

Both `grep` and `rg` share the same approach:
- Build a `RegexMatcher` via ripgrep's `grep-regex` library
- Build a `Searcher` via `grep-searcher` with line numbers, context, invert, binary detection
- Use a custom `Sink` implementation that writes to `pi_uutils_ctx::stdout()` in the expected output format

### 3. `pi-shell` crate (`crates/pi-shell/src/coreutils.rs`)

This is the **integration layer** that wires the Rust crates into the shell as in-process builtins:

- The `run_uutil` async function:
  - Captures the command's stdin/stdout/stderr file descriptors, cwd, env, and cancel token from the shell's `ExecutionContext`
  - Spawns a **blocking tokio task** with a `pi_uutils_ctx::ScopeIo` scope (thread-local context for I/O and path resolution)
  - Supports **bash-style cancellation**: on abort/timeout, sets the context's cancel flag → stdin reads return EOF → utility unwinds cleanly, then the shell reports exit 130
  - Catches **panics** via `catch_unwind` so a vendored utility crash doesn't take down the host

- The `uutil_builtin!` macro registers each utility:
  ```rust
  uutil_builtin!(pub fn grep_builtin => pi_uu_grep::run);
  uutil_builtin!(pub fn rg_builtin => pi_uu_grep::run_rg);
  ```

### Architecture Flow

```
Shell command (e.g., "grep -r pattern .")
    │
    ▼
pi-shell/coreutils.rs  ──  spawn_blocking task
    │                        ├─ pi_uutils_ctx::scope()  (thread-local I/O)
    │                        ├─ pi_uutils_ctx::resolve() (path resolution)
    │                        └─ pi_uu_grep::run() / run_rg()
    │
    ▼
pi_uu_grep  ──  clap CLI parsing
    │            ├─ RegexMatcher (grep-regex)
    │            ├─ Searcher (grep-searcher)
    │            ├─ GrepSink / RgSink  (output formatting)
    │            └─ pi_walker::WalkRequest  (recursive traversal)
    │
    ▼
pi_walker  ──  native directory reads
    │           ├─ Streaming visitor + heartbeat cancellation
    │           ├─ globset::GlobSet  (--include filtering)
    │           ├─ ignore::Override  (rg -g/--iglob)
    │           ├─ ignore::Types     (rg -t/-T)
    │           └─ DashMap scan cache (optional)
```

### Key Design Choices

1. **Not forked from ripgrep**: Both `grep` and `rg` are clean-room implementations using ripgrep's *libraries* (`grep-regex`, `grep-searcher`), not its CLI code. This avoids GPL entanglements and keeps the code tight.

2. **All I/O through `pi_uutils_ctx`**: No `println!`, no `std::process::exit`, no direct filesystem I/O outside the context. Everything goes through the shell's redirected file descriptors and working directory.

3. **Cancellation at every level**: `pi_walker`'s heartbeat checks `pi_uutils_ctx::is_cancelled()` every 128 entries; the grep loop checks before each file operand; the shell layer races the blocking task against the cancel token.

4. **No ANSI colors/headings**: Since these builtins write to in-process file descriptors (often pipes), color and heading features are accepted for CLI compatibility but silently ignored to avoid corrupting downstream output.