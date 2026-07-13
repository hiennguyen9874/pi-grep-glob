import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileType, glob, grep } from "../src/native.js";

describe("native loader", () => {
  it("loads the native addon and calls glob on a temp fixture", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "pi-grep-glob-native-"));

    try {
      await mkdir(join(fixture, "nested"));
      await writeFile(join(fixture, "a.ts"), "export const a = 1;\n");
      await writeFile(join(fixture, "nested", "b.ts"), "export const b = 2;\n");
      await writeFile(join(fixture, "ignored.txt"), "not a TypeScript file\n");

      const result = await glob({
        pattern: "*.ts",
        path: fixture,
        recursive: true,
        hidden: true,
        gitignore: false,
        maxResults: 10,
      });

      expect(result.matches.map((match) => match.path).sort()).toEqual(["a.ts", "nested/b.ts"]);
      expect(result.totalMatches).toBe(2);
      expect(result.resultLimitReached).toBe(false);
      expect(result.scanLimitReached).toBe(false);
      expect(result.limitReached).toBe(false);
      expect(result.scannedEntries).toBeGreaterThanOrEqual(3);
      expect(result.matches.every((match) => match.fileType === FileType.File)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("reports native exclusions and scan limits", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "pi-grep-glob-native-bounded-"));

    try {
      await mkdir(join(fixture, "dataset", "nested"), { recursive: true });
      await writeFile(join(fixture, "dataset", "nested", "drop.ts"), "needle\n");
      await writeFile(join(fixture, "keep.ts"), "needle\n");

      const excluded = await glob({
        pattern: "*.ts",
        path: fixture,
        recursive: true,
        hidden: true,
        gitignore: false,
        exclude: ["dataset/**"],
        maxResults: 10,
        sortByMtime: false,
      });
      expect(excluded.matches.map((match) => match.path)).toEqual(["keep.ts"]);
      expect(excluded.scanLimitReached).toBe(false);

      const partial = await grep({
        pattern: "needle",
        path: fixture,
        hidden: true,
        gitignore: false,
        scanLimit: 1,
        maxCount: 100,
      });
      expect(partial.scanLimitReached).toBe(true);
      expect(partial.resultLimitReached).toBe(false);
      expect(partial.limitReached).toBe(true);
      expect(partial.scannedEntries).toBe(1);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
