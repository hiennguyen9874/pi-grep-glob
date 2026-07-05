# Review Summary
- Review report when review code with ./plan.md and [oh-my-pi](/home/hiennx/Documents/oh-my-pi) grep/glob sources grep-glob-sources.md

## What Was Done Well
- Native Rust is closely aligned with oh-my-pi:
  - `native/src/glob.rs`, `glob_util.rs`, `iofs.rs` match upstream.
  - `native/crates/pi-walker/src/lib.rs` and `cache.rs` match upstream.
  - `native/src/grep.rs` only differs by the planned stable replacement for `str::floor_char_boundary`.
- Package/source-build flow matches the plan and passes current checks.
- Tool wrappers use Pi `ToolDefinition`, `typebox`, local helpers, and avoid copying oh-my-pi TUI/session/internal URL code.

## Requirement Mismatches

### Critical

#### `glob` does not mirror oh-my-pi recursive path parsing
- Files:
  - `src/utils/path-utils.ts:76-80`
  - `src/utils/path-utils.ts:111-127`
  - `src/tools/glob.ts:87-92`
- Problem: Current parser turns:
  - directory path like `src` or default `.` into pattern `*`
  - leading glob like `*.ts` into pattern `*.ts`
  - then calls native glob with `recursive: false`
- oh-my-pi behavior: `parseFindPattern()` maps:
  - `src` -> `src/**/*`
  - `*.ts` -> `**/*.ts`
- Why it matters: `glob({ path: "." })` and `glob({ path: "*.ts" })` miss nested files, which is a core behavior mismatch.
- Recommended fix: Match oh-my-pi parsing:
  - no glob chars => `pattern: "**/*"`
  - first path segment has glob chars and does not start with `**/` => prefix `**/`
  - keep `recursive: false`
- Timing: Must fix now.

### Important

#### `grep` validates regexes with JavaScript syntax, not native/Rust syntax
- Files:
  - `src/tools/grep.ts:81-83`
  - `src/tools/grep.ts:151-156`
- Problem: `new RegExp(pattern)` can reject valid Rust/ripgrep-style regex patterns before native grep sees them.
- Why it matters: The ported native grep is Rust-regex based; JS validation changes the accepted regex dialect.
- Recommended fix: Reject empty patterns in TS, then rely on native errors or add a strict native regex validation path.
- Timing: Should fix soon.

#### Empty grep pattern is allowed
- Files: `src/tools/grep.ts:81-83`
- Problem: oh-my-pi rejects empty/whitespace-only grep patterns; current code accepts them.
- Why it matters: Empty grep can match huge numbers of lines and produce noisy output.
- Recommended fix: Add `if (!params.pattern.trim()) throw new Error("Pattern must not be empty");`
- Timing: Should fix soon.

### Suggestions

#### Remove unused direct deps/peers
- Files: `package.json:33-42`
- Problem: `diff`, `file-type`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` are not imported by current source/tests.
- Why it matters: Extra package surface and install burden.
- Recommended fix: Remove unless Pi extension packaging requires them.

## Plan Deviations
- Native copying/adaptation is aligned with `plan.md`.
- Main deviation is JS `glob` path parsing: the plan says JS parsing should make recursion explicit before passing `recursive: false`; current code does not.
- JS regex validation is a risky deviation from oh-my-pi/native regex behavior.

## Scope Creep / Missing Scope
- Missing tests for recursive glob semantics:
  - `glob({ path: "." })` finds nested files.
  - `glob({ path: "*.ts" })` finds nested `.ts` files.
  - `glob({ path: "src/*.ts" })` stays non-recursive.
- Possible scope creep: unused dependencies/peers in `package.json`.

## Tests and Verification
Ran:
- `npx tsc --noEmit` — passed.
- `npm test` — passed, 14 tests.
- `cargo test --manifest-path native/Cargo.toml` — passed, 50 tests; 1 doc test ignored.
- `npm pack --dry-run` — passed, 24-file source package.

Not run:
- Interactive `pi -e ./src/index.ts` smoke test.
- Real tarball install smoke test.

## Verdict
- Request changes.

## Recommended Next Actions
1. Fix `glob` path parsing to match oh-my-pi `parseFindPattern`.
2. Add recursive glob regression tests.
3. Replace JS regex validation with native-compatible validation and reject empty grep patterns.
4. Remove unused package dependencies/peers if not required by Pi packaging.