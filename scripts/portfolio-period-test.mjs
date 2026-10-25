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
  "cashAdjustmentCarryDates", "portfolioPeriodCalendar", "cashDeductionsForSource", "cashDeductionDate", "cashBalanceAt", "isCashSource",
  "manualProfitRowsForPurchase", "periodIndex",
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
  cashAdjustments: [],
  monthlyNavMeta: { updatedAt: "2026-10-13T23:35:58Z", items: { ACJS06: navItem } },
  monthlyNavIndex: null,
  sourceMeta: { updatedAt: "2026-10-13T23:35:58Z" },
  currentFundForPurchase: () => ({ nav: 243.42, navDate: "10/13" }),
  moneyDjFundId: (value) => value,
  navDateComparableValue: (value) => Date.parse((String(value).length === 5 ? `2026-${String(value).replace("/", "-")}` : value) + "T00:00:00Z"),
  currentUser: { id: "test-user" },
  todayInputValue: () => "2026-10-25",
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

const originalPurchases = context.purchases;
const originalFundLookup = context.currentFundForPurchase;
context.purchases = [
  {
    id: "cash-1008",
    fund_id: "manual:cash-1008",
    fund_name: "資金1008",
    buy_date: "2026-10-08",
    amount: 1008000,
    nav: 100,
    sell_date: "2026-10-14",
    sell_nav: 100
  },
  {
    id: "cash-1014",
    fund_id: "manual:cash-1014",
    fund_name: "資金1014",
    buy_date: "2026-10-14",
    amount: 1014000,
    nav: 100
  }
];
context.currentFundForPurchase = (item) => item.fund_id.startsWith("manual:") ? null : originalFundLookup(item);
const cashReplacement = context.portfolioSummary();
assert.match(context.portfolioSnapshotSource(), /\|manual-buy:v4$/);
const replacementDay = cashReplacement.days.get("2026-10-14");
assert.equal(replacementDay?.invested, 1014000);
assert.equal(replacementDay?.details.find((detail) => detail.name === "資金1014")?.invested, 1014000);
assert.equal(cashReplacement.weeks.get("2026-W42")?.invested, 1014000);
assert.equal(cashReplacement.months.get("2026-10")?.invested, 1014000);
context.purchases = originalPurchases;
context.currentFundForPurchase = originalFundLookup;

const originalNavMeta = context.monthlyNavMeta;
const originalNavIndex = context.monthlyNavIndex;
context.purchases = [
  { id: "cash-balance", fund_id: "manual:cash", fund_name: "資金", buy_date: "2026-10-30", amount: 300000, nav: 100 },
  { id: "held-fund", fund_id: "ACJS06", fund_name: "富邦精選五虎基金", buy_date: "2026-10-31", amount: 50000, nav: 200 }
];
context.cashAdjustments = [
  { id: "cash-spend", cash_purchase_id: "cash-balance", effective_date: "2026-11-01", delta: -20000 },
  { id: "cash-deposit", cash_purchase_id: "cash-balance", effective_date: "2026-11-02", delta: 10000 }
];
context.todayInputValue = () => "2026-11-02";
context.monthlyNavMeta = {
  updatedAt: "2026-11-02T08:00:00Z",
  items: { ACJS06: {
    days: [{ day: "2026-10-31", date: "2026-10-31", nav: 200 }],
    weeks: [{ week: "2026-W44", date: "2026-10-31", nav: 200 }],
    months: [{ month: "2026-10", date: "2026-10-31", nav: 200 }]
  } }
};
context.monthlyNavIndex = {
  updatedAt: context.monthlyNavMeta.updatedAt,
  calendar: {
    day: [{ period: "2026-10-31", date: "2026-10-31" }],
    week: [{ period: "2026-W44", date: "2026-10-31" }],
    month: [{ period: "2026-10", date: "2026-10-31" }]
  }
};
context.currentFundForPurchase = (item) => item.fund_id.startsWith("manual:") ? null : { nav: 200, navDate: "10/31" };
const adjusted = context.portfolioSummary();
assert.equal(context.cashBalanceAt(context.purchases[0], "2026-10-31"), 300000);
assert.equal(context.cashBalanceAt(context.purchases[0], "2026-11-01"), 280000);
assert.equal(context.cashBalanceAt(context.purchases[0], "2026-11-02"), 290000);
assert.equal(adjusted.days.get("2026-10-31")?.invested, 350000);
assert.equal(adjusted.days.get("2026-11-01")?.invested, 330000, "non-trading day retains the held fund");
assert.equal(adjusted.days.get("2026-11-02")?.invested, 340000);
assert.equal(adjusted.days.get("2026-11-01")?.profit, 0, "spending is not an investment loss");
assert.equal(adjusted.weeks.get("2026-W44")?.invested, 330000);
assert.equal(adjusted.weeks.get("2026-W45")?.invested, 340000);
assert.equal(adjusted.months.get("2026-10")?.invested, 350000);
assert.equal(adjusted.months.get("2026-11")?.invested, 340000);
assert.equal(adjusted.invested, 340000);
assert.equal(adjusted.currentValue, 340000);
context.cashAdjustments.push({ id: "cash-spend-2", cash_purchase_id: "cash-balance", effective_date: "2026-11-05", delta: -1000 });
context.todayInputValue = () => "2026-11-05";
const nonTradingGap = context.portfolioSummary();
assert.equal(nonTradingGap.days.get("2026-11-04")?.invested, 340000, "yesterday keeps the old balance without a NAV update");
assert.equal(nonTradingGap.days.get("2026-11-05")?.invested, 339000);
assert.equal(nonTradingGap.days.get("2026-11-05")?.profit, 0);
const adjustedFingerprint = context.portfolioPurchaseFingerprint();
context.cashAdjustments = [];
assert.notEqual(context.portfolioPurchaseFingerprint(), adjustedFingerprint, "cash adjustments invalidate snapshots");
context.purchases = originalPurchases;
context.todayInputValue = () => "2026-10-25";
context.monthlyNavMeta = originalNavMeta;
context.monthlyNavIndex = originalNavIndex;
context.currentFundForPurchase = originalFundLookup;

