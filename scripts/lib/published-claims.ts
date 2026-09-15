import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export type VerifierRow = {
  readonly command: string;
  readonly purpose: string;
  readonly dispatcher?: "api" | "ui" | "viewer";
  readonly scenario?: string;
  readonly inAll?: boolean;
};

export type Check11Pin = {
  readonly correction: "62 ducts, 45 pipes, and 43 cable trays";
  readonly stale: "every one was a cable-tray-family segment";
  readonly ducts: 62;
  readonly pipes: 45;
  readonly trays: 43;
  readonly v1Fail: 150;
};

export type Proof = {
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
};

export const CHECK11: Check11Pin = {
  correction: "62 ducts, 45 pipes, and 43 cable trays",
  stale: "every one was a cable-tray-family segment",
  ducts: 62,
  pipes: 45,
  trays: 43,
  v1Fail: 150,
};

if (CHECK11.ducts + CHECK11.pipes + CHECK11.trays !== CHECK11.v1Fail) {
  throw new Error(
    `Check11Pin arithmetic: ${CHECK11.ducts} + ${CHECK11.pipes} + ${CHECK11.trays} !== ${CHECK11.v1Fail}`,
  );
}

export const FORBIDDEN_PHRASES = [
  "(later) an IfcOpenShell/IfcTester worker",
  "there is no viewer page to test",
  "No checker or application has been built",
] as const;

export const REFERENCE_ONLY_NEEDLE = "not an approved national architectural validation pack";

export const EVIDENCE_KEYS: readonly string[] = [
  "07-combined-viewer",
  "08-finding-inspection",
  "11-priority-review",
  "19-extract-viewer/standalone",
  "review-decisions",
  "task-10",
  "task-2",
  "task-6",
  "task-9",
  "ticket-13",
  "ticket-14",
  "ticket-15",
  "ticket-16",
  "ticket-31",
];

