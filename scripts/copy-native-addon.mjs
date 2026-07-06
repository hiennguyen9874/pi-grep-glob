import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";

const packageRoot = process.cwd();
const nativeDir = join(packageRoot, "native");
const binaryName = "pi-grep-glob-native";

function isMusl() {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport?.();
  return !report?.header?.glibcVersionRuntime;
}

function defaultTriple() {
  switch (process.platform) {
    case "darwin":
      return `darwin-${process.arch}`;
    case "win32":
      return `win32-${process.arch}-msvc`;
    case "linux":
      return `linux-${process.arch}-${isMusl() ? "musl" : "gnu"}`;
    default:
      return `${process.platform}-${process.arch}`;
  }
}

function sourceCandidates() {
  const releaseDir = join(nativeDir, "target", "release");
  const candidates = [
    process.env.NATIVE_ADDON_SOURCE,
    join(nativeDir, "index.node"),
    join(releaseDir, `${binaryName}.node`),
    join(releaseDir, `${binaryName.replaceAll("-", "_")}.node`),
  ].filter(Boolean);

  for (const dir of [nativeDir, releaseDir]) {
    try {
      candidates.push(
        ...readdirSync(dir)
          .filter((entry) => entry.endsWith(".node"))
          .map((entry) => join(dir, entry)),
      );
    } catch {
      // Directory may not exist before the first build.
    }
  }

  return [...new Set(candidates)];
}

const triple = process.env.TARGET_TRIPLE ?? defaultTriple();
const destination = join(nativeDir, `${binaryName}.${triple}.node`);
const source = sourceCandidates().find((candidate) => candidate !== destination && existsSync(candidate));

if (!source) {
  console.error("Could not find a built native addon to copy.");
  console.error("Run `npm run build:native` first, or set NATIVE_ADDON_SOURCE=/path/to/addon.node.");
  process.exit(1);
}

mkdirSync(nativeDir, { recursive: true });
copyFileSync(source, destination);
console.log(`Copied ${basename(source)} -> native/${basename(destination)}`);
