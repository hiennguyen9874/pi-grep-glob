# Build System

## Read When

- You install dependencies, build the Rust/N-API addon, package the extension, or debug native-addon loading.
- You change `native/Cargo.toml`, `native/build.rs`, `src/native.ts`, or `scripts/copy-native-addon.mjs`.

## Purpose

Provide the repository’s exact native build and packaging workflow without assuming a TypeScript build exists.

## Rules

- This package uses source-build packaging. A target machine needs Node.js compatible with Pi, Rust/Cargo, and native build tools; see `README.md`.
- The npm manifest has no `build` or `postinstall` script. Although `README.md` says installation runs the N-API build, run `npm run build:native` explicitly when the addon is missing rather than relying on `npm install`.
- `native/Cargo.toml` is the N-API crate manifest and `native/crates/pi-walker/` is its local path dependency. The release build produces a platform-specific `.node` addon.
- `scripts/copy-native-addon.mjs` chooses the current platform triple unless `TARGET_TRIPLE` is set, and accepts `NATIVE_ADDON_SOURCE` for an explicit source addon. Use those overrides only when packaging a non-default artifact.
- `native/target/` and `native/index.node` are ignored build outputs. Platform-specific addon files under `native/` are the files discovered and included for packaging; do not hand-edit binary artifacts.

## Commands

- `npm install` — install npm dependencies; the command is listed in `README.md`.
- `npm run build:native` — run `napi build --manifest-path native/Cargo.toml --release`.
- `npm run copy:native` — copy a built addon into the platform-specific `native/pi-grep-glob-native.<triple>.node` name.
- `npm run build:native:package` — run the native release build and then copy the addon for packaging.

## Key Paths

- `package.json` — npm scripts, package file list, Pi extension entrypoint, and peer dependencies
- `native/Cargo.toml` — Rust/N-API crate and dependency manifest
- `native/build.rs` — N-API build setup hook
- `native/Cargo.lock` — locked Rust dependency versions
- `scripts/copy-native-addon.mjs` — platform-triple selection and addon copying
- `src/native.ts` — addon candidate paths and export normalization
- `.gitignore` — native build outputs and dependency/cache exclusions

## Gotchas

- There is no repository-defined TypeScript compilation or aggregate validation script; do not document or rely on `npm run build` or a typecheck script unless `package.json` gains one.
- `npm run copy:native` fails if no built `.node` file is available. Build first, or set `NATIVE_ADDON_SOURCE` to an existing addon path.
- Linux addon selection distinguishes `gnu` and `musl`; `src/native.ts` tries the detected libc first and then the fallback.

## Related Instructions

- [`architecture.md`](architecture.md) — TypeScript/native boundary and module responsibilities
- [`testing.md`](testing.md) — native-dependent test setup