export const VERIFIER_ROWS: readonly VerifierRow[] = [
  {
    command: "node scripts/qa-harness.ts",
    purpose: "Build, idempotent seed, health/projects/packs, unknown CLI, temp data dir",
  },
  {
    command: "node scripts/verify-api.ts --scenario revisions",
    purpose: "Source-model / revision / delivery data model",
    dispatcher: "api",
    scenario: "revisions",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario worker-failure",
    purpose: "Job queue contract",
    dispatcher: "api",
    scenario: "worker-failure",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario checks",
    purpose: "Scoped IfcTester on pinned inputs",
    dispatcher: "api",
    scenario: "checks",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario first-loop",
    purpose: "Full review loop",
    dispatcher: "api",
    scenario: "first-loop",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario comparisons",
    purpose: "Revision comparison match confidence",
    dispatcher: "api",
    scenario: "comparisons",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario finding-comparisons",
    purpose: "Finding diffs gated on compatible settings",
    dispatcher: "api",
    scenario: "finding-comparisons",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario restart",
    purpose: "Restart durability",
    dispatcher: "api",
    scenario: "restart",
    inAll: true,
  },
  {
    command: "node scripts/verify-api.ts --scenario all",
    purpose: "The seven SCENARIOS in order. Not decisions.",
    dispatcher: "api",
    scenario: "all",
  },
  {
    command: "node scripts/verify-api.ts --scenario decisions",
    purpose: "Extra name accepted by requireScenario. Not in SCENARIOS.",
    dispatcher: "api",
    scenario: "decisions",
    inAll: false,
  },
  {
    command: "node scripts/verify-api.ts --scenario snowdon",
    purpose: "Snowdon four-discipline delivery scored against its own pack",
    dispatcher: "api",
    scenario: "snowdon",
    inAll: false,
  },
  {
    command: "node scripts/verify-viewer.ts",
    purpose: "Combined delivery viewer",
    dispatcher: "viewer",
    scenario: "combined",
  },
  {
    command: "node scripts/verify-viewer.ts --scenario inspection",
    purpose: "Finding inspection plus Wave-1 gates",
    dispatcher: "viewer",
    scenario: "inspection",
  },
  {
    command: "node scripts/verify-viewer.ts --scenario standalone",
    purpose: "Extracted viewer package example",
    dispatcher: "viewer",
    scenario: "standalone",
  },
  {
    command: "node scripts/verify-viewer.ts --scenario snowdon",
    purpose: "Snowdon four-model viewer with one shared origin offset",
    dispatcher: "viewer",
    scenario: "snowdon",
  },
  {
    command: "node scripts/verify-ui.ts --scenario deliveries",
    purpose: "Delivery shelf",
    dispatcher: "ui",
    scenario: "deliveries",
    inAll: true,
  },
  {
    command: "node scripts/verify-ui.ts --scenario findings",
    purpose: "Prioritized findings",
    dispatcher: "ui",
    scenario: "findings",
    inAll: true,
  },
  {
    command: "node scripts/verify-ui.ts --scenario comparisons",
    purpose: "Delivery comparison screen",
    dispatcher: "ui",
    scenario: "comparisons",
    inAll: true,
  },
  {
    command: "node scripts/verify-ui.ts --scenario all",
    purpose: "deliveries then findings then comparisons",
    dispatcher: "ui",
    scenario: "all",
  },
  {
    command: "uv run --project services/ifc-worker python scripts/check-demo-oracle.py",
    purpose: "Oracle vs IfcTester",
  },
  {
    command: "node scripts/verify-named-proof.ts",
    purpose: "NamedProof fail labels",
  },
  {
    command: "node scripts/generate-model-contracts.ts --check",
    purpose: "Fail if committed bindings have drifted",
  },
  {
    command: "node scripts/verify-model-contracts.ts",
    purpose: "Cross-language fixture, round-trip, and import-boundary proof",
  },
  {
    command: "node scripts/verify-worker-envelope.ts --check",
    purpose: "Worker job envelope dump-lock",
  },
  {
    command: "node scripts/check-published-tree.ts",
    purpose: "Tracked-tree bans; currently red on pre-existing apps/web/scripts/check-routes.mjs",
  },
  {
    command: "node scripts/check-published-claims.ts",
    purpose: "Join README verifier rows to live dispatchers",
  },
  {
    command: "cargo test --workspace",
    purpose: "Workspace unit and integration tests",
  },
];

export function parseNamedStringArray(source: string, constName: string): string[] | null {
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

export function hasDecisionsExtraAccept(source: string): boolean {
  return /scenario !== "decisions"/.test(source);
}

export function parseViewerUsageNames(source: string): string[] | null {
  const match = source.match(/combined\|inspection\|standalone/);
  if (!match) return null;
  return match[0].split("|");
}

export function parseBrowserVerifierKeys(source: string): string[] | null {
  const match = source.match(/export const BROWSER_VERIFIERS = \{([\s\S]*?)\n\} as const;/);
  if (!match) return null;
  const body = match[1];
  const keys: string[] = [];
  for (const joined of body.matchAll(/join\("([^"]+)",\s*"([^"]+)"\)/g)) {
    keys.push(`${joined[1]}/${joined[2]}`);
  }
  for (const literal of body.matchAll(/:\s*"([^"]+)"/g)) {
    keys.push(literal[1]);
  }
  return unique(keys);
}

export function parseScenarioEvidenceKeys(source: string): string[] | null {
  const match = source.match(/function scenarioEvidenceDir\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (!match) return null;
  const body = match[1];
  const keys = [...body.matchAll(/\?\s*"([^"]+)"/g)].map((item) => item[1]);
  const fallback = body.match(/:\s*"([^"]+)"\s*;\s*$/m);
  if (fallback) keys.push(fallback[1]);
  return unique(keys);
}

