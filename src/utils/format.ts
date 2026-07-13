import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";

import type { ContextLine, GrepMatch } from "../types.js";

const GREP_MAX_OUTPUT_BYTES = 16 * 1024;
const GREP_MAX_OUTPUT_LINES = 300;

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
    omitted > 0 ? "More matches omitted. Narrow path/glob or increase limit." : undefined,
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
  return formatGrepOutput(body, suffixes);
}

function formatGrepOutput(body: string, notices: string[]): FormattedOutput {
  const suffix = notices.length > 0 ? `\n\n${notices.map((notice) => `[${notice}]`).join("\n")}` : "";
  const fullText = `${body}${suffix}`;
  if (fitsGrepBudget(fullText)) {
    return { text: fullText };
  }

  let maxBytes = GREP_MAX_OUTPUT_BYTES;
  let maxLines = GREP_MAX_OUTPUT_LINES;
  let truncation = truncateHead(body, { maxBytes, maxLines });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const truncationNotice = truncation.truncated
      ? `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines.]`
      : "";
    const text = `${truncation.content}${truncationNotice}${suffix}`;
    if (fitsGrepBudget(text)) {
      return { text, truncation: truncation.truncated ? truncation : undefined };
    }

    const byteOverflow = Math.max(0, Buffer.byteLength(text, "utf-8") - GREP_MAX_OUTPUT_BYTES);
    const lineOverflow = Math.max(0, text.split("\n").length - GREP_MAX_OUTPUT_LINES);
    maxBytes = Math.max(0, maxBytes - Math.max(1, byteOverflow));
    maxLines = Math.max(0, maxLines - Math.max(1, lineOverflow));
    truncation = truncateHead(body, { maxBytes, maxLines });
  }

  const fallback = truncateHead(body, { maxBytes: 0, maxLines: 0 });
  const fallbackNotice = `[Output truncated: ${fallback.outputLines} of ${fallback.totalLines} lines.]`;
  const fallbackText = `${fallbackNotice}${suffix}`;
  return { text: fallbackText, truncation: fallback };
}

function fitsGrepBudget(text: string): boolean {
  return Buffer.byteLength(text, "utf-8") <= GREP_MAX_OUTPUT_BYTES && text.split("\n").length <= GREP_MAX_OUTPUT_LINES;
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
