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
const FILE_PAGE_LIMIT = 20;
const MULTI_FILE_MATCH_LIMIT = 20;
const SINGLE_FILE_MATCH_LIMIT = 200;
const NATIVE_MATCH_LIMIT = 2_000;
const MAX_USER_LIMIT = 5_000;
const MAX_COLUMNS = 500;

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for." }),
  path: Type.Optional(Type.String({ description: "File, directory, glob, or semicolon-/whitespace-delimited paths to search." })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string instead of a regex." })),
  case: Type.Optional(Type.Boolean({ description: "Use case-sensitive matching. Defaults to true." })),
  gitignore: Type.Optional(Type.Boolean({ description: "Respect .gitignore files. Defaults to true." })),
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
  limitReached: boolean;
  nativeLimitReached: boolean;
  skippedOversized: number;
  maxMatchesPerFile: number;
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
      "Set literal=true when you want exact text, especially if the pattern includes regex characters like ., *, (, [, or ?.",
      "Prefer the narrowest path you can; use a specific directory or glob before searching the whole workspace.",
      "Use skip to page through more matching files; each response returns at most 20 files.",
    ],
    parameters: grepSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const cwd = resolveCwd(ctx?.cwd);
        const result = await runGrep(params, cwd, signal);
        const skip = clampNonNegativeInteger(params.skip);
        const page = result.groups.slice(skip, skip + FILE_PAGE_LIMIT);
        const omittedFiles = Math.max(0, result.groups.length - skip - page.length);
        const lineTruncated = page.some(([, matches]) => matches.some((match) => match.truncated));
        const limitReached = omittedFiles > 0 || result.nativeLimitReached;
        const formatted = formatGrepGroups(
          page,
          omittedFiles,
          buildGrepNotices({
            limitReached,
            skippedOversized: result.skippedOversized,
            maxMatchesPerFile: result.maxMatchesPerFile,
            maxReturnedFiles: FILE_PAGE_LIMIT,
            lineTruncated,
            limit: result.limit,
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
            limitReached,
            nativeLimitReached: result.nativeLimitReached,
            skippedOversized: result.skippedOversized,
            maxMatchesPerFile: result.maxMatchesPerFile,
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
  let skippedOversized = 0;
  let allEntriesMissing = true;
  const rawPaths = splitPathList(params.path, cwd);
  const singlePath = rawPaths.length === 1;
  const userLimit = clampPositiveInteger(params.limit, MAX_USER_LIMIT);
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
      nativeLimitReached = true;
      break;
    }

    const isGlobPath = hasGlobMagic(rawPath);
    const result = await nativeGrep({
      pattern,
      path: spec.absoluteRoot,
      glob: isGlobPath ? spec.pattern : undefined,
      ignoreCase: !(params.case ?? true),
      hidden: true,
      gitignore: params.gitignore ?? true,
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
    nativeLimitReached ||= Boolean(result.limitReached);
    skippedOversized += result.skippedOversized ?? 0;

    for (const match of result.matches) {
      const displayPath = normalizeMatchPath(match.path, spec.displayPrefix, cwd);
      const matches = grouped.get(displayPath) ?? [];
      matches.push({ ...match, path: displayPath });
      grouped.set(displayPath, matches);
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
    nativeLimitReached,
    skippedOversized,
    maxMatchesPerFile,
  };
}

function buildGrepNotices(options: {
  limitReached: boolean;
  skippedOversized: number;
  maxMatchesPerFile: number;
  maxReturnedFiles: number;
  lineTruncated: boolean;
  limit: number;
}): string[] {
  const notices: string[] = [];
  if (options.limitReached) {
    notices.push(
      `Results limited: max ${options.limit} matches collected, showing ${options.maxReturnedFiles} files/page, ${options.maxMatchesPerFile} matches/file. Use skip or narrow path/glob.`,
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
