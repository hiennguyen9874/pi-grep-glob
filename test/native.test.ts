import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileType, glob } from "../src/native.js";

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
      expect(result.matches.every((match) => match.fileType === FileType.File)).toBe(true);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
