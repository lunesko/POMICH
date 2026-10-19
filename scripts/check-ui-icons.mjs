import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../", import.meta.url))
// Copyright and trademark characters are prose, not pictograms used as icons.
const pictogram = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3\u2713\u2714\u2715\u2716\u2605\u2606\u2630\u25CB\u25CF\u203A\u2039]/u
const standaloneArrow = /^[\s\u2190-\u2193]+$/u
export function containsTextIcon(text) {
  const prose = text.replace(/[©®™]/gu, "")
  return pictogram.test(prose) || (prose.trim() !== "" && standaloneArrow.test(prose))
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name)
    return entry.isDirectory() ? filesIn(name) : [name]
  })
}

const problems = []
for (const file of filesIn(path.join(root, "src"))) {
  if (/\.(test|spec)\./u.test(file) || file.includes(`${path.sep}test${path.sep}`)) continue
  const source = fs.readFileSync(file, "utf8")
  if (/\.(tsx?|jsx?)$/u.test(file)) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && containsTextIcon(node.text)) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree))
        problems.push(`${path.relative(root, file)}:${line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  } else if (file.endsWith(".css")) {
    if (containsTextIcon(source.replace(/\/\*[\s\S]*?\*\//gu, ""))) problems.push(path.relative(root, file))
  }
}
// Telegram plain text cannot display SVG. Keep our message templates text-only.
for (const file of filesIn(path.join(root, "bot")).filter((name) => name.endsWith(".py"))) {
  const source = fs.readFileSync(file, "utf8")
  if (containsTextIcon(source)) problems.push(path.relative(root, file))
}
if (problems.length) {
  console.error("Use shared SVG icons instead of emoji or text glyphs:\n" + problems.join("\n"))
  process.exitCode = 1
} else {
  console.log("UI icon check passed: no emoji or text icon glyphs in application templates.")
}
