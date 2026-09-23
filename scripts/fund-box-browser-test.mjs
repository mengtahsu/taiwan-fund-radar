import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [dataRoot, fixturePath] = process.argv.slice(2);
if (!dataRoot || !fixturePath) throw new Error("Pass a data workspace and a live distribution fixture JSON");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const browser = await chromium.launch({ headless: true, channel: "chrome" });

try {
  for (const [label, width, height] of [["iphone", 390, 844], ["desktop", 1280, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: label === "iphone", hasTouch: label === "iphone" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The fixture must never read or write anyone's live portfolio.
    await page.route("**/rest/v1/**", (route) => route.abort());
    await page.route("https://mengtahsu.github.io/taiwan-fund-radar/**", async (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.replace("/taiwan-fund-radar/", "")) || "index.html";
      const file = path.join(name.startsWith("data/") ? dataRoot : process.cwd(), name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ path: file });
      return route.continue();
    });
    await page.goto("https://mengtahsu.github.io/taiwan-fund-radar/", { waitUntil: "networkidle" });
    const report = await page.evaluate((data) => {
      currentUser = { id: "smoke-only" };
      fundTrailingBoxesSupported = false;
      const fund = funds.find((entry) => entry.fundId === data.fundId);
      monthlyNavMeta.items[data.fundId] = { fundId: data.fundId, days: data.rows, distributions: data.distributions };
      const item = {
        id: "smoke-dividend", fund_id: data.fundId, fund_name: fund.name,
        buy_date: "2026-09-09", nav: 22.28, amount: 300000
      };
      buildFundBoxStore([item]);
      const key = fundBoxKeyForPurchase(item);
      const before = fundBoxStore.get(key).analysis;
      buildFundBoxStore([item]);
      const after = fundBoxStore.get(key).analysis;
      const savedPeak = fundTrailingBoxes.get(key)?.peak_nav;
      persistFundTrailingBox({ key, analysis: { top: null, status: "distribution_unadjusted" } });
      const invalidPeakIgnored = savedPeak === fundTrailingBoxes.get(key)?.peak_nav;
      showFundBoxModal(key);
      return {
        status: after.status, top: after.top, bottom: after.bottom,
        reloadedUnchanged: before.top === after.top, invalidPeakIgnored,
        trigger: renderFundBoxTrigger(item), savedPeak
      };
    }, fixture);
    await page.waitForTimeout(250);
    const layout = await page.locator("#fundBoxModal").evaluate((element) => ({
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      svg: element.querySelector("svg")?.getBoundingClientRect().toJSON(),
      paths: element.querySelectorAll("svg path").length
    }));
    await page.screenshot({ path: `/tmp/fund-box-${label}.png` });
    console.log(JSON.stringify({ label, report, layout, errors }));
    if (report.status !== "inside" || !report.reloadedUnchanged || !report.invalidPeakIgnored ||
        !layout.svg || layout.scrollWidth > layout.clientWidth || errors.length) {
      throw new Error("Fund box browser validation failed");
    }
    await page.close();
  }
} finally {
  await browser.close();
}
