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

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for." }),
  path: Type.Optional(Type.String({ description: "File, directory, glob, or semicolon-delimited paths to search." })),
  case: Type.Optional(Type.Boolean({ description: "Use case-sensitive matching. Defaults to true." })),
  gitignore: Type.Optional(Type.Boolean({ description: "Respect .gitignore files. Defaults to true." })),
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
  truncation?: ReturnType<typeof formatGrepGroups>["truncation"];
}

export function createGrepTool(): ToolDefinition<typeof grepSchema, GrepToolDetails> {
  return {
    name: "grep",
    label: "Grep",
    description:
      "Search file contents by regex. Supports file, directory, glob, or semicolon-delimited paths. Results are grouped by file and paginated with skip.",
    promptSnippet: "grep: search file contents by regex",
    promptGuidelines: ["Use glob first to narrow broad searches when possible.", "Use skip to page through matching files."],
    parameters: grepSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const cwd = resolveCwd(ctx?.cwd);
        const result = await runGrep(params, cwd, signal);
        const skip = clampNonNegativeInteger(params.skip);
        const page = result.groups.slice(skip, skip + FILE_PAGE_LIMIT);
        const formatted = formatGrepGroups(page, Math.max(0, result.groups.length - skip - page.length));

        return {
          content: [{ type: "text", text: formatted.text }],
          details: {
            filesSearched: result.filesSearched,
            filesWithMatches: result.groups.length,
            totalMatches: result.totalMatches,
            returnedFiles: page.length,
            skip,
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
  validateRegexPattern(params.pattern);

  const grouped = new Map<string, GrepMatch[]>();
  let filesSearched = 0;
  let totalMatches = 0;
  let allEntriesMissing = true;
  const rawPaths = splitPathList(params.path);
  const singlePath = rawPaths.length === 1;

  for (const rawPath of rawPaths) {
    const spec = parsePathSpec(rawPath, cwd);
    if (spec.missing) {
      continue;
    }
    allEntriesMissing = false;

    const isGlobPath = hasGlobMagic(rawPath);
    const result = await nativeGrep({
      pattern: params.pattern,
      path: spec.absoluteRoot,
      glob: isGlobPath ? spec.pattern : undefined,
      ignoreCase: !(params.case ?? true),
      hidden: true,
      gitignore: params.gitignore ?? true,
      maxCount: singlePath && spec.explicitFile ? SINGLE_FILE_MATCH_LIMIT : NATIVE_MATCH_LIMIT,
      maxCountPerFile: singlePath && spec.explicitFile ? SINGLE_FILE_MATCH_LIMIT : MULTI_FILE_MATCH_LIMIT,
      contextBefore: clampNonNegativeInteger(params.contextBefore),
      contextAfter: clampNonNegativeInteger(params.contextAfter),
      maxColumns: 500,
      signal,
      timeoutMs: TIMEOUT_MS,
    });

    filesSearched += result.filesSearched;
    totalMatches += result.totalMatches;

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
  };
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

function validateRegexPattern(pattern: string): void {
  if (!pattern.trim()) {
    throw new Error("Pattern must not be empty");
  }
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
