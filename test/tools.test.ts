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

  it("recursively finds nested files for a directory path", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src", "nested"), { recursive: true });
      await writeFile(join(fixture, "src", "index.ts"), "export const index = 1;\n");
      await writeFile(join(fixture, "src", "nested", "thing.ts"), "export const thing = 1;\n");

      const result = await executeTool(createGlobTool(), { path: "src", gitignore: false }, fixture);
      expect(textOf(result).split("\n").sort()).toEqual(["src/index.ts", "src/nested/", "src/nested/thing.ts"]);
    });
  });

  it("recursively finds nested files for a leading glob", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "nested"), { recursive: true });
      await writeFile(join(fixture, "top.ts"), "export const top = 1;\n");
      await writeFile(join(fixture, "nested", "thing.ts"), "export const thing = 1;\n");

      const result = await executeTool(createGlobTool(), { path: "*.ts", gitignore: false }, fixture);
      expect(textOf(result).split("\n").sort()).toEqual(["nested/thing.ts", "top.ts"]);
    });
  });

  it("keeps scoped single-star globs non-recursive", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src", "nested"), { recursive: true });
      await writeFile(join(fixture, "src", "index.ts"), "export const index = 1;\n");
      await writeFile(join(fixture, "src", "nested", "thing.ts"), "export const thing = 1;\n");

      const result = await executeTool(createGlobTool(), { path: "src/*.ts", gitignore: false }, fixture);
      expect(textOf(result).split("\n")).toEqual(["src/index.ts"]);
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
      expect(textOf(limited).split("\n").filter((line) => line && !line.startsWith("[")).length).toBe(2);
      expect(textOf(limited)).toContain("[More matches omitted. Increase limit or narrow path.]");
      expect(limited.details?.limit).toBe(2);
      expect(limited.details?.returnedMatches).toBe(2);
      expect(limited.details?.limitReached).toBe(true);

      const clamped = await executeTool(createGlobTool(), { path: "*.ts", limit: 5000, gitignore: false }, fixture);
      expect(clamped.details?.limit).toBe(1000);
    });
  });

  it("skips missing entries in multi-path calls", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "found.ts"), "found\n");

      const result = await executeTool(createGlobTool(), { path: "missing.ts; found.ts" }, fixture);
      expect(textOf(result)).toBe("found.ts");
    });
  });

  it("supports whitespace-delimited path lists", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src"));
      await mkdir(join(fixture, "test"));
      await writeFile(join(fixture, "src", "index.ts"), "src\n");
      await writeFile(join(fixture, "test", "index.ts"), "test\n");

      const result = await executeTool(createGlobTool(), { path: "src test", gitignore: false }, fixture);
      expect(textOf(result).split("\n").sort()).toEqual(["src/index.ts", "test/index.ts"]);
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

  it("supports whitespace-delimited path lists", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "src"));
      await mkdir(join(fixture, "test"));
      await writeFile(join(fixture, "src", "index.ts"), "needle in src\n");
      await writeFile(join(fixture, "test", "index.ts"), "needle in test\n");

      const result = await executeTool(createGrepTool(), { pattern: "needle", path: "src test" }, fixture);
      expect(textOf(result)).toContain("src/index.ts\n*1|needle in src");
      expect(textOf(result)).toContain("test/index.ts\n*1|needle in test");
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

  it("supports literal search for regex characters", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "abc\nfoo.bar\n");

      const regex = await executeTool(createGrepTool(), { pattern: ".", path: "a.txt" }, fixture);
      expect(regex.details?.totalMatches).toBe(2);

      const literal = await executeTool(createGrepTool(), { pattern: ".", path: "a.txt", literal: true }, fixture);
      expect(textOf(literal)).toContain("*2|foo.bar");
      expect(literal.details?.totalMatches).toBe(1);
    });
  });

  it("surfaces grep limit details and notice", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "needle\nneedle\nneedle\n");

      const result = await executeTool(createGrepTool(), { pattern: "needle", path: "a.txt", limit: 2 }, fixture);

      expect(result.details?.limit).toBe(2);
      expect(result.details?.limitReached).toBe(true);
      expect(result.details?.nativeLimitReached).toBe(true);
      expect(result.details?.maxMatchesPerFile).toBe(2);
      expect(textOf(result)).toContain("[Results limited: max 2 matches collected");
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

  it("accepts Rust regex syntax that JavaScript RegExp rejects", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "Hello\n");

      const result = await executeTool(createGrepTool(), { pattern: "(?i)hello", path: "a.txt" }, fixture);
      expect(textOf(result)).toContain("*1|Hello");
    });
  });

  it("rejects empty regex patterns", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "text\n");

      await expect(executeTool(createGrepTool(), { pattern: "  ", path: "a.txt" }, fixture)).rejects.toThrow(
        /Pattern must not be empty/,
      );
    });
  });

  it("preserves native literal fallback for unclosed groups", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "call(\n");

      const result = await executeTool(createGrepTool(), { pattern: "(", path: "a.txt" }, fixture);
      expect(textOf(result)).toContain("*1|call(");
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
