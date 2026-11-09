// Resolve from this file, so MCP can launch regardless of the caller's cwd.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
process.env.ECC_MEMORY_HARNESS ||= 'pomich';
process.env.ECC_MEMORY_PROJECT_ROOT = join(root, '.ecc/memory');
const { runStdioServer } = await import(pathToFileURL(join(root, 'tools/ecc/scripts/memory-mcp.mjs')).href);
runStdioServer();
