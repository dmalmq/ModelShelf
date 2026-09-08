#!/usr/bin/env node
// Dispatcher for the browser verifier scenarios. Each scenario lives in its
// own file so the delivery shelf and the findings review verify independently:
// --scenario deliveries runs verify-ui-deliveries.mjs (ticket 10),
// --scenario findings runs verify-ui-findings.mjs (ticket 11).

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const flagIndex = process.argv.indexOf("--scenario");
const scenario = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
const target =
  scenario === "findings"
    ? "verify-ui-findings.mjs"
    : scenario === "deliveries"
      ? "verify-ui-deliveries.mjs"
      : null;
if (!target) {
  console.error(
    `usage: node scripts/verify-ui.mjs --scenario findings|deliveries (got ${scenario ?? "<none>"})`,
  );
  process.exit(2);
}
const result = spawnSync(process.execPath, [join(root, target), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
