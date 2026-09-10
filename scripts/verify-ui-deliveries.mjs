#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../apps/web/node_modules/playwright/index.mjs";
import { BIN_PATH, REPO_ROOT, buildBinary, createChecker, freePort, runCli, stopProcess, waitForHealth } from "./lib/checker-harness.mjs";

const scenarioFlag = process.argv.indexOf("--scenario");
const scenario = scenarioFlag >= 0 ? process.argv[scenarioFlag + 1] : null;
if (scenario !== "deliveries") {
  console.error("usage: node scripts/verify-ui.mjs --scenario deliveries (or scripts/verify-ui-deliveries.mjs directly)");
  process.exit(2);
}

const WEB_ROOT = join(REPO_ROOT, "apps", "web");
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype", "task-10");
const BASE_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "base.ifc");
const HEAD_IFC = join(REPO_ROOT, "packs", "demo", "fixtures", "head.ifc");
const FIXTURES_IDS = join(REPO_ROOT, "packs", "demo", "fixtures.ids");

for (const path of [BASE_IFC, HEAD_IFC, FIXTURES_IDS]) {
  if (!existsSync(path)) throw new Error(`Missing tracked fixture: ${path}`);
}

const BASE_SHA256 = sha256(readFileSync(BASE_IFC));
const HEAD_SHA256 = sha256(readFileSync(HEAD_IFC));

