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

export function formatGlobPaths(paths: string[], omitted = 0): FormattedOutput {
  const body = paths.length > 0 ? paths.join("\n") : "No matches found.";
  const suffix = omitted > 0 ? `\n\n[${omitted} more matches omitted. Increase limit to see more.]` : "";
  return limitText(`${body}${suffix}`);
}

export function formatGrepGroups(groups: Array<[string, GrepMatch[]]>, omittedFiles = 0): FormattedOutput {
  if (groups.length === 0) {
    return limitText("No matches found.");
  }

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

  const suffix = omittedFiles > 0 ? `\n\n[${omittedFiles} more files with matches omitted. Use skip to view more.]` : "";
  return limitText(`${sections.join("\n\n")}${suffix}`);
}

function formatMatchLine(match: GrepMatch): string {
  return `*${match.lineNumber}|${match.line}`;
}

function formatContextLine(line: ContextLine): string {
  return ` ${line.lineNumber}|${line.line}`;
}