context.purchases = [
  { id: "cash-30", fund_id: "manual:cash", fund_name: "資金", buy_date: "2026-10-20", amount: 300000, nav: 100 },
  { id: "auto-20", fund_id: "ACJS06", fund_name: "富邦精選五虎基金", buy_date: "2026-10-25", amount: 20000, nav: 200,
    cash_source_id: "cash-30", scheduled_date: "2026-10-25", recurring_plan_id: "plan-1" }
];
context.monthlyNavMeta = {
  updatedAt: originalNavMeta.updatedAt,
  items: { ACJS06: {
    days: [{ day: "2026-10-25", date: "2026-10-25", nav: 200 }],
    weeks: [{ week: "2026-W43", date: "2026-10-25", nav: 200 }],
    months: [{ month: "2026-10", date: "2026-10-25", nav: 200 }]
  } }
};
context.monthlyNavIndex = {
  updatedAt: context.monthlyNavMeta.updatedAt,
  calendar: {
    day: [{ period: "2026-10-24", date: "2026-10-24" }, { period: "2026-10-25", date: "2026-10-25" }],
    week: [{ period: "2026-W43", date: "2026-10-25" }],
    month: [{ period: "2026-10", date: "2026-10-25" }]
  }
};
context.currentFundForPurchase = (item) => item.fund_id.startsWith("manual:") ? null : { nav: 200, navDate: "10/25" };
const transferred = context.portfolioSummary();
assert.equal(context.cashBalanceAt(context.purchases[0], "2026-10-24"), 300000);
assert.equal(context.cashBalanceAt(context.purchases[0], "2026-10-25"), 280000);
assert.equal(transferred.invested, 300000);
assert.equal(transferred.currentValue, 300000);
assert.equal(transferred.days.get("2026-10-24")?.invested, 300000);
assert.equal(transferred.days.get("2026-10-25")?.invested, 300000);
assert.equal(transferred.days.get("2026-10-25")?.details.find((row) => row.name === "資金")?.invested, 280000);
assert.equal(transferred.weeks.get("2026-W43")?.invested, 300000);
assert.equal(transferred.months.get("2026-10")?.invested, 300000);
context.currentFundForPurchase = (item) => item.fund_id.startsWith("manual:") ? null : { nav: 180, navDate: "10/24" };
assert.equal(context.purchaseValuation(context.purchases[1]).currentValue, 20000, "published NAV beats stale fund card NAV");
context.purchases[1].nav = null;
context.monthlyNavIndex.calendar.day = [
  { period: "2026-10-24", date: "2026-10-24" },
  { period: "2026-10-25", date: "2026-10-25" }
];
context.monthlyNavMeta.items.ACJS06 = { days: [], weeks: [], months: [] };
const awaitingNav = context.portfolioSummary();
assert.equal(awaitingNav.invested, 300000, "pending NAV must not reduce total capital");
assert.equal(awaitingNav.currentValue, 300000, "pending investment is valued at cost");
assert.equal(awaitingNav.days.get("2026-10-24")?.invested, 300000);
assert.equal(awaitingNav.days.get("2026-10-25")?.invested, 300000);
assert.equal(awaitingNav.days.get("2026-10-25")?.details.find((row) => row.name === "資金")?.invested, 280000);
assert.equal(awaitingNav.days.get("2026-10-25")?.details.find((row) => row.name === "富邦精選五虎基金")?.invested, 20000);
context.purchases[1].nav = 200;
context.purchases[1].buy_date = "2026-10-26";
context.todayInputValue = () => "2026-10-26";
context.monthlyNavIndex.calendar.day.push({ period: "2026-10-26", date: "2026-10-26" });
context.monthlyNavIndex.calendar.week.push({ period: "2026-W44", date: "2026-10-26" });
context.monthlyNavMeta.items.ACJS06 = {
  days: [{ day: "2026-10-26", date: "2026-10-26", nav: 200 }],
  weeks: [{ week: "2026-W44", date: "2026-10-26", nav: 200 }],
  months: [{ month: "2026-10", date: "2026-10-26", nav: 200 }]
};
const reconciled = context.portfolioSummary();
assert.equal(reconciled.days.get("2026-10-25")?.invested, 300000, "cash and pending fund must coexist on deduction day");
assert.equal(reconciled.days.get("2026-10-26")?.invested, 300000, "NAV reconciliation must preserve total capital");
assert.equal(reconciled.weeks.get("2026-W43")?.invested, 300000);
assert.equal(reconciled.weeks.get("2026-W44")?.invested, 300000);
context.purchases.pop();
assert.equal(context.cashBalanceAt(context.purchases[0]), 300000, "deleting the buy releases cash");
context.purchases = originalPurchases;
context.monthlyNavMeta = originalNavMeta;
context.monthlyNavIndex = originalNavIndex;
context.currentFundForPurchase = originalFundLookup;

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
