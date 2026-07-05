import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createGlobTool } from "../src/tools/glob.js";
import { createGrepTool } from "../src/tools/grep.js";

async function withFixture<T>(setup: (fixture: string) => Promise<T> | T): Promise<T> {
  const fixture = await mkdtemp(join(tmpdir(), "pi-grep-glob-tools-"));
  try {
    return await setup(fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function executeTool<TParams extends Record<string, unknown>, TDetails>(
  tool: ToolDefinition<any, TDetails>,
  params: TParams,
  cwd: string,
) {
  return tool.execute("test-call", params as never, undefined, undefined, { cwd } as ExtensionContext);
}

function textOf(result: Awaited<ReturnType<ToolDefinition["execute"]>>): string {
  return result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

describe("glob tool", () => {
  it("finds src/**/*.ts", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src", "nested"), { recursive: true });
      await writeFile(join(fixture, "src", "index.ts"), "export const index = 1;\n");
      await writeFile(join(fixture, "src", "nested", "thing.ts"), "export const thing = 1;\n");
      await writeFile(join(fixture, "src", "nested", "thing.js"), "export const thing = 1;\n");

      const result = await executeTool(createGlobTool(), { path: "src/**/*.ts" }, fixture);
      const lines = textOf(result).split("\n").sort();

      expect(lines).toEqual(["src/index.ts", "src/nested/thing.ts"]);
    });
  });

  it("respects gitignore", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, ".gitignore"), "ignored.ts\n");
      await writeFile(join(fixture, "visible.ts"), "visible\n");
      await writeFile(join(fixture, "ignored.ts"), "ignored\n");

      const respected = await executeTool(createGlobTool(), { path: "*.ts", gitignore: true }, fixture);
      expect(textOf(respected).split("\n")).toEqual(["visible.ts"]);

      const ignored = await executeTool(createGlobTool(), { path: "*.ts", gitignore: false }, fixture);
      expect(textOf(ignored).split("\n").sort()).toEqual(["ignored.ts", "visible.ts"]);
    });
  });

  it("includes hidden files when requested", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, ".hidden.ts"), "hidden\n");
      await writeFile(join(fixture, "visible.ts"), "visible\n");

      const withoutHidden = await executeTool(createGlobTool(), { path: "*.ts", hidden: false }, fixture);
      expect(textOf(withoutHidden).split("\n")).toEqual(["visible.ts"]);

      const withHidden = await executeTool(createGlobTool(), { path: "*.ts", hidden: true }, fixture);
      expect(textOf(withHidden).split("\n").sort()).toEqual([".hidden.ts", "visible.ts"]);
    });
  });

  it("returns directories with a trailing slash", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src"));
      await writeFile(join(fixture, "file.ts"), "file\n");

      const result = await executeTool(createGlobTool(), { path: "*", gitignore: false }, fixture);
      expect(textOf(result).split("\n").sort()).toEqual(["file.ts", "src/"]);
    });
  });

  it("enforces and clamps limit", async () => {
    await withFixture(async (fixture) => {
      for (let index = 0; index < 5; index += 1) {
        await writeFile(join(fixture, `file-${index}.ts`), "file\n");
      }

      const limited = await executeTool(createGlobTool(), { path: "*.ts", limit: 2, gitignore: false }, fixture);
      expect(textOf(limited).split("\n")).toHaveLength(2);
      expect(limited.details?.limit).toBe(2);
      expect(limited.details?.returnedMatches).toBe(2);

      const clamped = await executeTool(createGlobTool(), { path: "*.ts", limit: 500, gitignore: false }, fixture);
      expect(clamped.details?.limit).toBe(200);
    });
  });

  it("skips missing entries in multi-path calls", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "found.ts"), "found\n");

      const result = await executeTool(createGlobTool(), { path: "missing.ts; found.ts" }, fixture);
      expect(textOf(result)).toBe("found.ts");
    });
  });
});

describe("grep tool", () => {
  it("finds line matches", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "alpha\ntarget line\nomega\n");

      const result = await executeTool(createGrepTool(), { pattern: "target", path: "a.txt" }, fixture);
      expect(textOf(result)).toContain("a.txt\n*2|target line");
      expect(result.details?.totalMatches).toBe(1);
    });
  });

  it("respects case sensitivity", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "Hello\n");

      const sensitive = await executeTool(createGrepTool(), { pattern: "hello", path: "a.txt", case: true }, fixture);
      expect(textOf(sensitive)).toBe("No matches found.");

      const insensitive = await executeTool(createGrepTool(), { pattern: "hello", path: "a.txt", case: false }, fixture);
      expect(textOf(insensitive)).toContain("*1|Hello");
    });
  });

  it("respects gitignore", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, ".gitignore"), "ignored.txt\n");
      await writeFile(join(fixture, "visible.txt"), "needle\n");
      await writeFile(join(fixture, "ignored.txt"), "needle\n");

      const respected = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", gitignore: true }, fixture);
      expect(textOf(respected)).toContain("visible.txt");
      expect(textOf(respected)).not.toContain("ignored.txt");

      const ignored = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", gitignore: false }, fixture);
      expect(textOf(ignored)).toContain("visible.txt");
      expect(textOf(ignored)).toContain("ignored.txt");
    });
  });

  it("handles invalid regex", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "text\n");

      await expect(executeTool(createGrepTool(), { pattern: "(", path: "a.txt" }, fixture)).rejects.toThrow(/Invalid regex:/);
    });
  });

  it("paginates by file with skip", async () => {
    await withFixture(async (fixture) => {
      for (let index = 0; index < 25; index += 1) {
        await writeFile(join(fixture, `file-${index.toString().padStart(2, "0")}.txt`), "needle\n");
      }

      const firstPage = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt" }, fixture);
      expect(firstPage.details?.filesWithMatches).toBe(25);
      expect(firstPage.details?.returnedFiles).toBe(20);
      expect(textOf(firstPage)).toContain("[5 more files with matches omitted. Use skip to view more.]");

      const secondPage = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", skip: 20 }, fixture);
      expect(secondPage.details?.filesWithMatches).toBe(25);
      expect(secondPage.details?.returnedFiles).toBe(5);
      expect(textOf(secondPage)).not.toContain("more files with matches omitted");
    });
  });

  it("formats context lines with match markers", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "before\nneedle\nafter\n");

      const result = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: "a.txt", contextBefore: 1, contextAfter: 1 },
        fixture,
      );

      expect(textOf(result)).toContain(" 1|before\n*2|needle\n 3|after");
    });
  });

  it("truncates long output", async () => {
    await withFixture(async (fixture) => {
      const longNeedleLine = `${"x".repeat(600)} needle\n`;
      for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
        await writeFile(join(fixture, `file-${fileIndex.toString().padStart(2, "0")}.txt`), longNeedleLine.repeat(20));
      }

      const result = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", gitignore: false }, fixture);

      expect(result.details?.truncation?.truncated).toBe(true);
      expect(textOf(result)).toContain("[Output truncated:");
    });
  });
});
