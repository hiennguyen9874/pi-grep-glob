export type NativeCallback<T> = (error: Error | null, value: T) => void;

export type FileTypeValue = 1 | 2 | 3;

export interface GlobOptions {
  pattern: string;
  path: string;
  exclude?: string[];
  scanLimit?: number;
  fileType?: FileTypeValue;
  recursive?: boolean;
  hidden?: boolean;
  maxResults?: number;
  gitignore?: boolean;
  cache?: boolean;
  sortByMtime?: boolean;
  includeNodeModules?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GlobMatch {
  path: string;
  fileType: FileTypeValue;
  mtime?: number;
  size?: number;
}

export interface GlobResult {
  matches: GlobMatch[];
  totalMatches: number;
  scannedEntries: number;
  resultLimitReached: boolean;
  scanLimitReached: boolean;
  limitReached: boolean;
}

export type GrepOutputModeValue = "content" | "count" | "filesWithMatches";

export interface SearchOptions {
  pattern: string;
  ignoreCase?: boolean;
  multiline?: boolean;
  maxCount?: number;
  offset?: number;
  contextBefore?: number;
  contextAfter?: number;
  context?: number;
  maxColumns?: number;
  mode?: GrepOutputModeValue;
}

export interface GrepOptions extends SearchOptions {
  path: string;
  glob?: string;
  type?: string;
  hidden?: boolean;
  gitignore?: boolean;
  exclude?: string[];
  scanLimit?: number;
  maxCountPerFile?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ContextLine {
  lineNumber: number;
  line: string;
}

export interface Match {
  lineNumber: number;
  line: string;
  contextBefore?: ContextLine[];
  contextAfter?: ContextLine[];
  truncated?: boolean;
}

export interface SearchResult {
  matches: Match[];
  matchCount: number;
  limitReached: boolean;
  error?: string;
}

export interface GrepMatch extends Match {
  path: string;
  matchCount?: number;
}

export interface GrepResult {
  matches: GrepMatch[];
  totalMatches: number;
  filesWithMatches: number;
  filesSearched: number;
  limitReached?: boolean;
  resultLimitReached: boolean;
  scannedEntries: number;
  scanLimitReached: boolean;
  skippedOversized?: number;
}

export interface NativeAddon {
  glob(options: GlobOptions, onMatch?: NativeCallback<GlobMatch> | null): Promise<GlobResult>;
  grep(options: GrepOptions, onMatch?: NativeCallback<GrepMatch> | null): Promise<GrepResult>;
  search(content: string | Uint8Array, options: SearchOptions): SearchResult;
  hasMatch(
    content: string | Uint8Array,
    pattern: string | Uint8Array,
    ignoreCase?: boolean,
    multiline?: boolean,
  ): boolean;
  invalidateFsScanCache(path?: string | null): void;
}
