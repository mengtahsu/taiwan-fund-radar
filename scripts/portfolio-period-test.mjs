import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")" && --paramsDepth === 0) {
      bodyStart = source.indexOf("{", index + 1);
      break;
    }
  }
  assert(bodyStart >= 0, `missing body for ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const names = [
  "monthKeyFromDate", "weekKeyFromDate", "dayKeyFromDate", "periodKeyFromDate",
  "portfolioPeriodCalendar", "manualProfitRowsForPurchase", "periodIndex",
  "periodsAreContinuous", "periodProfitRowsForPurchase", "monthlyProfitRowsForPurchase",
  "weeklyProfitRowsForPurchase", "dailyProfitRowsForPurchase", "annualProfitMapFromMonths",
  "monthlyNavForPurchase", "purchaseValuation", "portfolioSummary",
  "portfolioPurchaseFingerprint", "portfolioSnapshotSource", "snapshotRowsFromSummary",
  "recentPeriodMapFromSummaryMap", "setPortfolioDailyCapital",
  "savePortfolioPeriodSnapshots", "rebuildPortfolioSnapshots"
];

const purchase = {
  id: "five-tigers-test",
  fund_id: "ACJS06",
  fund_name: "富邦精選五虎基金",
  buy_date: "2026-10-08",
  amount: 200000,
  nav: 252.4
};
const navItem = {
  days: [
    { day: "2026-10-08", date: "2026-10-08", nav: 252.4 },
    { day: "2026-10-12", date: "2026-10-12", nav: 252.77 },
    { day: "2026-10-13", date: "2026-10-13", nav: 243.42 }
  ],
  weeks: [
    { week: "2026-W41", date: "2026-10-08", nav: 252.4 },
    { week: "2026-W42", date: "2026-10-13", nav: 243.42 }
  ],
  months: [{ month: "2026-10", date: "2026-10-13", nav: 243.42 }]
};
const context = {
  purchases: [purchase],
  monthlyNavMeta: { updatedAt: "2026-10-13T23:35:58Z", items: { ACJS06: navItem } },
  monthlyNavIndex: null,
  sourceMeta: { updatedAt: "2026-10-13T23:35:58Z" },
  currentFundForPurchase: () => ({ nav: 243.42, navDate: "10/13" }),
  currentUser: { id: "test-user" },
  portfolioPeriodSnapshots: { supported: true },
  portfolioSnapshotsSaving: false,
  portfolioSnapshotsSaveQueued: false,
  portfolioSnapshotsDirty: true,
  portfolioPeriodsLoading: false,
  loadMonthlyNavData: async () => true,
  ANNUAL_PERIOD_DISPLAY_LIMIT: 3,
  PERIOD_DISPLAY_LIMIT: 6,
  DAILY_PERIOD_DISPLAY_LIMIT: 6,
  renderTwiiTrendChart: () => {},
  renderPurchases: () => {}
};
vm.createContext(context);
vm.runInContext(names.map(extractFunction).join("\n"), context);

const summary = context.portfolioSummary();
for (const date of ["2026-10-08", "2026-10-12", "2026-10-13"]) {
  assert.equal(summary.days.get(date)?.invested, 200000, `${date} should include the purchase`);
}
assert.equal(summary.weeks.get("2026-W41")?.invested, 200000);
assert.equal(summary.weeks.get("2026-W41")?.date, "2026-10-08");
assert.equal(summary.weeks.get("2026-W42")?.invested, 200000);
assert.equal(summary.days.get("2026-10-08")?.profit, 0);
assert(Math.abs(summary.days.get("2026-10-12").profit - 200000 * (252.77 / 252.4 - 1)) < 0.01);

context.monthlyNavIndex = {
  updatedAt: context.monthlyNavMeta.updatedAt,
  calendar: {
    day: [
      { period: "2026-10-08", date: "2026-10-08" },
      { period: "2026-10-14", date: "2026-10-14" }
    ]
  }
};
const manualRows = context.manualProfitRowsForPurchase(
  { fund_id: "manual:cash", buy_date: "2026-10-08", amount: 310000, nav: 100 },
  "day",
  context.portfolioPeriodCalendar("day")
);
assert.equal(manualRows.rows.find((row) => row.date === "2026-10-14")?.invested, 310000);
context.monthlyNavIndex = null;

navItem.days.shift();
const delayedFirstNav = context.dailyProfitRowsForPurchase(purchase, []);
assert.equal(delayedFirstNav.rows.find((row) => row.date === "2026-10-08")?.invested, 200000);
assert(Math.abs(delayedFirstNav.rows.find((row) => row.date === "2026-10-12").profit - 200000 * (252.77 / 252.4 - 1)) < 0.01);

navItem.days.unshift({ day: "2026-10-08", date: "2026-10-08", nav: 252.4 });
let savedRows = [];
const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
context.db = {
  from: () => ({
    delete: () => ({
      eq: async () => {
        await delay();
        savedRows = [];
        return { error: null };
      }
    }),
    insert: async (rows) => {
      await delay();
      savedRows.push(...rows);
      return { error: null };
    }
  })
};

const oldSave = context.savePortfolioPeriodSnapshots(context.portfolioSummary());
context.purchases.push({ ...purchase, id: "second-buy", amount: 50000 });
await context.savePortfolioPeriodSnapshots(context.portfolioSummary());
await oldSave;
for (let retry = 0; retry < 100; retry += 1) {
  if (!context.portfolioSnapshotsSaving && !context.portfolioSnapshotsSaveQueued &&
      savedRows.some((row) => row.period_type === "day" && row.period_key === "2026-10-08" && row.invested === 250000)) {
    break;
  }
  await delay();
}
assert.equal(savedRows.find((row) => row.period_type === "day" && row.period_key === "2026-10-08")?.invested, 250000);
assert.equal(savedRows.find((row) => row.period_type === "week" && row.period_key === "2026-W41")?.invested, 250000);
assert.equal(context.portfolioSnapshotsDirty, false);

console.log("Portfolio period test passed: backdated trades and queued snapshot writes");
