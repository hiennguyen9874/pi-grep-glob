# AGENTS.md

`pi-grep-glob` is a Pi extension that registers native-backed `grep` and `glob` tools.

## Quick Reference

- Install: `npm install`
- Run: `Unknown; see README.md` (the package is loaded by Pi)
- Test: `npm test`
- Build: `npm run build:native`
- Full checks: `Unknown; see package.json` (no aggregate check script is defined)
- Package the native addon: `npm run build:native:package`

## Mini Repo Map

- `AGENTS.md` — always-loaded repository guidance and instruction index
- `README.md` — user-facing behavior, setup, and packaging notes
- `package.json` / `package-lock.json` — npm metadata, dependencies, and scripts
- `src/` — TypeScript Pi entrypoint, native loader, tool wrappers, types, and formatting/path utilities
- `test/` — Vitest tests for the native loader and public tools
- `native/` — Rust N-API addon and the `pi-walker` traversal crate; platform addon artifacts live here
- `scripts/` — packaging helper scripts
- `tsconfig.json` — TypeScript compiler options and included paths
- `vitest.config.ts` — Vitest test discovery and exclusions
- `docs/` — detailed agent instructions under `docs/agent-instructions/`
- `.gitignore` — ignored dependencies, caches, and native build outputs
- `.pi/` — Pi-local configuration and skills; do not place shared project instructions here
- `LICENSE` / `NOTICE` — licensing and attribution files
- `.git/` — Git metadata; do not edit directly

## Instruction Index

Read these only when the task matches the scope:

| File | Read when | Contains |
|---|---|---|
| [`docs/agent-instructions/architecture.md`](docs/agent-instructions/architecture.md) | You change tool behavior, TypeScript/native boundaries, path semantics, or filesystem traversal | Component responsibilities, data flow, API coupling, and behavior gotchas |
| [`docs/agent-instructions/build-system.md`](docs/agent-instructions/build-system.md) | You install dependencies, build/package the addon, or debug native loading | Prerequisites, exact npm scripts, generated artifacts, and packaging constraints |
| [`docs/agent-instructions/testing.md`](docs/agent-instructions/testing.md) | You add/change tests or investigate test failures | Vitest scope, fixtures, native prerequisites, and test-command limits |

## Critical Rules

- `src/native.ts` loads the N-API addon during module initialization; run `npm run build:native` before native-dependent tests or runtime checks when no compatible addon is present.
- If a native DTO or export changes, update the Rust N-API definition and the corresponding TypeScript contract/loader together; see [`architecture.md`](docs/agent-instructions/architecture.md).
- Keep shared project guidance in `AGENTS.md` or `docs/agent-instructions/`; do not add nested `AGENTS.md` files or put project docs under `.pi/`.
