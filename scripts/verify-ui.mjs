#!/usr/bin/env node
// Dispatcher for the browser verifier scenarios. Each scenario lives in its
// own file so the delivery shelf, the findings review, and the delivery
// comparison verify independently:
// --scenario deliveries runs verify-ui-deliveries.mjs (ticket 10),
// --scenario findings runs verify-ui-findings.mjs (ticket 11),
// --scenario comparisons runs verify-ui-comparisons.mjs (ticket 15).
// --scenario all runs deliveries, then findings, then comparisons via the
// same spawnSync dispatch and stops on the first nonzero exit.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const TARGETS = {
  deliveries: "verify-ui-deliveries.mjs",
  findings: "verify-ui-findings.mjs",
  comparisons: "verify-ui-comparisons.mjs",
};
const ALL_SCENARIOS = ["deliveries", "findings", "comparisons"];

const flagIndex = process.argv.indexOf("--scenario");
const scenario = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
if (scenario !== "all" && !TARGETS[scenario]) {
  console.error(
    `usage: node scripts/verify-ui.mjs --scenario deliveries|findings|comparisons|all (got ${scenario ?? "<none>"})`,
  );
  process.exit(2);
}

/** Same argv as the caller, minus the `--scenario` flag pair, so each child
 * gets the scenario flag for its own name. */
const forwarded = [...process.argv.slice(2)];
if (flagIndex >= 0) forwarded.splice(flagIndex - 2 >= 0 ? flagIndex - 2 : 0, 2);

function dispatch(scenarioName) {
  const result = spawnSync(process.execPath, [join(root, TARGETS[scenarioName]), ...forwarded, "--scenario", scenarioName], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}

if (scenario === "all") {
  for (const name of ALL_SCENARIOS) {
    const status = dispatch(name);
    if (status !== 0) process.exit(status);
  }
  process.exit(0);
}
process.exit(dispatch(scenario));
