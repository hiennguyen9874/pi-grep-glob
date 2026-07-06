import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";

import type { ContextLine, GrepMatch } from "../types.js";

export interface FormattedOutput {
  text: string;
  truncation?: ReturnType<typeof truncateHead>;
}

export function limitText(text: string): FormattedOutput {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return { text };
  }

  return {
    text: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines.]`,
    truncation,
  };
}

export function formatGlobPaths(paths: string[], omitted = 0, notices: string[] = []): FormattedOutput {
  const body = paths.length > 0 ? paths.join("\n") : "No matches found.";
  const suffixes = [
    omitted > 0 ? "More matches omitted. Increase limit or narrow path." : undefined,
    ...notices,
  ].filter((notice): notice is string => Boolean(notice));
  const suffix = suffixes.length > 0 ? `\n\n${suffixes.map((notice) => `[${notice}]`).join("\n")}` : "";
  return limitText(`${body}${suffix}`);
}

export function formatGrepGroups(
  groups: Array<[string, GrepMatch[]]>,
  omittedFiles = 0,
  notices: string[] = [],
): FormattedOutput {
  const body = groups.length === 0 ? "No matches found." : formatGrepSections(groups);
  const suffixes = [
    omittedFiles > 0 ? `${omittedFiles} more files with matches omitted. Use skip to view more.` : undefined,
    ...notices,
  ].filter((notice): notice is string => Boolean(notice));
  const suffix = suffixes.length > 0 ? `\n\n${suffixes.map((notice) => `[${notice}]`).join("\n")}` : "";
  return limitText(`${body}${suffix}`);
}

function formatGrepSections(groups: Array<[string, GrepMatch[]]>): string {
  const sections = groups.map(([filePath, matches]) => {
    const lines = [filePath];
    for (const match of matches) {
      for (const context of match.contextBefore ?? []) {
        lines.push(formatContextLine(context));
      }
      lines.push(formatMatchLine(match));
      for (const context of match.contextAfter ?? []) {
        lines.push(formatContextLine(context));
      }
    }
    return lines.join("\n");
  });

  return sections.join("\n\n");
}

function formatMatchLine(match: GrepMatch): string {
  return `*${match.lineNumber}|${match.line}`;
}

function formatContextLine(line: ContextLine): string {
  return ` ${line.lineNumber}|${line.line}`;
}
