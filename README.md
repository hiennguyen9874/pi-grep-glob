# pi-grep-glob

Pi extension that registers native-backed `grep` and `glob` tools.

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
