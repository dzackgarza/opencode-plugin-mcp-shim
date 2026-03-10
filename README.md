[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I57UKJ8)


# opencode-plugin-mcp-shim

`opencode-plugin-mcp-shim` provides a shared TypeScript helper for invoking plugin tools from FastMCP wrappers.

This package remains internal and exposes no tool names to agents.

## Installation

```bash
cd ./opencode-plugin-mcp-shim
just install
```

## Public Interface

- `executeTool(pluginEntrypoint, toolName, args)`
- `resolvePluginFactory(pluginModule)`
- Command-line interface:

```bash
bun run run-tool.ts /abs/path/to/plugin.ts tool-name '{"arg":"value"}'
```

## Requirements

- Runtime: Bun
- Development: TypeScript, `@types/bun`

## Validation

```bash
just typecheck
just test
```
