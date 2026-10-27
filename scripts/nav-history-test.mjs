import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fund-nav-history-"));
try {
  fs.mkdirSync(path.join(root, "data"));
  const ids = ["ACJS06", "ACYT161", "ZZZ99"];
  const dates = ["2026-10-08", "2026-10-12", "2026-10-13"];
  const items = Object.fromEntries(ids.map((id, index) => [id, {
    fundId: id,
    days: [{ day: dates[index], date: dates[index], nav: 100 }],
    weeks: [{ week: index === 0 ? "2026-W41" : "2026-W42", date: dates[index], nav: 100 }],
    months: [{ month: "2026-10", date: dates[index], nav: 100 }]
  }]));
  const payload = { source: "test", updatedAt: "2026-10-14T00:00:00Z", items };
  fs.writeFileSync(path.join(root, "data/monthly_nav.json"), JSON.stringify(payload));
  execFileSync(process.execPath, ["scripts/build-nav-history.mjs", root]);

  const index = JSON.parse(fs.readFileSync(path.join(root, "data/nav_history/index.json"), "utf8"));
  assert.deepEqual(index.ids, ids);
  assert.deepEqual(index.calendar.day.map((row) => row.date), dates);
  assert.deepEqual(index.calendar.week.map((row) => row.date), ["2026-10-08", "2026-10-13"]);
  assert.deepEqual(index.calendar.month.map((row) => row.date), ["2026-10-13"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "data/nav_history/ACJS06.json"), "utf8")), items.ACJS06);

  const source = fs.readFileSync("app.js", "utf8");
  const start = source.indexOf("function monthlyNavHistoryIds()");
  const end = source.indexOf("async function refreshPurchaseValues()", start);
  assert(start >= 0 && end > start);
  const requests = [];
  let blockFund = "";
  const context = {
    purchases: [{ fund_id: "ACJS06" }],
    cashAdjustments: [],
    recurringPlans: [],
    monthlyNavMeta: { source: "not loaded", updatedAt: null, items: {} },
    monthlyNavIndex: null,
    monthlyNavIndexPromise: null,
    monthlyNavLoadPromise: null,
    monthlyNavLoadedIds: new Set(),
    monthlyNavLoadFailed: false,
    fundDataLoaded: false,
    moneyDjFundId: (value) => String(value || "").match(/[A-Z]{2,}\d{2,}/)?.[0] || "",
    currentFundForPurchase: (item) => ({ fundId: item.fund_id }),
    renderTwiiTrendChart: () => {},
    renderPurchases: () => {},
    fetch: async (url) => {
      const relative = url.split("?")[0];
      requests.push(relative);
      if (blockFund && (relative.includes(blockFund) || relative === "data/monthly_nav.json")) {
        return { ok: false };
      }
      const file = path.join(root, relative);
      return fs.existsSync(file)
        ? { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) }
        : { ok: false };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const calendarStart = source.indexOf("function monthKeyFromDate(");
  const calendarEnd = source.indexOf("function manualProfitRowsForPurchase(", calendarStart);
  assert(calendarStart >= 0 && calendarEnd > calendarStart);
  vm.runInContext(source.slice(calendarStart, calendarEnd), context);

  await context.loadMonthlyNavIndex();
  assert.deepEqual(requests, ["data/nav_history/index.json"]);
  assert.equal(await context.loadMonthlyNavData(), true);
  assert.deepEqual(Object.keys(context.monthlyNavMeta.items), ["ACJS06"]);
  assert.deepEqual(Array.from(context.portfolioPeriodCalendar("day"), (row) => row.date), dates);
  assert.equal(requests.includes("data/monthly_nav.json"), false);
  assert.equal(context.monthlyNavHistoryReady(), true);

  const previousCount = requests.length;
  assert.equal(await context.loadMonthlyNavData(), true);
  assert.equal(requests.length, previousCount);

  context.purchases.push({ fund_id: "ACYT161" });
  assert.equal(context.monthlyNavHistoryReady(), false);
  assert.equal(await context.loadMonthlyNavData(), true);
  assert.deepEqual(Object.keys(context.monthlyNavMeta.items).sort(), ["ACJS06", "ACYT161"]);
  assert.equal(requests.filter((url) => url === "data/nav_history/ACYT161.json").length, 1);

  context.purchases.push({ fund_id: "ZZZ99" });
  blockFund = "ZZZ99";
  assert.equal(await context.loadMonthlyNavData(), false);
  assert.equal(context.monthlyNavLoadFailed, true);
  assert.equal(context.monthlyNavHistoryReady(), false);
  assert.deepEqual(Object.keys(context.monthlyNavMeta.items).sort(), ["ACJS06", "ACYT161"]);

  blockFund = "";
  assert.equal(await context.loadMonthlyNavData(), true);
  assert.equal(context.monthlyNavLoadFailed, false);
  assert.equal(context.monthlyNavHistoryReady(), true);
  assert.equal(await context.loadMonthlyNavData({ force: true }), true);
  assert.equal(requests.filter((url) => url === "data/nav_history/index.json").length, 2);

  const previousItems = Object.keys(context.monthlyNavMeta.items);
  blockFund = "ACJS06";
  assert.equal(await context.loadMonthlyNavData({ force: true }), false);
  assert.equal(context.monthlyNavHistoryReady(), false);
  assert.deepEqual(Object.keys(context.monthlyNavMeta.items), previousItems);
  blockFund = "";
  const previousFundRequests = requests.filter((url) => url === "data/nav_history/ACJS06.json").length;
  assert.equal(await context.loadMonthlyNavData(), true);
  assert.equal(requests.filter((url) => url === "data/nav_history/ACJS06.json").length, previousFundRequests + 1);

  fs.writeFileSync(path.join(root, "data/monthly_nav.json"), JSON.stringify({ ...payload, items: { ACJS06: items.ACJS06 } }));
  execFileSync(process.execPath, ["scripts/build-nav-history.mjs", root]);
  assert.equal(fs.existsSync(path.join(root, "data/nav_history/ACYT161.json")), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "data/nav_history/index.json"), "utf8")).ids, ["ACJS06"]);
  console.log("NAV history test passed: per-fund loads, backdated addition, failure safety, and stale cleanup");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
