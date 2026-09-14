import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MANIFEST = path.resolve(import.meta.dirname, "..", ".next", "app-path-routes-manifest.json");

/** Every URL the production build may emit. Adding a product page means adding a line here. */
const PRODUCT_ROUTES = new Set(["/", "/deliveries/[deliveryId]", "/deliveries/compare"]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function routesFromManifest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${MANIFEST} is not a JSON object of absolute route strings`);
    return null;
  }
  const emitted = new Set();
  for (const raw of Object.values(value)) {
    if (typeof raw !== "string" || !raw.startsWith("/")) {
      fail(`${MANIFEST} has a value that is not an absolute route string: ${JSON.stringify(raw)}`);
      return null;
    }
    if (raw.startsWith("/_")) continue;
    emitted.add(raw);
  }
  return emitted;
}

let raw;
try {
  raw = await readFile(MANIFEST, "utf8");
} catch (error) {
  fail(error && error.code === "ENOENT" ? "run next build first" : String(error));
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail(`${MANIFEST} is not valid JSON`);
  process.exit(1);
}

const emitted = routesFromManifest(parsed);
if (!emitted) process.exit(1);

const unexpected = [...emitted].filter((route) => !PRODUCT_ROUTES.has(route)).sort();
const missing = [...PRODUCT_ROUTES].filter((route) => !emitted.has(route)).sort();

if (unexpected.length > 0 || missing.length > 0) {
  fail("production route table differs from PRODUCT_ROUTES in apps/web/scripts/check-routes.mjs");
  if (unexpected.length > 0) console.error(`  unexpected: ${unexpected.join(", ")}`);
  if (missing.length > 0) console.error(`  missing: ${missing.join(", ")}`);
} else {
  console.log(`Production route table matches ${PRODUCT_ROUTES.size} product routes.`);
}
