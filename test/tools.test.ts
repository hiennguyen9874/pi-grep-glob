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
  it("publishes recursive-path guidance", () => {
    const tool = createGlobTool();

    expect(tool.promptGuidelines).toEqual([
      "Use glob with limit=50 or less when exploring a broad or unfamiliar path. A plain directory path is recursive; use dir/* to inspect one level and narrow the glob before increasing the limit.",
      "Do not use glob to enumerate dataset, generated, dependency, build, or cache trees unless the task requires them; use grep directly with a narrow path/glob for content search.",
      "Keep glob gitignore=true unless ignored files are explicitly required.",
    ]);
    expect((tool.parameters.properties.path as any).description).toContain("searched recursively");
  });

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
      for (let index = 0; index < 55; index += 1) {
        await writeFile(join(fixture, `file-${index}.ts`), "file\n");
      }

      const limited = await executeTool(createGlobTool(), { path: "*.ts", limit: 2, gitignore: false }, fixture);
      expect(textOf(limited).split("\n").filter((line) => line && !line.startsWith("[")).length).toBe(2);
      expect(textOf(limited)).toContain("[More matches omitted. Narrow path/glob or increase limit.]");
      expect(limited.details?.limit).toBe(2);
      expect(limited.details?.returnedMatches).toBe(2);
      expect(limited.details?.limitReached).toBe(true);
      expect(limited.details?.resultLimitReached).toBe(true);
      expect(limited.details?.scanLimitReached).toBe(false);

      const defaulted = await executeTool(createGlobTool(), { path: "*.ts", gitignore: false }, fixture);
      expect(defaulted.details?.limit).toBe(50);
      expect(defaulted.details?.returnedMatches).toBe(50);
      expect(textOf(defaulted)).toContain("[More matches omitted. Narrow path/glob or increase limit.]");

      const clamped = await executeTool(createGlobTool(), { path: "*.ts", limit: 5000, gitignore: false }, fixture);
      expect(clamped.details?.limit).toBe(1000);
    });
  });

  it("continues past duplicate glob roots before applying the global limit", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "one"));
      await mkdir(join(fixture, "two"));
      for (const name of ["a.ts", "b.ts", "c.ts"]) {
        await writeFile(join(fixture, "one", name), name);
      }
      await writeFile(join(fixture, "two", "d.ts"), "d.ts\n");

      const result = await executeTool(
        createGlobTool(),
        { path: "one one two", limit: 4, gitignore: false },
        fixture,
      );

      expect(textOf(result).split("\n").sort()).toEqual(["one/a.ts", "one/b.ts", "one/c.ts", "two/d.ts"]);
      expect(result.details?.resultLimitReached).toBe(false);
    });
  });

  it("applies root-relative and nested excludes before traversal", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "dataset", "nested"), { recursive: true });
      await mkdir(join(fixture, "src", "generated"), { recursive: true });
      await writeFile(join(fixture, "dataset", "nested", "drop.ts"), "drop\n");
      await writeFile(join(fixture, "src", "generated", "drop.ts"), "drop\n");
      await writeFile(join(fixture, "keep.ts"), "keep\n");

      const result = await executeTool(
        createGlobTool(),
        { path: ".", exclude: ["dataset/**", "**/generated/**"], gitignore: false },
        fixture,
      );

      expect(textOf(result)).toContain("keep.ts");
      expect(textOf(result)).not.toContain("dataset");
      expect(textOf(result)).not.toContain("generated");
      expect(result.details?.scanLimit).toBe(50_000);
    });
  });

  it("applies excludes relative to every path-list root", async () => {
    await withFixture(async (fixture) => {
      for (const root of ["one", "two"]) {
        await mkdir(join(fixture, root, "nested"), { recursive: true });
        await writeFile(join(fixture, root, "keep.ts"), "keep\n");
        await writeFile(join(fixture, root, "nested", "drop.ts"), "drop\n");
      }

      const result = await executeTool(
        createGlobTool(),
        { path: "one two", exclude: ["nested/**"], gitignore: false },
        fixture,
      );

      expect(textOf(result).split("\n").sort()).toEqual(["one/keep.ts", "two/keep.ts"]);
    });
  });

  it("prunes excluded directories and keeps gitignore independent", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "dataset", "nested"), { recursive: true });
      await writeFile(join(fixture, "dataset", "nested", "drop.ts"), "drop\n");
      await writeFile(join(fixture, "keep.ts"), "keep\n");
      await writeFile(join(fixture, "ignored.ts"), "ignored\n");
      await writeFile(join(fixture, ".gitignore"), "ignored.ts\n");

      const baseline = await executeTool(createGlobTool(), { path: ".", gitignore: false }, fixture);
      const excluded = await executeTool(
        createGlobTool(),
        { path: ".", exclude: ["dataset/**"], gitignore: false },
        fixture,
      );

      expect(excluded.details?.scannedEntries).toBeLessThan(baseline.details?.scannedEntries ?? 0);
      expect(textOf(excluded)).toContain("keep.ts");
      expect(textOf(excluded)).not.toContain("dataset");
      expect(textOf(excluded)).toContain("ignored.ts");

      const ignored = await executeTool(
        createGlobTool(),
        { path: ".", exclude: ["dataset/**"], gitignore: true },
        fixture,
      );
      expect(textOf(ignored)).not.toContain("ignored.ts");
    });
  });

  it("allows explicit file operands to override excludes and reports invalid patterns", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "dataset"));
      await writeFile(join(fixture, "dataset", "index.json"), "index\n");

      const explicit = await executeTool(
        createGlobTool(),
        { path: "dataset/index.json", exclude: ["dataset/**"], gitignore: false },
        fixture,
      );
      expect(textOf(explicit)).toBe("dataset/index.json");
      expect(explicit.details?.scannedEntries).toBe(0);

      await expect(
        executeTool(
          createGlobTool(),
          { path: "dataset/index.json", exclude: ["[broken"], gitignore: false },
          fixture,
        ),
      ).rejects.toThrow(/\[broken/);
    });
  });

  it("uses one scan budget across path-list roots", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "one"));
      await mkdir(join(fixture, "two"));
      await writeFile(join(fixture, "one", "one.ts"), "one\n");
      await writeFile(join(fixture, "two", "two.ts"), "two\n");

      const result = await executeTool(
        createGlobTool(),
        { path: "one two", scanLimit: 1, gitignore: false },
        fixture,
      );

      expect(result.details?.scanLimit).toBe(1);
      expect(result.details?.scannedEntries).toBe(1);
      expect(result.details?.scanLimitReached).toBe(true);
      expect(result.details?.resultLimitReached).toBe(false);
      expect(result.details?.limitReached).toBe(true);
      expect(textOf(result)).toContain(
        "[Search stopped after scanning 1 entries. Results may be incomplete; narrow the path/glob or add exclude patterns.]",
      );

      const clamped = await executeTool(createGlobTool(), { path: "one", scanLimit: 5_000_000 }, fixture);
      expect(clamped.details?.scanLimit).toBe(1_000_000);
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
      expect(result.details?.resultLimitReached).toBe(true);
      expect(result.details?.scanLimitReached).toBe(false);
      expect(result.details?.maxMatchesPerFile).toBe(2);
      expect(textOf(result)).toContain("[More matches omitted. Narrow path/glob or increase limit.]");
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

  it("applies root-relative and nested excludes without counting excluded files", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "dataset", "nested"), { recursive: true });
      await mkdir(join(fixture, "src", "generated"), { recursive: true });
      await writeFile(join(fixture, "dataset", "nested", "drop.txt"), "needle\n");
      await writeFile(join(fixture, "src", "generated", "drop.txt"), "needle\n");
      await writeFile(join(fixture, "keep.txt"), "needle\n");

      const baseline = await executeTool(createGrepTool(), { pattern: "needle", path: ".", gitignore: false }, fixture);
      const excluded = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: ".", exclude: ["dataset/**", "**/generated/**"], gitignore: false },
        fixture,
      );

      expect(textOf(excluded)).toContain("keep.txt");
      expect(textOf(excluded)).not.toContain("dataset");
      expect(textOf(excluded)).not.toContain("generated");
      expect(excluded.details?.filesSearched).toBe(1);
      expect(excluded.details?.scannedEntries).toBeLessThan(baseline.details?.scannedEntries ?? 0);
    });
  });

  it("applies excludes relative to every path-list root", async () => {
    await withFixture(async (fixture) => {
      for (const root of ["one", "two"]) {
        await mkdir(join(fixture, root, "nested"), { recursive: true });
        await writeFile(join(fixture, root, "keep.txt"), "needle\n");
        await writeFile(join(fixture, root, "nested", "drop.txt"), "needle\n");
      }

      const result = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: "one two", exclude: ["nested/**"], gitignore: false },
        fixture,
      );

      expect(textOf(result)).toContain("one/keep.txt");
      expect(textOf(result)).toContain("two/keep.txt");
      expect(textOf(result)).not.toContain("nested/drop.txt");
    });
  });

  it("keeps explicit excludes active when gitignore is disabled", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, ".gitignore"), "ignored.txt\n");
      await writeFile(join(fixture, "ignored.txt"), "needle\n");
      await writeFile(join(fixture, "excluded.txt"), "needle\n");
      await writeFile(join(fixture, "kept.txt"), "needle\n");

      const result = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: "*.txt", exclude: ["excluded.txt"], gitignore: false },
        fixture,
      );

      expect(textOf(result)).toContain("ignored.txt");
      expect(textOf(result)).not.toContain("excluded.txt");
      expect(textOf(result)).toContain("kept.txt");
    });
  });

  it("allows explicit file operands to override excludes and reports invalid patterns", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "dataset"));
      await writeFile(join(fixture, "dataset", "index.txt"), "needle\n");

      const explicit = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: "dataset/index.txt", exclude: ["dataset/**"], gitignore: false },
        fixture,
      );
      expect(textOf(explicit)).toContain("dataset/index.txt");
      expect(explicit.details?.scannedEntries).toBe(0);

      await expect(
        executeTool(createGrepTool(), { pattern: "needle", path: ".", exclude: ["[broken"], gitignore: false }, fixture),
      ).rejects.toThrow(/\[broken/);
    });
  });

  it("uses one scan budget across path-list roots", async () => {
    await withFixture(async (fixture) => {
      await mkdir(join(fixture, "one"));
      await mkdir(join(fixture, "two"));
      await writeFile(join(fixture, "one", "one.txt"), "needle\n");
      await writeFile(join(fixture, "two", "two.txt"), "needle\n");

      const result = await executeTool(
        createGrepTool(),
        { pattern: "needle", path: "one two", scanLimit: 1, gitignore: false },
        fixture,
      );

      expect(result.details?.scanLimit).toBe(1);
      expect(result.details?.scannedEntries).toBe(1);
      expect(result.details?.scanLimitReached).toBe(true);
      expect(result.details?.resultLimitReached).toBe(false);
      expect(result.details?.nativeLimitReached).toBe(false);
      expect(result.details?.limitReached).toBe(true);
      expect(textOf(result)).toContain(
        "[Search stopped after scanning 1 entries. Results may be incomplete; narrow the path/glob or add exclude patterns.]",
      );

      const clamped = await executeTool(createGrepTool(), { pattern: "needle", path: "one", scanLimit: 5_000_000 }, fixture);
      expect(clamped.details?.scanLimit).toBe(1_000_000);
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
      expect(firstPage.details?.returnedFiles).toBe(10);
      expect(textOf(firstPage)).toContain("[15 more files with matches omitted. Use skip to view more.]");

      const middlePage = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", skip: 10 }, fixture);
      expect(middlePage.details?.filesWithMatches).toBe(25);
      expect(middlePage.details?.returnedFiles).toBe(10);
      expect(textOf(middlePage)).toContain("[5 more files with matches omitted. Use skip to view more.]");

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

  it("renders at most ten matches per file without reducing native collection", async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture, "a.txt"), "needle\n".repeat(15));

      const result = await executeTool(createGrepTool(), { pattern: "needle", path: "a.txt", gitignore: false }, fixture);
      const renderedMatches = textOf(result).split("\n").filter((line) => line.startsWith("*"));

      expect(result.details?.totalMatches).toBe(15);
      expect(result.details?.maxRenderedMatchesPerFile).toBe(10);
      expect(renderedMatches).toHaveLength(10);
      expect(textOf(result)).toContain("[More matches omitted. Narrow path/glob or increase limit.]");
    });
  });

  it("truncates long output", async () => {
    await withFixture(async (fixture) => {
      const longNeedleLine = `${"x".repeat(600)} needle\n`;
      for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
        await writeFile(join(fixture, `file-${fileIndex.toString().padStart(2, "0")}.txt`), longNeedleLine.repeat(20));
      }

      const result = await executeTool(createGrepTool(), { pattern: "needle", path: "*.txt", gitignore: false }, fixture);

      const text = textOf(result);
      expect(result.details?.truncation?.truncated).toBe(true);
      expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(16 * 1024);
      expect(text.split("\n").length).toBeLessThanOrEqual(300);
      expect(text).toContain("[10 more files with matches omitted. Use skip to view more.]");
      expect(text).toContain("[More matches omitted. Narrow path/glob or increase limit.]");
      expect(text).toContain("[Output truncated:");
    });
  });
});
