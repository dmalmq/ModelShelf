#!/usr/bin/env node

import { provePublishedClaims, REPO_ROOT } from "./lib/published-claims.ts";

const proofs = provePublishedClaims(REPO_ROOT);
let failures = 0;
for (const proof of proofs) {
  if (proof.ok) {
    console.log(`ok - ${proof.label}`);
  } else {
    failures += 1;
    const suffix = proof.detail ? `: ${proof.detail}` : "";
    console.error(`FAIL - ${proof.label}${suffix}`);
  }
}

if (failures > 0) {
  process.exit(1);
}
