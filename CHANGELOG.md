# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## - 2026-07-13

### Added

- Added request-specific `exclude` glob patterns to `glob` and `grep`.
- Added directory pruning for exclusion patterns ending in `/**`.
- Added explicit-file overrides so directly requested files remain searchable when they match an exclusion.
- Added `scanLimit` to bound filesystem traversal, defaulting to 50,000 entries with a maximum of 1,000,000.
- Added `scannedEntries`, `resultLimitReached`, and `scanLimitReached` result details.
- Added clear notices when result or scan limits produce partial results.
- Added Rust and TypeScript coverage for exclusions, pruning, scan budgets, limit boundaries, and direct-file behavior.

### Changed

- Reduced the default `glob` result limit from 200 to 50.
- Changed public `glob` traversal to deterministic path order so broad searches can stop after collecting enough results.
- Limited rendered `grep` responses to 10 files and 10 matches per file without reducing native collection capacity.
- Limited rendered `grep` output to 16 KiB or 300 lines while preserving pagination and truncation notices.
- Applied `scanLimit` across all roots in a path-list request as one global budget.
- Documented that plain directory paths are recursive and that `dir/*` inspects one level.
- Improved tool guidance to encourage narrow searches, pagination, and explicit exclusions.
- Clarified that `totalMatches` is a lower bound when a result or scan limit is reached.

### Fixed

- Prevented excluded directories from being traversed before filtering results.
- Prevented broad non-ranked glob searches from scanning the full tree after reaching the result limit.
- Made grep result-limit reporting distinguish an exact boundary from omitted matches.
- Made scan-limited grep traversal deterministic across execution modes.
- Preserved partial-result, pagination, and truncation notices when grep output is truncated.
- Prevented duplicate path-list roots from prematurely stopping glob before the global unique result limit is reached.
- Ensured invalid exclusion patterns report the offending pattern, including explicit-file glob requests.
