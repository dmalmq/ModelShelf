import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = process.argv[2];
const BASE = "http://127.0.0.1:3477";
const log = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function state(tag) {
  const s = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    lang: document.documentElement.lang,
    sidebar: document.documentElement.dataset.sidebar ?? "expanded",
    navWidth: Math.round(document.querySelector("nav").getBoundingClientRect().width),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    activeItem: document.querySelector('[aria-current="page"]')?.textContent?.trim(),
    badges: [...document.querySelectorAll("nav .tabular-nums")].map((n) => n.textContent.trim()),
    inertCount: document.querySelectorAll('nav [aria-disabled="true"]').length,
    accentBar: !!document.querySelector('[aria-current="page"] span[aria-hidden="true"]'),
    fontSans: getComputedStyle(document.body).fontFamily.split(",")[0],
    displayFont: getComputedStyle(document.querySelector("h1")).fontFamily.split(",")[0],
  }));
  log.push({ tag, ...s });
  return s;
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("nav");
await state("1-initial");
await page.screenshot({ path: `${OUT}/01-dark-ja-expanded.png` });

// light theme via the header switcher (labelled in Japanese at this point)
await page.getByRole("group", { name: "テーマ" }).getByRole("button", { name: "ライト" }).click();
await page.waitForTimeout(250);
await state("2-light");
await page.screenshot({ path: `${OUT}/02-light-ja-expanded.png` });

// English
await page.getByRole("group", { name: "言語" }).getByRole("button", { name: "EN" }).click();
await page.waitForTimeout(150);
await state("3-english");

// collapse to the icon rail
await page.getByRole("button", { name: "Collapse sidebar" }).click();
await page.waitForTimeout(300);
await state("4-collapsed");
await page.screenshot({ path: `${OUT}/03-light-en-rail.png` });

// persistence across a reload — the no-flash script must restore all three
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("nav");
await state("5-after-reload");
await page.screenshot({ path: `${OUT}/04-reload-persisted.png` });

// dark again, in the rail, to confirm tokens flip with the sidebar collapsed
await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
await page.waitForTimeout(250);
await state("6-dark-rail");
await page.screenshot({ path: `${OUT}/05-dark-en-rail.png` });

// the deliveries branch must stay dark even with light chosen
await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
await page.waitForTimeout(150);
await page.goto(`${BASE}/deliveries/dlv_demo`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
log.push({
  tag: "7-deliveries-pinned-dark",
  ...(await page.evaluate(() => {
    const scope = document.querySelector('[data-theme="dark"]');
    return {
      htmlTheme: document.documentElement.dataset.theme,
      scopedTheme: scope?.getAttribute("data-theme") ?? null,
      scopeBg: scope ? getComputedStyle(scope).backgroundColor : null,
    };
  })),
});
await page.screenshot({ path: `${OUT}/06-deliveries-dark-scope.png` });

fs.writeFileSync(`${OUT}/state.json`, JSON.stringify(log, null, 2));
await browser.close();
console.log(JSON.stringify(log, null, 2));
