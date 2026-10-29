import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const edgeSource = fs.readFileSync("supabase/functions/refresh-nav/index.ts", "utf8");
let handler;
let historyUnavailable = false;
const calls = [];
const edge = {
  Response, Request, Date, Map,
  Deno: { serve: (value) => { handler = value; } },
  fetch: async (url) => {
    calls.push(url);
    if (url.startsWith("https://m.moneydj.com/a1.aspx")) {
      return new Response('<span class="netValue"><span class="price">120</span></span> (2026/10/29)');
    }
    assert(url.startsWith("https://fund.megabank.com.tw/w/bcd/tBCDNavList.djbcd?a=AAA100&"));
    return historyUnavailable
      ? new Response("unavailable", { status: 503 })
      : new Response("20261027,20261028,20261029 100,110,120");
  }
};
vm.createContext(edge);
vm.runInContext(stripTypeScriptTypes(edgeSource), edge);
const refresh = async (body) => (await handler(new Request("https://example.test/refresh-nav", {
  method: "POST", body: JSON.stringify(body)
}))).json();

const payload = await refresh({ fundIds: ["AAA100", "AAA100", "../bad"], includeHistory: true });
assert.equal(payload.items.length, 1);
assert.equal(payload.items[0].navFullDate, "2026-10-29");
assert.deepEqual(payload.items[0].history.map((row) => row.date), ["2026-10-27", "2026-10-28", "2026-10-29"]);
assert.equal(calls.length, 2, "duplicates must not create extra source requests");
historyUnavailable = true;
const partial = await refresh({ fundIds: ["AAA100"], includeHistory: true });
assert.equal(partial.items[0].nav, 120, "latest NAV remains usable if history fails");
assert(partial.items[0].historyError);
assert.equal(partial.items[0].history, undefined, "a failed source must not fabricate history");
const beforeLegacy = calls.length;
await refresh({ fundIds: ["AAA100"] });
assert.equal(calls.length - beforeLegacy, 1, "older clients keep the one-request behavior");
assert.throws(() => edge.parseNavHistory("20261027,20261028 100"));
assert.throws(() => edge.parseNavHistory("20260230 100"));

const source = fs.readFileSync("app.js", "utf8");
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  let params = 0;
  let body = -1;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    if (source[index] === "(") params += 1;
    if (source[index] === ")" && --params === 0) {
      body = source.indexOf("{", index + 1);
      break;
    }
  }
  let depth = 0;
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const storage = new Map();
let dirtyCount = 0;
const purchase = { id: "test", fund_id: "AAA100", buy_date: "2026-10-27", amount: 1000, nav: 100 };
const oldHistory = () => ({ days: [{ day: "2026-10-27", date: "2026-10-27", nav: 100 }], weeks: [], months: [] });
const app = {
  purchases: [purchase], cashAdjustments: [],
  funds: [{ fundId: "AAA100", nav: 100, navDate: "10/27" }],
  monthlyNavMeta: { updatedAt: "2026-10-27T00:00:00Z", items: { AAA100: oldHistory() } },
  monthlyNavIndex: null,
  sourceMeta: { updatedAt: "2026-10-30T00:00:00Z" },
  LOCAL_NAV_OVERRIDES_KEY: "test-nav", LOCAL_NAV_OVERRIDE_MAX_AGE_DAYS: 7,
  window: { localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
  markPortfolioSnapshotsDirty: () => { dirtyCount += 1; },
  moneyDjFundId: (value) => String(value || "").startsWith("manual:") ? "" : value,
  monthlyNavForPurchase: (item) => app.monthlyNavMeta.items[item.fund_id]
};
vm.createContext(app);
vm.runInContext([
  "sourceDateForNavAge", "parseShortNavDate", "navDateComparableValue", "isOverrideFresh",
  "loadLocalNavOverrides", "saveLocalNavOverrides", "persistLatestNavItems", "shouldApplyNavOverride",
  "applyLocalNavOverridesToFunds", "applyLatestNavItems", "navHistoryRows", "upsertPeriodNav", "applyLatestNavToPeriodData",
  "monthKeyFromDate", "weekKeyFromDate", "dayKeyFromDate", "periodIndex", "periodsAreContinuous",
  "periodProfitRowsForPurchase", "dailyProfitRowsForPurchase", "portfolioPurchaseFingerprint",
  "portfolioNavFingerprint", "portfolioSnapshotSource"
].map(extractFunction).join("\n"), app);
const calendar = ["2026-10-27", "2026-10-28", "2026-10-29"].map((date) => ({ date }));
const incomplete = app.dailyProfitRowsForPurchase(purchase, calendar).rows;
assert.equal(incomplete.find((row) => row.date === "2026-10-28").invested, 1000);
assert.equal(incomplete.find((row) => row.date === "2026-10-28").missing, true);
const before = app.portfolioSnapshotSource();
app.applyLatestNavItems(payload.items);
const complete = app.dailyProfitRowsForPurchase(purchase, calendar).rows;
for (const date of ["2026-10-28", "2026-10-29"]) {
  const row = complete.find((item) => item.date === date);
  assert.equal(row.invested, 1000);
  assert.equal(row.profit, 100, "a backfilled day splits changes into the correct daily profits");
  assert.equal(row.missing, false);
}
assert.notEqual(app.portfolioSnapshotSource(), before, "new history invalidates snapshots even if the published index is unchanged");
assert.equal(app.monthlyNavMeta.items.AAA100.months[0].date, "2026-10-29");

app.persistLatestNavItems([{ fundId: "AAA100", nav: 115, navDate: "10/30", navFullDate: "2026-10-30" }]);
assert.equal(app.loadLocalNavOverrides().AAA100.history.find((row) => row.date === "2026-10-28").nav, 110);
app.monthlyNavMeta.items.AAA100 = oldHistory();
app.funds[0] = { fundId: "AAA100", nav: 125, navDate: "10/31" };
app.applyLocalNavOverridesToFunds();
assert.equal(app.funds[0].nav, 125, "an older quote cannot overwrite a newer published NAV");
assert.equal(app.monthlyNavMeta.items.AAA100.days.find((row) => row.date === "2026-10-28").nav, 110, "reload retains the backfilled day");
assert.equal(app.monthlyNavMeta.items.AAA100.months[0].date, "2026-10-30", "replaying old days cannot move a period endpoint backwards");
const afterReload = app.portfolioSnapshotSource();
const dirtyAfterReload = dirtyCount;
app.applyLocalNavOverridesToFunds();
assert.equal(app.portfolioSnapshotSource(), afterReload);
assert.equal(dirtyCount, dirtyAfterReload, "replaying identical history should reuse snapshots");

console.log("NAV refresh history tests passed: exact daily backfill, reload persistence, snapshot invalidation, and source failure");
