import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { FileType, glob as nativeGlob } from "../native.js";
import { formatGlobPaths } from "../utils/format.js";
import {
  joinDisplayPath,
  normalizeOutputPath,
  parsePathSpec,
  resolveCwd,
  splitPathList,
} from "../utils/path-utils.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1_000;
const DEFAULT_SCAN_LIMIT = 50_000;
const MAX_SCAN_LIMIT = 1_000_000;
const TIMEOUT_MS = 30_000;

const globSchema = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "File, directory (searched recursively), glob, or semicolon-/whitespace-delimited paths to find. Use dir/* to inspect one level.",
    }),
  ),
  hidden: Type.Optional(Type.Boolean({ description: "Include hidden files and directories. Defaults to true." })),
  gitignore: Type.Optional(Type.Boolean({ description: "Respect .gitignore files. Defaults to true." })),
  exclude: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Glob patterns to exclude relative to each traversal root; no negation; explicit file operands override exclusions; independent of gitignore; patterns ending in /** prune directories.",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum paths to return, clamped to 1..1000. Defaults to 50." })),
  scanLimit: Type.Optional(
    Type.Number({
      description:
        "Maximum total entries to scan across this tool call, clamped to 1..1000000. Results may be partial when the budget is reached. Defaults to 50000.",
    }),
  ),
});

type GlobInput = Static<typeof globSchema>;

export interface GlobToolDetails {
  totalMatches: number;
  returnedMatches: number;
  limit: number;
  scanLimit: number;
  scannedEntries: number;
  resultLimitReached: boolean;
  scanLimitReached: boolean;
  limitReached: boolean;
  truncation?: ReturnType<typeof formatGlobPaths>["truncation"];
}

export function createGlobTool(): ToolDefinition<typeof globSchema, GlobToolDetails> {
  return {
    name: "glob",
    label: "Glob",
    description:
      "Find files and directories by file path, directory, glob pattern, or semicolon-/whitespace-delimited path list. Directories end with '/'.",
    promptSnippet: "glob: find files/directories by path or glob pattern",
    promptGuidelines: [
      "Use glob with limit=50 or less when exploring a broad or unfamiliar path. A plain directory path is recursive; use dir/* to inspect one level and narrow the glob before increasing the limit.",
      "Do not use glob to enumerate dataset, generated, dependency, build, or cache trees unless the task requires them; use grep directly with a narrow path/glob for content search.",
      "Keep glob gitignore=true unless ignored files are explicitly required.",
    ],
    parameters: globSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const cwd = resolveCwd(ctx?.cwd);
        const limit = clampLimit(params.limit);
        const scanLimit = clampScanLimit(params.scanLimit);
        const paths = await runGlob(params, cwd, signal, limit, scanLimit);
        const omitted = paths.resultLimitReached ? 1 : Math.max(0, paths.totalMatches - paths.matches.length);
        const formatted = formatGlobPaths(
          paths.matches,
          omitted,
          paths.scanLimitReached
            ? [`Search stopped after scanning ${scanLimit} entries. Results may be incomplete; narrow the path/glob or add exclude patterns.`]
            : [],
        );

        return {
          content: [{ type: "text", text: formatted.text }],
          details: {
            totalMatches: paths.totalMatches,
            returnedMatches: paths.matches.length,
            limit,
            scanLimit,
            scannedEntries: paths.scannedEntries,
            resultLimitReached: paths.resultLimitReached,
            scanLimitReached: paths.scanLimitReached,
            limitReached: paths.limitReached,
            truncation: formatted.truncation,
          },
        };
      } catch (error) {
        throw normalizeGlobError(error);
      }
    },
  };
}

async function runGlob(
  params: GlobInput,
  cwd: string,
  signal: AbortSignal | undefined,
  limit: number,
  scanLimit: number,
) {
  const matches: string[] = [];
  const seen = new Set<string>();
  let allEntriesMissing = true;
  let resultLimitReached = false;
  let scanLimitReached = false;
  let scannedEntries = 0;
  const specs = splitPathList(params.path, cwd).map((rawPath) => parsePathSpec(rawPath, cwd));
  const hasTraversalRoot = specs.some((spec) => !spec.missing && !spec.explicitFile);

  if (!hasTraversalRoot && params.exclude?.length && specs.some((spec) => !spec.missing)) {
    await nativeGlob({
      pattern: "*",
      path: cwd,
      exclude: params.exclude,
      scanLimit: 1,
      fileType: undefined,
      recursive: false,
      hidden: params.hidden ?? true,
      maxResults: 0,
      gitignore: params.gitignore ?? true,
      cache: true,
      sortByMtime: false,
      signal,
      timeoutMs: TIMEOUT_MS,
    });
  }

  for (const spec of specs) {
    if (spec.missing) {
      continue;
    }
    allEntriesMissing = false;

    if (spec.explicitFile) {
      addUniqueMatch(matches, seen, normalizeOutputPath(spec.explicitFile));
      if (matches.length > limit) {
        resultLimitReached = true;
        break;
      }
      continue;
    }

    if (scanLimitReached) {
      break;
    }
    const remainingScanLimit = scanLimit - scannedEntries;
    if (remainingScanLimit <= 0) {
      scanLimitReached = true;
      break;
    }
    const result = await nativeGlob({
      pattern: spec.pattern ?? "*",
      path: spec.absoluteRoot,
      exclude: params.exclude,
      scanLimit: remainingScanLimit,
      fileType: undefined,
      recursive: false,
      hidden: params.hidden ?? true,
      maxResults: limit + 1,
      gitignore: params.gitignore ?? true,
      cache: true,
      sortByMtime: false,
      signal,
      timeoutMs: TIMEOUT_MS,
    });

    scannedEntries += result.scannedEntries;
    scanLimitReached ||= result.scanLimitReached;

    for (const match of result.matches) {
      const suffix = match.fileType === FileType.Dir ? "/" : "";
      addUniqueMatch(matches, seen, joinDisplayPath(spec.displayPrefix, `${match.path}${suffix}`));
      if (matches.length > limit) {
        resultLimitReached = true;
        break;
      }
    }

    if (resultLimitReached || scanLimitReached) {
      break;
    }
  }

  if (allEntriesMissing) {
    throw new Error(`Path not found: ${params.path ?? "."}`);
  }

  const returned = matches.slice(0, limit);
  const limitReached = resultLimitReached || scanLimitReached;
  return {
    matches: returned,
    totalMatches: returned.length + (resultLimitReached ? 1 : 0),
    scannedEntries,
    resultLimitReached,
    scanLimitReached,
    limitReached,
  };
}

function addUniqueMatch(matches: string[], seen: Set<string>, match: string): void {
  if (seen.has(match)) {
    return;
  }
  seen.add(match);
  matches.push(match);
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function clampScanLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SCAN_LIMIT;
  }
  return Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(value)));
}

function normalizeGlobError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|cancel/i.test(message)) {
    return new Error(`${message}. Narrow path or use a more specific glob.`);
  }
  return error instanceof Error ? error : new Error(message);
}
