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

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;
const TIMEOUT_MS = 30_000;

const globSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "File, directory, glob, or semicolon-/whitespace-delimited paths to find." })),
  hidden: Type.Optional(Type.Boolean({ description: "Include hidden files and directories. Defaults to true." })),
  gitignore: Type.Optional(Type.Boolean({ description: "Respect .gitignore files. Defaults to true." })),
  limit: Type.Optional(Type.Number({ description: "Maximum paths to return, clamped to 1..1000. Defaults to 200." })),
});

type GlobInput = Static<typeof globSchema>;

export interface GlobToolDetails {
  totalMatches: number;
  returnedMatches: number;
  limit: number;
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
    parameters: globSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const cwd = resolveCwd(ctx?.cwd);
        const limit = clampLimit(params.limit);
        const paths = await runGlob(params, cwd, signal, limit);
        const omitted = paths.limitReached ? 1 : Math.max(0, paths.totalMatches - paths.matches.length);
        const formatted = formatGlobPaths(paths.matches, omitted);

        return {
          content: [{ type: "text", text: formatted.text }],
          details: {
            totalMatches: paths.totalMatches,
            returnedMatches: paths.matches.length,
            limit,
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

async function runGlob(params: GlobInput, cwd: string, signal: AbortSignal | undefined, limit: number) {
  const matches: string[] = [];
  const seen = new Set<string>();
  let allEntriesMissing = true;
  let limitReached = false;

  for (const rawPath of splitPathList(params.path, cwd)) {
    const spec = parsePathSpec(rawPath, cwd);
    if (spec.missing) {
      continue;
    }
    allEntriesMissing = false;

    if (spec.explicitFile) {
      const displayPath = normalizeOutputPath(spec.explicitFile);
      if (matches.length >= limit && !seen.has(displayPath)) {
        limitReached = true;
        break;
      }
      addUniqueMatch(matches, seen, displayPath);
      continue;
    }

    const remaining = Math.max(0, limit - matches.length);
    const result = await nativeGlob({
      pattern: spec.pattern ?? "*",
      path: spec.absoluteRoot,
      fileType: undefined,
      recursive: false,
      hidden: params.hidden ?? true,
      maxResults: remaining + 1,
      gitignore: params.gitignore ?? true,
      cache: true,
      sortByMtime: true,
      signal,
      timeoutMs: TIMEOUT_MS,
    });

    for (const match of result.matches) {
      const suffix = match.fileType === FileType.Dir ? "/" : "";
      addUniqueMatch(matches, seen, joinDisplayPath(spec.displayPrefix, `${match.path}${suffix}`));
      if (matches.length > limit) {
        limitReached = true;
        break;
      }
    }

    if (limitReached) {
      break;
    }
  }

  if (allEntriesMissing) {
    throw new Error(`Path not found: ${params.path ?? "."}`);
  }

  const returned = matches.slice(0, limit);
  return {
    matches: returned,
    totalMatches: returned.length + (limitReached ? 1 : 0),
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

function normalizeGlobError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|cancel/i.test(message)) {
    return new Error(`${message}. Narrow path or use a more specific glob.`);
  }
  return error instanceof Error ? error : new Error(message);
}
