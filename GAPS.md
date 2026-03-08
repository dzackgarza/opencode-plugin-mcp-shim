# GAPS — mcp-shim

## Known Gaps

### CLI entry point smoke-tested but not in automated tests

`run-tool.ts` is both a library (exports `executeTool`, `resolvePluginFactory`) and a CLI
entry point (runs `main()` when invoked directly via `bun run run-tool.ts ...`). The unit
tests exercise the library surface; the CLI path is confirmed working manually:

```bash
bun run run-tool.ts ../improved-webtools/src/index.ts webfetch '{"url":"https://example.com"}'
# Output: Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2  ✅
```

`process.argv` parsing, stdout printing, and non-zero exit codes on error are not covered
by automated tests.

### Plugin path resolution is not tested with relative paths

`executeTool` calls `await import(pluginEntrypoint)`. This works with absolute paths but
may silently fail or resolve incorrectly for relative paths depending on working directory.
The unit tests use absolute paths via `tmp`. No test covers relative-path behavior.

### No test for default export fallback with a real plugin file

`resolvePluginFactory` has a default-export fallback branch. The unit tests cover it with
an inline mock object but do not write a stub file that uses `export default`. If a plugin
ever ships a default export factory, the file-level import path has not been exercised.

### Error on missing plugin entrypoint is not tested

If the plugin path does not exist, `import()` throws. No test covers this path or verifies
that the error message is human-readable.
