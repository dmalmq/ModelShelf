#!/usr/bin/env node

import { prove } from "./verify-viewer-inspection.ts";

function fakePage(inspect, propertyPanelCount) {
  return {
    evaluate: async () => inspect,
    locator: () => ({ count: async () => propertyPanelCount }),
  };
}

async function expectFail(proof, label, inspect, propertyPanelCount) {
  try {
    await prove(fakePage(inspect, propertyPanelCount), proof, label, 120);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === `FAIL - ${label}`) {
      console.log(`ok - named fail is ${label}`);
      return;
    }
    throw new Error(`wanted FAIL - ${label}, got ${message}`);
  }
  throw new Error(`wanted ${label} to fail`);
}

async function expectOk(proof, label, inspect, propertyPanelCount) {
  await prove(fakePage(inspect, propertyPanelCount), proof, label, 120);
  console.log(`ok - named pass is ${label}`);
}

const hiddenOff = { isolatedRequested: 4, selectedHidden: false, clipping: false };
const hiddenOn = { isolatedRequested: 4, selectedHidden: true, clipping: false };
const clipped = { isolatedRequested: 4, selectedHidden: false, clipping: true };

await expectOk({ kind: "isolatedRequested", expected: 4 }, "storey filter narrows isolation (L1: 4)", hiddenOff, 0);
await expectFail({ kind: "isolatedRequested", expected: 3 }, "storey filter narrows isolation (L1: 3)", hiddenOff, 0);
await expectOk({ kind: "selectedHidden" }, "selecting an object outside the isolation is reported as hidden", hiddenOn, 0);
await expectFail({ kind: "selectedHidden" }, "selecting an object outside the isolation is reported as hidden", hiddenOff, 0);
await expectOk({ kind: "clipping" }, "section cut enables renderer clipping", clipped, 0);
await expectFail({ kind: "clipping" }, "section cut enables renderer clipping", hiddenOff, 0);
await expectOk({ kind: "propertyPanelDetached" }, "changing viewer selection clears stale property details", hiddenOff, 0);
await expectFail({ kind: "propertyPanelDetached" }, "changing viewer selection clears stale property details", hiddenOff, 1);
console.log("named proof verification passed");