export function commandOccurrences(text: string, command: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(command, from);
    if (index < 0) break;
    const after = text.slice(index + command.length);
    if (!/^\s+--/.test(after) && !/^[A-Za-z0-9_./-]/.test(after)) {
      indexes.push(index);
    }
    from = index + 1;
  }
  return indexes;
}

export function purposeNearCommand(text: string, command: string, purpose: string): boolean {
  for (const index of commandOccurrences(text, command)) {
    const start = Math.max(0, index - 80);
    const end = Math.min(text.length, index + command.length + 400);
    if (text.slice(start, end).includes(purpose)) return true;
  }
  return false;
}

export function provePublishedClaims(root: string): Proof[] {
  const readme = readRepoFile(root, "README.md");
  const bimChecking = readRepoFile(root, "references/bim-checking/README.md");
  const apiSource = readRepoFile(root, "scripts/verify-api.ts");
  const uiSource = readRepoFile(root, "scripts/verify-ui.ts");
  const viewerSource = readRepoFile(root, "scripts/verify-viewer.ts");
  const browserSource = readRepoFile(root, "scripts/lib/browser-proof.ts");
  const checksMd = readRepoFile(root, "packs/demo/checks.md");
  const ids = readRepoFile(root, "packs/demo/blcj-s1000-v2.ids");

  const proofs: Proof[] = [];
  const selfRow = VERIFIER_ROWS.some((row) => row.command === "node scripts/check-published-claims.ts");
  proofs.push({ label: "self-row node scripts/check-published-claims.ts", ok: selfRow });

  for (const row of VERIFIER_ROWS) {
    const found = commandOccurrences(readme, row.command).length > 0;
    proofs.push({
      label: `README command ${row.command}`,
      ok: found,
      detail: found ? undefined : "missing",
    });
    const near = purposeNearCommand(readme, row.command, row.purpose);
    proofs.push({
      label: `README purpose near ${row.command}`,
      ok: near,
      detail: near ? undefined : `missing ${JSON.stringify(row.purpose)}`,
    });
  }

  const apiScenarios = parseNamedStringArray(apiSource, "SCENARIOS");
  proofs.push({
    label: "parse const SCENARIOS",
    ok: apiScenarios !== null && apiScenarios.length > 0,
    detail: apiScenarios ? apiScenarios.join(", ") : "not found",
  });
  if (apiScenarios) {
    proofs.push({
      label: "SCENARIOS omits decisions",
      ok: !apiScenarios.includes("decisions"),
    });
    const apiInAll = VERIFIER_ROWS.filter((row) => row.dispatcher === "api" && row.inAll === true);
    for (const name of apiScenarios) {
      const row = apiInAll.find((item) => item.scenario === name);
      proofs.push({
        label: `api SCENARIOS member ${name} has inAll:true row`,
        ok: row !== undefined,
      });
    }
    for (const row of apiInAll) {
      proofs.push({
        label: `api inAll:true row ${row.scenario} is in SCENARIOS`,
        ok: row.scenario !== undefined && apiScenarios.includes(row.scenario),
      });
    }
    const decisions = VERIFIER_ROWS.find(
      (row) => row.dispatcher === "api" && row.scenario === "decisions",
    );
    proofs.push({
      label: "api decisions row inAll:false",
      ok: decisions !== undefined && decisions.inAll === false,
    });
  }
  proofs.push({
    label: 'verify-api extra accept scenario !== "decisions"',
    ok: hasDecisionsExtraAccept(apiSource),
  });

  const uiScenarios = parseNamedStringArray(uiSource, "ALL_SCENARIOS");
  proofs.push({
    label: "parse const ALL_SCENARIOS",
    ok: uiScenarios !== null && uiScenarios.length > 0,
    detail: uiScenarios ? uiScenarios.join(", ") : "not found",
  });
  if (uiScenarios) {
    const uiInAll = VERIFIER_ROWS.filter((row) => row.dispatcher === "ui" && row.inAll === true);
    for (const name of uiScenarios) {
      const row = uiInAll.find((item) => item.scenario === name);
      proofs.push({
        label: `ui ALL_SCENARIOS member ${name} has inAll:true row`,
        ok: row !== undefined,
      });
    }
    for (const row of uiInAll) {
      proofs.push({
        label: `ui inAll:true row ${row.scenario} is in ALL_SCENARIOS`,
        ok: row.scenario !== undefined && uiScenarios.includes(row.scenario),
      });
    }
  }

  const viewerNames = parseViewerUsageNames(viewerSource);
  proofs.push({
    label: "parse viewer usage combined|inspection|standalone",
    ok: viewerNames !== null && viewerNames.join("|") === "combined|inspection|standalone",
    detail: viewerNames ? viewerNames.join("|") : "not found",
  });
  if (viewerNames) {
    for (const name of viewerNames) {
      const row = VERIFIER_ROWS.find((item) => item.dispatcher === "viewer" && item.scenario === name);
      proofs.push({
        label: `viewer usage ${name} has row`,
        ok: row !== undefined,
      });
    }
    const combined = VERIFIER_ROWS.find(
      (row) => row.dispatcher === "viewer" && row.scenario === "combined",
    );
    proofs.push({
      label: "viewer combined default command has no --scenario flag",
      ok: combined !== undefined && combined.command === "node scripts/verify-viewer.ts",
    });
  }

  for (const phrase of FORBIDDEN_PHRASES) {
    proofs.push({
      label: `README forbids ${JSON.stringify(phrase)}`,
      ok: !readme.includes(phrase),
    });
    proofs.push({
      label: `bim-checking README forbids ${JSON.stringify(phrase)}`,
      ok: !bimChecking.includes(phrase),
    });
  }
  proofs.push({
    label: "bim-checking keeps reference-only denial",
    ok: bimChecking.includes(REFERENCE_ONLY_NEEDLE),
  });

  proofs.push({
    label: "checks.md contains Check11 correction",
    ok: checksMd.includes(CHECK11.correction),
  });
  proofs.push({
    label: "v2 IDS contains Check11 correction",
    ok: ids.includes(CHECK11.correction),
  });
  proofs.push({
    label: "v2 IDS omits Check11 stale phrase",
    ok: !ids.includes(CHECK11.stale),
  });

  const browserKeys = parseBrowserVerifierKeys(browserSource);
  const apiKeys = parseScenarioEvidenceKeys(apiSource);
  proofs.push({
    label: "parse BROWSER_VERIFIERS keys",
    ok: browserKeys !== null && browserKeys.length > 0,
    detail: browserKeys ? browserKeys.join(", ") : "not found",
  });
  proofs.push({
    label: "parse scenarioEvidenceDir keys",
    ok: apiKeys !== null && apiKeys.length > 0,
    detail: apiKeys ? apiKeys.join(", ") : "not found",
  });
  const harvested = unique([...(browserKeys ?? []), ...(apiKeys ?? [])]);
  const frozen = [...EVIDENCE_KEYS];
  const missingFromFrozen = harvested.filter((key) => !frozen.includes(key));
  const extraInFrozen = frozen.filter((key) => !harvested.includes(key));
  proofs.push({
    label: "harvested evidence keys ⊆ EVIDENCE_KEYS",
    ok: missingFromFrozen.length === 0,
    detail: missingFromFrozen.length ? missingFromFrozen.join(", ") : undefined,
  });
  proofs.push({
    label: "EVIDENCE_KEYS ⊆ harvested evidence keys",
    ok: extraInFrozen.length === 0,
    detail: extraInFrozen.length ? extraInFrozen.join(", ") : undefined,
  });
  proofs.push({
    label: "evidence keys omit task-3",
    ok: !harvested.includes("task-3") && !frozen.includes("task-3"),
  });

  return proofs;
}

function readRepoFile(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
