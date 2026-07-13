import path from "node:path";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { grep as nativeGrep } from "../native.js";
import type { GrepMatch } from "../types.js";
import { formatGrepGroups } from "../utils/format.js";
import {
  hasGlobMagic,
  joinDisplayPath,
  normalizeOutputPath,
  parsePathSpec,
  resolveCwd,
  splitPathList,
  toDisplayPath,
} from "../utils/path-utils.js";

const TIMEOUT_MS = 30_000;
const FILE_PAGE_LIMIT = 10;
const RENDERED_MATCH_LIMIT = 10;
const MULTI_FILE_MATCH_LIMIT = 20;
const SINGLE_FILE_MATCH_LIMIT = 200;
const NATIVE_MATCH_LIMIT = 2_000;
const MAX_USER_LIMIT = 5_000;
const DEFAULT_SCAN_LIMIT = 50_000;
const MAX_SCAN_LIMIT = 1_000_000;
const MAX_COLUMNS = 500;

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for." }),
  path: Type.Optional(
    Type.String({
      description: "File, directory (searched recursively), glob, or semicolon-/whitespace-delimited paths to search.",
    }),
  ),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string instead of a regex." })),
  case: Type.Optional(Type.Boolean({ description: "Use case-sensitive matching. Defaults to true." })),
  gitignore: Type.Optional(Type.Boolean({ description: "Respect .gitignore files. Defaults to true." })),
  exclude: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Glob patterns to exclude relative to each traversal root; no negation; explicit file operands override exclusions; independent of gitignore; patterns ending in /** prune directories.",
    }),
  ),
  scanLimit: Type.Optional(
    Type.Number({
      description:
        "Maximum total entries to scan across this tool call, clamped to 1..1000000. Results may be partial when the budget is reached. Defaults to 50000.",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum total matches to collect across all files, not files returned; clamped to 1..5000." })),
  skip: Type.Optional(Type.Number({ description: "Number of matching files to skip for pagination." })),
  contextBefore: Type.Optional(Type.Number({ description: "Lines of context before each match." })),
  contextAfter: Type.Optional(Type.Number({ description: "Lines of context after each match." })),
});

type GrepInput = Static<typeof grepSchema>;

export interface GrepToolDetails {
  filesSearched: number;
  filesWithMatches: number;
  totalMatches: number;
  returnedFiles: number;
  skip: number;
  limit: number;
  scanLimit: number;
  scannedEntries: number;
  resultLimitReached: boolean;
  scanLimitReached: boolean;
  limitReached: boolean;
  nativeLimitReached: boolean;
  skippedOversized: number;
  maxMatchesPerFile: number;
  maxRenderedMatchesPerFile: number;
  maxReturnedFiles: number;
  lineTruncated: boolean;
  truncation?: ReturnType<typeof formatGrepGroups>["truncation"];
}

export function createGrepTool(): ToolDefinition<typeof grepSchema, GrepToolDetails> {
  return {
    name: "grep",
    label: "Grep",
    description:
      "Search file contents by regex or literal text. Supports file, directory, glob, or semicolon-/whitespace-delimited paths. Results are grouped by file and paginated with skip.",
    promptSnippet: "grep: search file contents by regex or literal text",
    promptGuidelines: [
      "Use grep with literal=true for exact text containing regex characters.",
      "Use grep on the narrowest available path or glob; for broad searches start with limit=50 and no context lines, then narrow before increasing either.",
      "Use grep skip to page through additional matching files instead of requesting a large response.",
    ],
    parameters: grepSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const cwd = resolveCwd(ctx?.cwd);
        const result = await runGrep(params, cwd, signal);
        const skip = clampNonNegativeInteger(params.skip);
        const page = result.groups.slice(skip, skip + FILE_PAGE_LIMIT);
        const omittedFiles = Math.max(0, result.groups.length - skip - page.length);
        const renderedPage = page.map(
          ([filePath, matches]) => [filePath, matches.slice(0, RENDERED_MATCH_LIMIT)] as [string, GrepMatch[]],
        );
        const renderedMatchesOmitted = page.some(([, matches]) => matches.length > RENDERED_MATCH_LIMIT);
        const lineTruncated = renderedPage.some(([, matches]) => matches.some((match) => match.truncated));
        const resultLimitReached = result.resultLimitReached;
        const scanLimitReached = result.scanLimitReached;
        const limitReached = resultLimitReached || scanLimitReached || omittedFiles > 0 || renderedMatchesOmitted;
        const formatted = formatGrepGroups(
          renderedPage,
          omittedFiles,
          buildGrepNotices({
            resultLimitReached,
            renderedMatchesOmitted,
            scanLimitReached,
            scanLimit: result.scanLimit,
            skippedOversized: result.skippedOversized,
            lineTruncated,
          }),
        );

        return {
          content: [{ type: "text", text: formatted.text }],
          details: {
            filesSearched: result.filesSearched,
            filesWithMatches: result.groups.length,
            totalMatches: result.totalMatches,
            returnedFiles: page.length,
            skip,
            limit: result.limit,
            scanLimit: result.scanLimit,
            scannedEntries: result.scannedEntries,
            resultLimitReached,
            scanLimitReached,
            limitReached,
            nativeLimitReached: result.nativeLimitReached,
            skippedOversized: result.skippedOversized,
            maxMatchesPerFile: result.maxMatchesPerFile,
            maxRenderedMatchesPerFile: RENDERED_MATCH_LIMIT,
            maxReturnedFiles: FILE_PAGE_LIMIT,
            lineTruncated,
            truncation: formatted.truncation,
          },
        };
      } catch (error) {
        throw normalizeGrepError(error);
      }
    },
  };
}

async function runGrep(params: GrepInput, cwd: string, signal: AbortSignal | undefined) {
  validatePattern(params.pattern);

  const grouped = new Map<string, GrepMatch[]>();
  let filesSearched = 0;
  let totalMatches = 0;
  let collectedMatches = 0;
  let nativeLimitReached = false;
  let resultLimitReached = false;
  let scanLimitReached = false;
  let scannedEntries = 0;
  let skippedOversized = 0;
  let allEntriesMissing = true;
  const rawPaths = splitPathList(params.path, cwd);
  const singlePath = rawPaths.length === 1;
  const userLimit = clampPositiveInteger(params.limit, MAX_USER_LIMIT);
  const scanLimit = clampScanLimit(params.scanLimit);
  const pattern = params.literal ? escapeRegex(params.pattern) : params.pattern;
  let effectiveLimit = userLimit ?? NATIVE_MATCH_LIMIT;
  let maxMatchesPerFile = MULTI_FILE_MATCH_LIMIT;

  for (const rawPath of rawPaths) {
    const spec = parsePathSpec(rawPath, cwd);
    if (spec.missing) {
      continue;
    }
    allEntriesMissing = false;

    const explicitSingleFile = singlePath && Boolean(spec.explicitFile);
    const defaultLimit = explicitSingleFile ? SINGLE_FILE_MATCH_LIMIT : NATIVE_MATCH_LIMIT;
    const maxCount = userLimit ?? defaultLimit;
    const perFileLimit = explicitSingleFile ? maxCount : MULTI_FILE_MATCH_LIMIT;
    effectiveLimit = maxCount;
    maxMatchesPerFile = perFileLimit;

    const remaining = maxCount - collectedMatches;
    if (remaining <= 0) {
      resultLimitReached = true;
      break;
    }
    const isGlobPath = hasGlobMagic(rawPath);
    const remainingScanLimit = scanLimit - scannedEntries;
    if (remainingScanLimit <= 0 && !spec.explicitFile) {
      scanLimitReached = true;
      break;
    }
    const result = await nativeGrep({
      pattern,
      path: spec.absoluteRoot,
      glob: isGlobPath ? spec.pattern : undefined,
      ignoreCase: !(params.case ?? true),
      hidden: true,
      gitignore: params.gitignore ?? true,
      exclude: params.exclude,
      scanLimit: spec.explicitFile ? scanLimit : remainingScanLimit,
      maxCount: remaining,
      maxCountPerFile: perFileLimit,
      contextBefore: clampNonNegativeInteger(params.contextBefore),
      contextAfter: clampNonNegativeInteger(params.contextAfter),
      maxColumns: MAX_COLUMNS,
      signal,
      timeoutMs: TIMEOUT_MS,
    });

    filesSearched += result.filesSearched;
    totalMatches += result.totalMatches;
    collectedMatches += result.matches.length;
    nativeLimitReached ||= result.resultLimitReached;
    resultLimitReached ||= result.resultLimitReached;
    scanLimitReached ||= result.scanLimitReached;
    scannedEntries += result.scannedEntries;
    skippedOversized += result.skippedOversized ?? 0;

    for (const match of result.matches) {
      const displayPath = normalizeMatchPath(match.path, spec.displayPrefix, cwd);
      const matches = grouped.get(displayPath) ?? [];
      matches.push({ ...match, path: displayPath });
      grouped.set(displayPath, matches);
    }

    if (result.resultLimitReached) {
      break;
    }
  }

  if (allEntriesMissing) {
    throw new Error(`Path not found: ${params.path ?? "."}`);
  }

  return {
    groups: [...grouped.entries()],
    filesSearched,
    totalMatches,
    limit: effectiveLimit,
    scannedEntries,
    resultLimitReached,
    scanLimitReached,
    scanLimit,
    nativeLimitReached,
    skippedOversized,
    maxMatchesPerFile,
  };
}

function buildGrepNotices(options: {
  resultLimitReached: boolean;
  renderedMatchesOmitted: boolean;
  scanLimitReached: boolean;
  scanLimit: number;
  skippedOversized: number;
  lineTruncated: boolean;
}): string[] {
  const notices: string[] = [];
  if (options.resultLimitReached || options.renderedMatchesOmitted) {
    notices.push("More matches omitted. Narrow path/glob or increase limit.");
  }
  if (options.scanLimitReached) {
    notices.push(
      `Search stopped after scanning ${options.scanLimit} entries. Results may be incomplete; narrow the path/glob or add exclude patterns.`,
    );
  }
  if (options.skippedOversized > 0) {
    notices.push(`${options.skippedOversized} oversized files were skipped or searched only by prefix.`);
  }
  if (options.lineTruncated) {
    notices.push(`Some lines were truncated to ${MAX_COLUMNS} columns. Use read for full content.`);
  }
  return notices;
}

function normalizeMatchPath(matchPath: string, displayPrefix: string, cwd: string): string {
  if (path.isAbsolute(matchPath)) {
    return toDisplayPath(matchPath, cwd);
  }
  return joinDisplayPath(displayPrefix, normalizeOutputPath(matchPath));
}

function clampNonNegativeInteger(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function clampPositiveInteger(value: number | undefined, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function clampScanLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SCAN_LIMIT;
  }
  return Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.trunc(value)));
}

function validatePattern(pattern: string): void {
  if (!pattern.trim()) {
    throw new Error("Pattern must not be empty");
  }
}

function escapeRegex(pattern: string): string {
  return pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function normalizeGrepError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Invalid regex:")) {
    return error instanceof Error ? error : new Error(message);
  }
  if (/regex/i.test(message)) {
    return new Error(`Invalid regex: ${message}`);
  }
  if (/timed out|timeout|cancel/i.test(message)) {
    return new Error(`${message}. Narrow path or use glob first.`);
  }
  return error instanceof Error ? error : new Error(message);
}
