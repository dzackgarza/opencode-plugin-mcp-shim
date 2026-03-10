/**
 * Shared tool executor for FastMCP wrappers.
 *
 * Usage: bun run run-tool.ts <plugin-entrypoint> <tool-name> <args-json>
 *
 * Example:
 *   bun run run-tool.ts ../improved-webtools/src/index.ts webfetch '{"url":"https://example.com"}'
 */

import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ToolArgs = Record<string, unknown>;
const MCP_SESSION_ID_ARG = "__mcp_session_id";

type ToolExecutionOutput = {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
};

type PluginHooks = {
  tool?: Record<string, { execute: (args: ToolArgs, context: any) => Promise<unknown> }>;
  "tool.execute.before"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
  }, output: { args: ToolArgs }) => Promise<void>;
  "tool.execute.after"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
    args: ToolArgs;
  }, output: ToolExecutionOutput) => Promise<void>;
};

function resolvePluginEntrypointSpecifier(pluginEntrypoint: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pluginEntrypoint)) {
    return pluginEntrypoint;
  }

  if (
    pluginEntrypoint.startsWith("./") ||
    pluginEntrypoint.startsWith("../") ||
    isAbsolute(pluginEntrypoint)
  ) {
    return pathToFileURL(resolve(pluginEntrypoint)).href;
  }

  return pluginEntrypoint;
}

export function resolvePluginFactory(
  pluginModule: Record<string, any>,
): (...args: any[]) => any {
  for (const [key, value] of Object.entries(pluginModule)) {
    if (key.endsWith("Plugin") && typeof value === "function") {
      return value;
    }
  }

  // Last resort: default export
  if (typeof pluginModule.default === "function") {
    return pluginModule.default;
  }

  throw new Error(
    `No plugin factory found. Tried: *Plugin exports, default. ` +
      `Available exports: ${Object.keys(pluginModule).join(", ")}`,
  );
}

export async function executeTool(
  pluginEntrypoint: string,
  toolName: string,
  args: ToolArgs,
): Promise<string | ToolExecutionOutput> {
  const pluginModule = await import(
    resolvePluginEntrypointSpecifier(pluginEntrypoint),
  );
  const pluginFactory = resolvePluginFactory(pluginModule);
  const sessionID =
    typeof args[MCP_SESSION_ID_ARG] === "string" &&
    (args[MCP_SESSION_ID_ARG] as string).trim().length > 0
      ? (args[MCP_SESSION_ID_ARG] as string).trim()
      : "opencode-plugin-mcp-shim-session";
  const messageID = "opencode-plugin-mcp-shim-message";
  const callID = `opencode-plugin-mcp-shim-${toolName}`;
  const pendingState: Partial<ToolExecutionOutput> = {};

  const client = {
    app: {
      log: (input: unknown) => {
        console.error("LOG:", JSON.stringify(input, null, 2));
      },
    },
  };

  const context = {
    sessionID,
    messageID,
    agent: "fastmcp",
    directory: process.cwd(),
    worktree: process.cwd(),
    ask: async (_input: {
      permission: string;
      patterns: string[];
      always: string[];
      metadata?: Record<string, unknown>;
    }) => ({ granted: true }),
    metadata: (meta: {
      title?: string;
      metadata?: Record<string, unknown>;
    }) => {
      pendingState.title = meta.title ?? pendingState.title;
      pendingState.metadata = {
        ...(pendingState.metadata ?? {}),
        ...(meta.metadata ?? {}),
      };
    },
    abort: new AbortController().signal,
  };

  const plugin = (await pluginFactory({ client } as any)) as PluginHooks;

  const toolHooksInput = { tool: toolName, sessionID, callID };
  const hookedArgs = { ...args };
  delete hookedArgs[MCP_SESSION_ID_ARG];
  await plugin["tool.execute.before"]?.(toolHooksInput, { args: hookedArgs });

  const tools = plugin.tool ?? {};
  const tool = tools[toolName as keyof typeof tools];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);

  const rawResult = await tool.execute(hookedArgs, context);
  if (typeof rawResult !== "string") return rawResult as ToolExecutionOutput;

  const result: ToolExecutionOutput = {
    title: pendingState.title ?? "",
    output: rawResult,
    metadata: pendingState.metadata ?? {},
  };
  await plugin["tool.execute.after"]?.(
    { ...toolHooksInput, args: hookedArgs },
    result,
  );

  if (!result.title && Object.keys(result.metadata).length === 0) {
    return result.output;
  }

  return result;
}

export function renderToolResult(result: string | ToolExecutionOutput): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

// Main entry point
async function main() {
  const [, , pluginEntrypoint, toolName, argsJson] = process.argv;

  if (!pluginEntrypoint || !toolName || !argsJson) {
    console.error(
      "Usage: bun run run-tool.ts <plugin-entrypoint> <tool-name> <args-json>",
    );
    process.exit(1);
  }

  try {
    const args = JSON.parse(argsJson) as ToolArgs;
    const result = await executeTool(pluginEntrypoint, toolName, args);
    console.log(renderToolResult(result));
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

// Only run as CLI entry point when invoked directly
if (import.meta.main) {
  main();
}
