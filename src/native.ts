import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NativeAddon } from "./types.js";
export type {
  ContextLine,
  FileTypeValue,
  GlobMatch,
  GlobOptions,
  GlobResult,
  GrepMatch,
  GrepOptions,
  GrepOutputModeValue,
  GrepResult,
  Match,
  NativeAddon,
  NativeCallback,
  SearchOptions,
  SearchResult,
} from "./types.js";

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

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const binaryName = "pi-grep-glob-native";
const underscoredBinaryName = binaryName.replaceAll("-", "_");

function platformTriples(): string[] {
  switch (process.platform) {
    case "darwin":
      return [`darwin-${process.arch}`];
    case "win32":
      return [`win32-${process.arch}-msvc`];
    case "linux": {
      const libc = isMusl() ? "musl" : "gnu";
      const fallbackLibc = libc === "musl" ? "gnu" : "musl";
      return [`linux-${process.arch}-${libc}`, `linux-${process.arch}-${fallbackLibc}`];
    }
    default:
      return [`${process.platform}-${process.arch}`];
  }
}

function isMusl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }

  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

function addonCandidates(): string[] {
  const names = [binaryName, underscoredBinaryName];
  const roots = [
    packageRoot,
    join(packageRoot, "native"),
    join(packageRoot, "native", "target", "release"),
  ];

  const exact = roots.flatMap((root) => [
    ...platformTriples().flatMap((triple) => names.map((name) => join(root, `${name}.${triple}.node`))),
    ...names.map((name) => join(root, `${name}.node`)),
  ]);

  const discovered = roots.flatMap((root) => {
    try {
      return readdirSync(root)
        .filter((entry) => entry.endsWith(".node"))
        .sort((left, right) => scoreAddon(right) - scoreAddon(left) || left.localeCompare(right))
        .map((entry) => join(root, entry));
    } catch {
      return [];
    }
  });

  return [...new Set([...exact, ...discovered])];
}

function scoreAddon(path: string): number {
  const fileName = basename(path);
  if (fileName.startsWith(binaryName)) {
    return 2;
  }
  if (fileName.startsWith(underscoredBinaryName)) {
    return 1;
  }
  return 0;
}

function loadNativeAddon(): NativeAddon {
  const candidates = addonCandidates();
  const loadErrors: string[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const addon = require(candidate) as Partial<NativeAddon> & Record<string, unknown>;
      return normalizeExports(addon, candidate);
    } catch (error) {
      loadErrors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const searched = candidates.map((candidate) => `  - ${candidate}`).join("\n");
  const errors = loadErrors.length > 0 ? `\nLoad errors:\n${loadErrors.join("\n")}` : "";
  throw new Error(
    `Could not load pi-grep-glob native addon. Run \`npm run build:native\`.\nSearched:\n${searched}${errors}`,
  );
}

function normalizeExports(addon: Partial<NativeAddon> & Record<string, unknown>, loadedFrom: string): NativeAddon {
  const normalized = {
    glob: addon.glob,
    grep: addon.grep,
    search: addon.search,
    hasMatch: addon.hasMatch ?? addon.has_match,
    invalidateFsScanCache: addon.invalidateFsScanCache ?? addon.invalidate_fs_scan_cache,
  };

  for (const [name, value] of Object.entries(normalized)) {
    if (typeof value !== "function") {
      throw new Error(`Native addon ${loadedFrom} is missing export ${name}`);
    }
  }

  return normalized as NativeAddon;
}

const native = loadNativeAddon();

export const glob = native.glob;
export const grep = native.grep;
export const search = native.search;
export const hasMatch = native.hasMatch;
export const invalidateFsScanCache = native.invalidateFsScanCache;
export default native;
