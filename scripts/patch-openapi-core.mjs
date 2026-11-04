import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const packagePath = require.resolve("@redocly/openapi-core/package.json")
const core = JSON.parse(readFileSync(packagePath, "utf8"))
if (core.version !== "1.34.22") {
  throw new Error(`Review minimatch compatibility for @redocly/openapi-core ${core.version}`)
}

const utilsPath = require.resolve("@redocly/openapi-core/lib/utils.js")
const source = readFileSync(utilsPath, "utf8")
const oldImport = 'const minimatch = require("minimatch");'
const newImport = 'const { minimatch } = require("minimatch");'
if (source.includes(newImport)) process.exit(0)
if (!source.includes(oldImport)) throw new Error("Redocly minimatch import changed; review the compatibility patch")
writeFileSync(utilsPath, source.replace(oldImport, newImport))
