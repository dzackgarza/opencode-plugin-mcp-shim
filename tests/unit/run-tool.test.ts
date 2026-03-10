import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeTool, resolvePluginFactory } from "../../run-tool.ts";

// ---------------------------------------------------------------------------
// Stub plugin factory
// ---------------------------------------------------------------------------

const STUB_RESULT = "stub-tool-result-ok";

async function writeStubPlugin(dir: string): Promise<string> {
  const path = join(dir, "stub-plugin.ts");
  await writeFile(
    path,
    `
export const StubPlugin = async () => ({
  tool: {
    "stub-tool": {
      execute: async (_args: Record<string, unknown>) =>
        ${JSON.stringify(STUB_RESULT)},
    },
  },
});
`,
  );
  return path;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
let stubPluginPath: string;

// We can't use beforeAll with async in bun:test at top level cleanly,
// so we create the dir once via a helper and reuse it across tests.
async function getStubPath(): Promise<string> {
  if (stubPluginPath) return stubPluginPath;
  tmpDir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-test-"));
  stubPluginPath = await writeStubPlugin(tmpDir);
  return stubPluginPath;
}

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolvePluginFactory
// ---------------------------------------------------------------------------

describe("resolvePluginFactory", () => {
  it("finds a *Plugin named export", () => {
    const factory = () => ({ tool: {} });
    const mod = { SomePlugin: factory, otherExport: 42 };
    expect(resolvePluginFactory(mod)).toBe(factory);
  });

  it("falls back to default export if no *Plugin export", () => {
    const factory = () => ({ tool: {} });
    const mod = { default: factory, helper: "irrelevant" };
    expect(resolvePluginFactory(mod)).toBe(factory);
  });

  it("prefers *Plugin over default when both present", () => {
    const namedFactory = () => ({ tool: {} });
    const defaultFactory = () => ({ tool: {} });
    const mod = { MyPlugin: namedFactory, default: defaultFactory };
    expect(resolvePluginFactory(mod)).toBe(namedFactory);
  });

  it("throws when no *Plugin export and no default", () => {
    expect(() => resolvePluginFactory({ notAPlugin: 42 })).toThrow(
      /No plugin factory found/,
    );
  });

  it("throws and lists available exports in error message", () => {
    const mod = { foo: 1, bar: 2 };
    expect(() => resolvePluginFactory(mod)).toThrow(/foo.*bar|bar.*foo/);
  });
});

// ---------------------------------------------------------------------------
// executeTool
// ---------------------------------------------------------------------------

describe("executeTool", () => {
  it("invokes the correct tool and returns its output", async () => {
    const path = await getStubPath();
    const result = await executeTool(path, "stub-tool", {});
    expect(result).toBe(STUB_RESULT);
  });

  it("passes args through to the tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-args-"));
    const p = join(dir, "args-plugin.ts");
    await writeFile(
      p,
      `export const ArgsPlugin = async () => ({
  tool: {
    echo: {
      execute: async (args: Record<string, unknown>) => JSON.stringify(args),
    },
  },
});`,
    );
    const result = await executeTool(p, "echo", { x: 1, y: "hello" });
    if (typeof result !== "string") {
      throw new Error("echo tool should return a plain string result");
    }
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ x: 1, y: "hello" });
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a default-export plugin from a real file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-default-export-"));
    const p = join(dir, "default-plugin.ts");
    await writeFile(
      p,
      `export default async function DefaultPlugin() {
  return {
    tool: {
      echo: {
        async execute() {
          return "default-export-ok";
        },
      },
    },
  };
}`,
    );
    const result = await executeTool(p, "echo", {});
    expect(result).toBe("default-export-ok");
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves relative plugin paths from the current working directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-relative-"));
    const p = join(dir, "relative-plugin.ts");
    await writeFile(
      p,
      `export async function RelativePlugin() {
  return {
    tool: {
      echo: {
        async execute() {
          return "relative-path-ok";
        },
      },
    },
  };
}`,
    );
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await executeTool("./relative-plugin.ts", "echo", {});
      expect(result).toBe("relative-path-ok");
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on unknown tool name", async () => {
    const path = await getStubPath();
    await expect(executeTool(path, "nonexistent-tool", {})).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("applies plugin tool hooks and preserves structured output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-hooks-"));
    const p = join(dir, "hooked-plugin.ts");
    await writeFile(
      p,
      `export const HookedPlugin = async () => ({
  tool: {
    todowrite: {
      execute: async () => JSON.stringify([{ content: "test", status: "pending", priority: "high" }]),
    },
  },
  "tool.execute.after": async (input, output) => {
    if (input.tool !== "todowrite") return;
    output.title = "1 todos";
    output.metadata = {
      todos: [{ content: "test", status: "pending", priority: "high" }],
    };
  },
});`,
    );
    const result = await executeTool(p, "todowrite", {});
    expect(result).toEqual({
      title: "1 todos",
      output: JSON.stringify(
        [{ content: "test", status: "pending", priority: "high" }],
        null,
        0,
      ),
      metadata: {
        todos: [{ content: "test", status: "pending", priority: "high" }],
      },
    });
    await rm(dir, { recursive: true, force: true });
  });
});

describe("run-tool CLI", () => {
  it("prints default-export plugin output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-plugin-mcp-shim-cli-"));
    const p = join(dir, "cli-plugin.ts");
    await writeFile(
      p,
      `export default async function CliPlugin() {
  return {
    tool: {
      echo: {
        async execute(args) {
          return JSON.stringify(args);
        },
      },
    },
  };
}`,
    );
    const result = spawnSync(
      "bun",
      [
        "run",
        "./opencode-plugin-mcp-shim/run-tool.ts",
        "./cli-plugin.ts",
        "echo",
        '{"ok":true}',
      ],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"ok":true}');
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a non-zero exit code for a missing plugin file", () => {
    const result = spawnSync(
      "bun",
      [
        "run",
        "./opencode-plugin-mcp-shim/run-tool.ts",
        "./missing-plugin.ts",
        "echo",
        "{}",
      ],
      {
        cwd: tmpdir(),
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Error:");
  });
});
