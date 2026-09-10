import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const COMPONENTS = path.join(SRC, "components");
const PALETTE = path.join(SRC, "lib", "palette.ts");
const fix = process.argv.includes("--fix");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function linesFor(text, pattern, message) {
  const violations = [];
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${line}: ${message(match)}`);
  }
  return violations;
}

const componentFiles = await sourceFiles(COMPONENTS);
const allFiles = await sourceFiles(SRC);
const violations = [];

for (const file of componentFiles) {
  let text = await readFile(file, "utf8");
  if (fix) {
    const fixed = text.replace(/text-\[(?:\d+(?:\.\d+)?)px\]/g, (token) => {
      const pixels = Number(token.slice(6, -3));
      return pixels < 12 ? "text-xs" : token;
    });
    if (fixed !== text) {
      await writeFile(file, fixed);
      text = fixed;
    }
  }

  const findings = [
    ...linesFor(text, /text-\[(\d+(?:\.\d+)?)px\]/g, (match) =>
      Number(match[1]) < 12 ? `text smaller than 12px: ${match[0]}` : "",
    ).filter((entry) => !entry.endsWith(": ")),
    ...linesFor(
      text,
      /(?:bg|text|border)-(?:red|orange|amber|yellow|green|lime|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/g,
      (match) => `raw Tailwind colour bypasses product tokens: ${match[0]}`,
    ),
    ...linesFor(text, /from\s+["']@\/lib\/mock["']/g, () => "shipped component imports design fixture data"),
    ...linesFor(
      text,
      /(?:[A-Za-z][^\n"'`]* \/ [^\n"'`]*[\u3040-\u30ff\u3400-\u9fff]|[\u3040-\u30ff\u3400-\u9fff][^\n"'`]* \/ [^\n"'`]*[A-Za-z])/g,
      () => "bilingual slash copy bypasses the locale switch",
    ),
  ];
  for (const finding of findings) violations.push(`${relative(file)}:${finding}`);
}

const paletteText = await readFile(PALETTE, "utf8");
const paletteConsumerTexts = await Promise.all(
  allFiles.filter((file) => file !== PALETTE).map((file) => readFile(file, "utf8")),
);
const importedPaletteNames = new Set();
for (const text of paletteConsumerTexts) {
  for (const match of text.matchAll(/import\s*{([^}]*)}\s*from\s*["']@\/lib\/palette["'];/g)) {
    for (const binding of match[1].split(",")) {
      const name = binding.trim().split(/\s+as\s+/)[0];
      if (name) importedPaletteNames.add(name);
    }
  }
}
for (const match of paletteText.matchAll(/export const ([A-Z][A-Z0-9_]*)/g)) {
  const name = match[1];
  if (!importedPaletteNames.has(name)) {
    violations.push(`${relative(PALETTE)}: unused exported palette token ${name}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Design rules passed for ${componentFiles.length} components.`);
}
