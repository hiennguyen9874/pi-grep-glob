import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface PathSpec {
  absoluteRoot: string;
  displayPrefix: string;
  pattern?: string;
  explicitFile?: string;
  missing?: boolean;
}

const GLOB_CHARS = new Set(["*", "?", "[", "]", "{", "}"]);

export function splitPathList(value: string | undefined): string[] {
  const pathValue = value?.trim() || ".";
  return pathValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveCwd(cwd: string | undefined): string {
  return path.resolve(cwd || process.cwd());
}

export function rejectRootSearch(absolutePath: string): void {
  const parsed = path.parse(path.resolve(absolutePath));
  if (path.resolve(absolutePath) === parsed.root) {
    throw new Error("Refusing to search filesystem root. Narrow the path and try again.");
  }
}

export function normalizeOutputPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

export function toDisplayPath(absolutePath: string, cwd: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return normalizeOutputPath(relative);
  }
  if (!relative) {
    return ".";
  }
  return normalizeOutputPath(path.resolve(absolutePath));
}

export function joinDisplayPath(prefix: string, relativePath: string): string {
  const normalizedRelative = normalizeOutputPath(relativePath);
  if (!prefix || prefix === ".") {
    return normalizedRelative;
  }
  return normalizeOutputPath(path.posix.join(normalizeOutputPath(prefix), normalizedRelative));
}

export function hasGlobMagic(value: string): boolean {
  return [...value].some((char) => GLOB_CHARS.has(char));
}

export function parsePathSpec(rawPath: string, cwd: string): PathSpec {
  const normalizedRaw = rawPath || ".";

  if (!hasGlobMagic(normalizedRaw)) {
    const absolutePath = path.resolve(cwd, normalizedRaw);
    rejectRootSearch(absolutePath);

    if (!existsSync(absolutePath)) {
      return {
        absoluteRoot: absolutePath,
        displayPrefix: toDisplayPath(absolutePath, cwd),
        missing: true,
      };
    }

    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      return {
        absoluteRoot: absolutePath,
        displayPrefix: toDisplayPath(absolutePath, cwd),
        pattern: "*",
      };
    }

    return {
      absoluteRoot: absolutePath,
      displayPrefix: toDisplayPath(path.dirname(absolutePath), cwd),
      explicitFile: toDisplayPath(absolutePath, cwd),
    };
  }

  const { root, pattern } = splitGlobRoot(normalizedRaw);
  const absoluteRoot = path.resolve(cwd, root || ".");
  rejectRootSearch(absoluteRoot);

  if (!existsSync(absoluteRoot)) {
    return {
      absoluteRoot,
      displayPrefix: toDisplayPath(absoluteRoot, cwd),
      pattern,
      missing: true,
    };
  }

  return {
    absoluteRoot,
    displayPrefix: toDisplayPath(absoluteRoot, cwd),
    pattern,
  };
}

function splitGlobRoot(value: string): { root: string; pattern: string } {
  const normalized = value.replaceAll("\\", "/");
  const absoluteRoot = path.isAbsolute(value) ? path.parse(value).root.replaceAll("\\", "/") : "";
  const withoutRoot = absoluteRoot ? normalized.slice(absoluteRoot.length) : normalized;
  const parts = withoutRoot.split("/");
  const magicIndex = parts.findIndex(hasGlobMagic);

  if (magicIndex === -1) {
    return { root: value, pattern: "*" };
  }

  const rootParts = parts.slice(0, magicIndex).filter(Boolean);
  const patternParts = parts.slice(magicIndex).filter(Boolean);
  const root = absoluteRoot ? path.join(absoluteRoot, ...rootParts) : rootParts.join("/") || ".";
  const pattern = patternParts.join("/") || "*";

  return { root, pattern };
}