const runDir = join(EVIDENCE_ROOT, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(join(runDir, "snapshots"), { recursive: true });

const { check, failureCount } = createChecker();
const results = { scenario, passed: false, checks: [], ids: {}, membershipBeforeFinalize: null, membershipAfterReload: null };
function record(label, condition, detail) {
  check(label, condition, detail);
  results.checks.push({ label, ok: Boolean(condition), detail: condition ? undefined : String(detail ?? "") });
}
function snap(name, value) {
  writeFileSync(join(runDir, "snapshots", name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

buildBinary(runDir);

let dataDir = "";
let invalidPath = "";
let checkerProcess = null;
let nextProcess = null;
let browser = null;
let checkerLog = "";
let nextLog = "";
const browserLog = [];

async function api(origin, path, init) {
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, ok: response.ok, body };
}

async function pollUntil(label, fn, { intervalMs = 2000, timeoutMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await fn();
    if (last.done) return last.value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${last.note ?? "no progress"}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Let resize-driven CSS transitions finish before measuring geometry. */
async function settleLayout(page) {
  await page.waitForTimeout(600);
}

async function main() {
  dataDir = mkdtempSync(join(tmpdir(), "modelshelf-verify-ui-data-"));
  const invalidBytes = Buffer.from("this is not an IFC file\n");
  invalidPath = join(dataDir, "invalid.ifc");
  writeFileSync(invalidPath, invalidBytes);

  const seed = runCli(["seed", "--data-dir", dataDir, "--packs-dir", join(REPO_ROOT, "packs", "demo")]);
  writeFileSync(join(runDir, "seed.log"), `${seed.stdout}${seed.stderr}`);
  record("seed exits zero", seed.status === 0, `exit ${seed.status}: ${seed.stdout}${seed.stderr}`);

  const uvSync = spawnSync("uv", ["sync", "--locked", "--project", "services/ifc-worker"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  writeFileSync(join(runDir, "worker-sync.log"), `${uvSync.stdout ?? ""}${uvSync.stderr ?? ""}`);
  if (uvSync.status !== 0) console.error(`WARN - worker pre-sync failed, first job pays the cost: ${uvSync.stderr}`);

  const checkerPort = await freePort();
  checkerProcess = spawn(BIN_PATH, ["serve", "--data-dir", dataDir, "--port", String(checkerPort)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  checkerProcess.stdout.on("data", (chunk) => (checkerLog += String(chunk)));
  checkerProcess.stderr.on("data", (chunk) => (checkerLog += String(chunk)));
  await waitForHealth(checkerPort, { child: checkerProcess, timeoutMs: 15_000 });
  record("checker becomes healthy", true);

  const webPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const checkerOrigin = `http://127.0.0.1:${checkerPort}`;
  const buildEnv = { ...process.env, CHECKER_ORIGIN: checkerOrigin };
  const build = spawnSync(process.execPath, [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: WEB_ROOT,
    env: buildEnv,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(runDir, "next-build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
  record("production Next build succeeds", build.status === 0, `exit ${build.status}`);
  if (build.status !== 0) throw new Error("Next build failed; see next-build.log");

  nextProcess = spawn(
    process.execPath,
    [join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(webPort)],
    { cwd: WEB_ROOT, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  nextProcess.stdout.on("data", (chunk) => (nextLog += String(chunk)));
  nextProcess.stderr.on("data", (chunk) => (nextLog += String(chunk)));
  await pollUntil("next start", async () => {
    try {
      const res = await fetch(`${webOrigin}/`);
      return { done: res.ok, note: `http ${res.status}` };
    } catch {
      return { done: false, note: "connection refused" };
    }
  }, { intervalMs: 500, timeoutMs: 60_000 });
  record("production Next app serves the shelf", true);

  const packsRes = await api(webOrigin, "/api/packs");
  snap("packs.json", packsRes.body);
  const versions = packsRes.body?.[0]?.versions ?? [];
  const fixtureVersion = versions.find((version) => version.notes === "fixtures.ids") ?? versions[0];
  record("seeded pack versions are reachable through the app", packsRes.ok && versions.length >= 1, JSON.stringify(packsRes.body)?.slice(0, 200));
  results.ids.packVersionId = fixtureVersion?.id ?? null;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => browserLog.push(`console ${message.type()}: ${message.text()}\n`));
  page.on("pageerror", (error) => browserLog.push(`pageerror: ${error.stack ?? error.message}\n`));

  await page.goto(`${webOrigin}/`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-project-shelf]").waitFor({ timeout: 30_000 });
  const defaultLocale = await page.evaluate(() => document.documentElement.lang);
  record("Japanese is the default interface locale", defaultLocale === "ja", defaultLocale);
  await page.locator('[data-locale="en"]').click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const englishHeading = (await page.locator("[data-project-shelf] h1").textContent()) ?? "";
  record("locale switch replaces shelf chrome with English", englishHeading === "Project shelf", englishHeading);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-project-shelf]").waitFor({ timeout: 30_000 });
  const persistedLocale = await page.evaluate(() => document.documentElement.lang);
  record("locale choice survives reload", persistedLocale === "en", persistedLocale);
  await page.locator('[data-locale="ja"]').click();
  await page.waitForFunction(() => document.documentElement.lang === "ja");
  await page.waitForFunction(() => new URLSearchParams(window.location.search).get("project"), null, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("project");
  results.ids.projectId = projectId;
  record("shelf selects a project and keeps it in the URL", Boolean(projectId), page.url());
  await page.screenshot({ path: join(runDir, "shelf-desktop.png"), fullPage: true });

  async function createSource(name) {
    await page.locator("[data-new-source-name]").fill(name);
    await page.locator("[data-new-source-discipline]").click();
    await page.getByRole("option", { name: "MEP" }).click();
    await page.locator("[data-create-source]").click();
    await page.waitForFunction(
      (expected) => [...document.querySelectorAll("[data-source-id]")].some((row) => row.textContent?.includes(expected)),
      name,
      { timeout: 30_000 },
    );
    return page.evaluate((expected) => {
      const row = [...document.querySelectorAll("[data-source-id]")].find((candidate) => candidate.textContent?.includes(expected));
      return row?.getAttribute("data-source-id");
    }, name);
  }

  const mepNorthId = await createSource("MEP North");
  const mepSouthId = await createSource("MEP South");
  results.ids.mepNorthId = mepNorthId;
  results.ids.mepSouthId = mepSouthId;
  record("two MEP sources are created with distinct IDs", Boolean(mepNorthId && mepSouthId && mepNorthId !== mepSouthId), `${mepNorthId} / ${mepSouthId}`);
  const mepCount = await page.evaluate(() =>
    [...document.querySelectorAll("[data-source-id]")].filter((row) => row.textContent?.includes("MEP")).length,
  );
  record("two MEP sources remain distinct on the shelf", mepCount >= 2, `mep rows: ${mepCount}`);

  async function createDelivery(label) {
    await page.locator("[data-new-delivery-label]").fill(label);
    await page.locator("[data-create-delivery]").click();
    await page.waitForFunction(
      (expected) => document.querySelector(`[data-delivery-id] a[href*="/deliveries/"]`) !== null
        && [...document.querySelectorAll("[data-delivery-id]")].some((row) => row.textContent?.includes(expected)),
      label,
      { timeout: 30_000 },
    );
    return page.evaluate((expected) => {
      const row = [...document.querySelectorAll("[data-delivery-id]")].find((candidate) => candidate.textContent?.includes(expected));
      const link = row?.querySelector("a");
      return { id: row?.getAttribute("data-delivery-id"), href: link?.getAttribute("href") };
    }, label);
  }

  const drop1 = await createDelivery("drop-1");
  const drop2 = await createDelivery("drop-2");
  results.ids.drop1Id = drop1.id;
  results.ids.drop2Id = drop2.id;
  record("two deliveries are created", Boolean(drop1.id && drop2.id && drop1.id !== drop2.id), `${drop1.id} / ${drop2.id}`);
  record("delivery links preserve project context", Boolean(drop1.href?.includes(`project=${projectId}`)), drop1.href);

  async function openDelivery(href) {
    await page.goto(`${webOrigin}${href}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-delivery-id]", { timeout: 30_000 });
  }

  async function sourceCard(sourceId) {
    return page.locator(`[data-source-id="${sourceId}"]`);
  }

  async function uploadToSource(sourceId, filePath, terminalStatus) {
    const card = await sourceCard(sourceId);
    await card.locator("input[type=file]").setInputFiles(filePath);
    await card.locator("[data-upload-revision]").click();
    await page.waitForFunction(
      ({ id, status }) => document.querySelector(`[data-source-id="${id}"] [data-job-status="${status}"]`) !== null,
      { id: sourceId, status: terminalStatus },
      { timeout: 600_000 },
    );
  }

  async function memberOf(sourceId) {
    return page.evaluate((id) => {
      const card = document.querySelector(`[data-source-id="${id}"]`);
      const member = card?.querySelector("dl[data-revision-id]");
      const name = card?.querySelector("h3, h2")?.textContent ?? "";
      return {
        revisionId: member?.getAttribute("data-revision-id"),
        filename: member?.querySelector("dd")?.textContent ?? null,
        name,
      };
    }, sourceId);
  }

  async function attachRevision(sourceId, revisionId) {
    const card = await sourceCard(sourceId);
    await card.locator(`li[data-revision-id="${revisionId}"] [data-attach-revision]`).click();
    await page.waitForFunction(
      ({ sid, rid }) => document.querySelector(`[data-source-id="${sid}"] dl[data-revision-id="${rid}"]`) !== null,
      { sid: sourceId, rid: revisionId },
      { timeout: 30_000 },
    );
  }

  await openDelivery(drop1.href);
  record("delivery route is bookmarkable with project context", new URL(page.url()).searchParams.get("project") === projectId, page.url());

  await uploadToSource(mepNorthId, BASE_IFC, "completed");
  const northRevContender = await page.evaluate((id) => {
    const card = document.querySelector(`[data-source-id="${id}"]`);
    return [...(card?.querySelectorAll("ol li[data-revision-id]") ?? [])].map((row) => ({
      revisionId: row.getAttribute("data-revision-id"),
      text: row.textContent ?? "",
    }));
  }, mepNorthId);
  const revA1 = northRevContender.find((row) => row.text.includes("base.ifc"))?.revisionId;
  record("base.ifc revision is published for MEP North", Boolean(revA1), JSON.stringify(northRevContender));
  await attachRevision(mepNorthId, revA1);
  results.ids.revA1 = revA1;

  await uploadToSource(mepSouthId, HEAD_IFC, "completed");
  const southRevsAfterHead = await page.evaluate((id) => {
    const card = document.querySelector(`[data-source-id="${id}"]`);
    return [...(card?.querySelectorAll("ol li[data-revision-id]") ?? [])].map((row) => ({
      revisionId: row.getAttribute("data-revision-id"),
      text: row.textContent ?? "",
    }));
  }, mepSouthId);
  const revB1 = southRevsAfterHead.find((row) => row.text.includes("head.ifc"))?.revisionId;
  await attachRevision(mepSouthId, revB1);
  results.ids.revB1 = revB1;
  const drop1Viewer = page.locator("[data-combined-section]");
  await drop1Viewer.locator('[data-presentation="desk"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("[data-combined-section]")?.getAttribute("data-model-count") === "2");
  record("combined viewer refreshes after membership changes", true);

  const drop1Detail = await api(webOrigin, `/api/deliveries/${drop1.id}`);
  snap("delivery-drop1-before-failure.json", drop1Detail.body);
  const northModel = drop1Detail.body?.models?.find((model) => model.sourceModelId === mepNorthId);
  const southModel = drop1Detail.body?.models?.find((model) => model.sourceModelId === mepSouthId);
  record(
    "published revision hashes match tracked fixture bytes",
    northModel?.contentSha256 === BASE_SHA256 && southModel?.contentSha256 === HEAD_SHA256,
    `north=${northModel?.contentSha256} south=${southModel?.contentSha256}`,
  );

  await uploadToSource(mepSouthId, invalidPath, "failed");
  const southAfterFailure = await memberOf(mepSouthId);
  const northAfterFailure = await memberOf(mepNorthId);
  record(
    "failed replacement upload preserves the current ready revision",
    southAfterFailure.revisionId === revB1 && (southAfterFailure.filename ?? "").includes("head.ifc"),
    JSON.stringify(southAfterFailure),
  );
  record(
    "failed upload leaves ready siblings intact",
    northAfterFailure.revisionId === revA1,
    JSON.stringify(northAfterFailure),
  );
  await page.screenshot({ path: join(runDir, "delivery-failed-upload-desktop.png"), fullPage: true });

  const failedStatus = page.locator(`[data-source-id="${mepSouthId}"] [data-job-status="failed"]`);
  const attemptsBeforeRetry = Number(await failedStatus.getAttribute("data-job-attempts"));
  await page.locator(`[data-source-id="${mepSouthId}"] [data-retry-upload]`).click();
  await page.waitForFunction(
    ({ sourceId, previousAttempts }) => {
      const state = document.querySelector(`[data-source-id="${sourceId}"] [data-job-status="failed"]`);
      return Number(state?.getAttribute("data-job-attempts")) > previousAttempts;
    },
    { sourceId: mepSouthId, previousAttempts: attemptsBeforeRetry },
    { timeout: 600_000 },
  );
  const attemptsAfterRetry = Number(await failedStatus.getAttribute("data-job-attempts"));
  record(
    "failed upload retry runs the same durable job again",
    attemptsAfterRetry > attemptsBeforeRetry,
    `before=${attemptsBeforeRetry} after=${attemptsAfterRetry}`,
  );

  await uploadToSource(mepSouthId, BASE_IFC, "completed");
  const southRevsAfterBase = await page.evaluate((id) => {
    const card = document.querySelector(`[data-source-id="${id}"]`);
    return [...(card?.querySelectorAll("ol li[data-revision-id]") ?? [])].map((row) => ({
      revisionId: row.getAttribute("data-revision-id"),
      text: row.textContent ?? "",
    }));
  }, mepSouthId);
  const revB2 = southRevsAfterBase.find((row) => row.text.includes("base.ifc"))?.revisionId;
  results.ids.revB2 = revB2;
  record("updated revision is published for MEP South", Boolean(revB2 && revB2 !== revB1), JSON.stringify(southRevsAfterBase));

  await openDelivery(drop2.href);
  await page.locator("[data-combined-empty]").waitFor({ timeout: 30_000 });
  record("empty delivery explains assembly instead of mounting a broken viewer", true);

  await attachRevision(mepNorthId, revA1);
  await attachRevision(mepSouthId, revB2);
  const drop2Viewer = page.locator("[data-combined-section]");
  await drop2Viewer.locator('[data-presentation="desk"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("[data-combined-section]")?.getAttribute("data-model-count") === "2");
  record("combined viewer shows both reused and updated revisions", true);
  const drop2Members = await page.evaluate(() => {
    const members = {};
    for (const card of document.querySelectorAll("[data-source-id]")) {
      const sid = card.getAttribute("data-source-id");
      const member = card.querySelector("dl[data-revision-id]");
      if (sid) members[sid] = member?.getAttribute("data-revision-id") ?? null;
    }
    return members;
  });
  record(
    "drop-2 reuses one revision and updates another",
    drop2Members[mepNorthId] === revA1 && drop2Members[mepSouthId] === revB2,
    JSON.stringify(drop2Members),
  );

  await page.locator("[data-finalize-trigger]").click();
  record("finalization requires an explicit confirmation", await page.locator("[data-finalize-confirm]").count() === 1, "confirmation dialog missing");
  await page.locator("[data-finalize-confirm]").click();
  await page.waitForSelector("[data-delivery-finalized]", { timeout: 30_000 });
  const finalizedDetail = await api(webOrigin, `/api/deliveries/${drop2.id}`);
  snap("delivery-drop2-finalized.json", finalizedDetail.body);
  results.membershipBeforeFinalize = Object.fromEntries(
    (finalizedDetail.body?.models ?? [])
      .map((model) => [model.sourceModelId, model.id])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  record("finalize freezes membership on the server", Boolean(finalizedDetail.body?.delivery?.finalizedAt), finalizedDetail.body?.delivery?.finalizedAt ?? "");
  const lockedMemberButtons = page.locator("[data-attach-revision]");
  const lockedButtonCount = await lockedMemberButtons.count();
  let allLockedButtonsDisabled = true;
  const lockedButtonStates = [];
  for (let index = 0; index < lockedButtonCount; index += 1) {
    const button = lockedMemberButtons.nth(index);
    const disabled = await button.isDisabled();
    lockedButtonStates.push({ label: await button.getAttribute("aria-label"), disabled });
    allLockedButtonsDisabled &&= disabled;
  }
  record(
    "finalized delivery disables membership changes",
    allLockedButtonsDisabled,
    JSON.stringify(lockedButtonStates),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-delivery-id]", { timeout: 30_000 });
  const afterReload = await page.evaluate(() => {
    const members = {};
    for (const card of document.querySelectorAll("[data-source-id]")) {
      const sid = card.getAttribute("data-source-id");
      const member = card.querySelector("dl[data-revision-id]");
      if (sid) members[sid] = member?.getAttribute("data-revision-id") ?? null;
    }
    return members;
  });
  const sortedAfterReload = Object.fromEntries(
    Object.entries(afterReload).sort(([left], [right]) => left.localeCompare(right)),
  );
  results.membershipAfterReload = sortedAfterReload;
  record(
    "reload shows identical membership",
    JSON.stringify(sortedAfterReload) === JSON.stringify(results.membershipBeforeFinalize),
    `before=${JSON.stringify(results.membershipBeforeFinalize)} after=${JSON.stringify(sortedAfterReload)}`,
  );

  const runRes = await api(webOrigin, "/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryId: drop1.id, packVersionId: fixtureVersion.id }),
  });
  snap("run-created.json", runRes.body);
  record("run prerequisite is created through the API", runRes.ok && Boolean(runRes.body?.run?.id), `http ${runRes.status}`);
  const runId = runRes.body?.run?.id;
  results.ids.runId = runId;
  const finishedRun = await pollUntil("run completion", async () => {
    const current = await api(webOrigin, `/api/runs/${runId}`);
    if (!current.ok) return { done: false, note: `http ${current.status}` };
    if (current.body?.run?.status === "completed") return { done: true, value: current.body };
    if (current.body?.run?.status === "failed") throw new Error(`run failed: ${current.body?.run?.error}`);
    return { done: false, note: `status ${current.body?.run?.status}` };
  }, { intervalMs: 5000, timeoutMs: 900_000 });
  snap("run-detail.json", finishedRun);
  const expectedModels = finishedRun.models ?? [];
  const expectedHashes = Object.fromEntries(expectedModels.map((model) => [model.sourceModelName, model.contentSha256]));

  await openDelivery(drop1.href);
  await page.locator("[data-run-locked]").waitFor({ timeout: 30_000 });
  record("completed run locks a draft delivery in the UI", true);
  await page.locator(`[data-view-run="${runId}"]`).click();
  await page.waitForFunction(
    (id) => new URLSearchParams(window.location.search).get("run") === id,
    runId,
    { timeout: 30_000 },
  );
  record("selecting a run keeps run in the URL", true, page.url());
  const provenance = page.locator("[data-provenance]");
  await provenance.waitFor({ timeout: 60_000 });
  const provenanceStatus = await provenance.getAttribute("data-provenance");
  const provenanceText = (await provenance.textContent()) ?? "";
  record("complete provenance is shown explicitly", provenanceStatus === "complete" && provenanceText.trim().length > 0, provenanceText);
  snap("provenance-text.txt", provenanceText);
  const runPanel = page.locator(`[data-run-detail="${runId}"]`);
  const renderedHashes = {};
  for (const model of expectedModels) {
    const pinned = runPanel.locator(`li[data-revision-id="${model.id}"]`);
    const pinnedText = (await pinned.textContent()) ?? "";
    const renderedHash = ((await pinned.locator("span").nth(1).textContent()) ?? "").trim();
    renderedHashes[model.sourceModelName] = renderedHash;
    record(
      `pinned input reachable: ${model.sourceModelName} ${model.filename}`,
      pinnedText.includes(model.sourceModelName)
        && pinnedText.includes(model.filename)
        && renderedHash === model.contentSha256
        && pinnedText.includes(model.schemaLabel),
      pinnedText.slice(0, 200),
    );
  }
  record(
    "pinned hashes match the API snapshot",
    JSON.stringify(renderedHashes) === JSON.stringify(expectedHashes),
    `ui=${JSON.stringify(renderedHashes)} api=${JSON.stringify(expectedHashes)}`,
  );

  await page.screenshot({ path: join(runDir, "delivery-run-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  // Buttons carry `transition-all`, so a resize animates their height. Measure
  // after the transition settles or every control reads mid-flight.
  await settleLayout(page);
  const deskMobileLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  record(
    "desk layout reflows without horizontal page overflow at 390px",
    deskMobileLayout.scrollWidth <= deskMobileLayout.clientWidth + 1,
    JSON.stringify(deskMobileLayout),
  );
  await page.screenshot({ path: join(runDir, "delivery-run-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-view-mode-toggle="meeting"]').click();
  await page.waitForFunction(() => new URLSearchParams(window.location.search).get("view") === "meeting");
  await page.locator('[data-view-mode="meeting"] [data-meeting-review] [data-presentation="meeting"]').waitFor({ timeout: 60_000 });
  record(
    "meeting mode replaces assembly chrome with the presentation surface",
    await page.locator("[data-meeting-review]").count() === 1 && await page.locator("[data-combined-section]").count() === 0,
  );
  const meetingFacts = page.locator("[data-meeting-review] [data-totals-header] dd");
  await meetingFacts.first().waitFor({ timeout: 60_000 });
  const meetingFactText = await meetingFacts.allTextContents();
  record(
    "meeting mode presents four prominent decision facts",
    meetingFactText.length === 4 && meetingFactText.every((value) => /\d/.test(value)),
    JSON.stringify(meetingFactText),
  );
  await page.screenshot({ path: join(runDir, "delivery-meeting-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await settleLayout(page);
  const meetingMobileLayout = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('[data-view-mode="meeting"] button')].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      undersizedControls: controls
        .filter((button) => button.getBoundingClientRect().height < 44)
        .map((button) => ({
          label: button.textContent?.trim() ?? button.getAttribute("aria-label") ?? "",
          height: Math.round(button.getBoundingClientRect().height),
        })),
    };
  });
  record(
    "meeting mode reflows at 390px with 44px touch controls",
    meetingMobileLayout.scrollWidth <= meetingMobileLayout.clientWidth + 1 && meetingMobileLayout.undersizedControls.length === 0,
    JSON.stringify(meetingMobileLayout),
  );
  await page.screenshot({ path: join(runDir, "delivery-meeting-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 720, height: 450 });
  await settleLayout(page);
  const meetingZoomLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    presentationVisible: document.querySelector('[data-presentation="meeting"]')?.getBoundingClientRect().height ?? 0,
  }));
  record(
    "meeting mode remains usable at a 200-percent-equivalent viewport",
    meetingZoomLayout.scrollWidth <= meetingZoomLayout.clientWidth + 1 && meetingZoomLayout.presentationVisible > 0,
    JSON.stringify(meetingZoomLayout),
  );
  await page.screenshot({ path: join(runDir, "delivery-meeting-200-percent.png"), fullPage: true });

  results.passed = true;
  console.log("delivery verification passed");
}

try {
  await main();
} catch (error) {
  results.error = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(results.error);
} finally {
  if (browser) await browser.close();
  await stopProcess(nextProcess);
  await stopProcess(checkerProcess);
  writeFileSync(join(runDir, "checker.log"), checkerLog);
  writeFileSync(join(runDir, "next.log"), nextLog);
  writeFileSync(join(runDir, "browser.log"), browserLog.join(""));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

snap("results.json", { ...results, failures: failureCount() });
console.log(`evidence written to ${runDir}`);
if (failureCount() > 0 || !results.passed) {
  console.error(`${failureCount()} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
