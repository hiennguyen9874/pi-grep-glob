# Testing

## Read When

- You add or change TypeScript/native integration tests or public tool behavior.
- `npm test` fails, especially while loading the native addon.

## Purpose

Identify the repository’s test scope, fixture patterns, and native prerequisites.

## Rules

- TypeScript tests live in `test/**/*.test.ts` and are run by Vitest; `vitest.config.ts` excludes `profiling/**` and `node_modules/**`.
- Use temporary filesystem fixtures and remove them in cleanup, following `withFixture` in `test/tools.test.ts` and the `try/finally` pattern in `test/native.test.ts`.
- Test public behavior through `createGlobTool()` and `createGrepTool()` when changing wrapper behavior; use `test/native.test.ts` for addon loading and direct native calls.
- Cover path semantics, ignore/hidden defaults, limits, pagination, formatting, and error behavior at the wrapper boundary when those behaviors change.
- Native Rust unit tests exist under `native/src/`, but this repository does not define a Rust test script; use the documented npm test for the default check and treat a direct Cargo test command as `Unknown; see native/Cargo.toml` unless the project adds that command to its files.

## Commands

- `npm test` — run `vitest run` for the configured TypeScript tests.
- `npm run test:watch` — run Vitest in watch mode while iterating.
- `npm run build:native` — build the addon required by tests that import `src/native.ts` when no compatible artifact is available.

## Key Paths

- `test/tools.test.ts` — public `glob` and `grep` behavior with temporary fixtures
- `test/native.test.ts` — native loader and direct addon smoke test
- `vitest.config.ts` — test include/exclude patterns
- `src/tools/` — wrapper entrypoints under test
- `native/src/` — Rust implementation and inline unit tests

## Gotchas

- Both test files import code that reaches `src/native.ts`; a missing or incompatible `.node` addon can fail test collection before individual tests run.
- `npm test` runs Vitest only; it does not run the Rust `#[cfg(test)]` modules in `native/src/`.
- The native smoke test expects recursive `*.ts` matching and uses a temporary fixture, so changes to glob recursion or addon loading can affect it even when wrapper tests are unchanged.

## Related Instructions

- [`build-system.md`](build-system.md) — build the native prerequisite and diagnose addon artifacts
- [`architecture.md`](architecture.md) — identify the correct layer for a behavior change
