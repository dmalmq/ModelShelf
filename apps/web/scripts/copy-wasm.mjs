// web-ifc ships its WASM inside the package; Next serves it from /wasm/.
import { copyFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

const pkgDir = join(process.cwd(), "node_modules", "web-ifc");
const out = join(process.cwd(), "public", "wasm");

try {
  await access(pkgDir);
} catch {
  console.warn("[copy-wasm] web-ifc not installed yet; skipping");
  process.exit(0);
}

await mkdir(out, { recursive: true });
for (const file of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  try {
    await copyFile(join(pkgDir, file), join(out, file));
    console.log(`[copy-wasm] ${file}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
