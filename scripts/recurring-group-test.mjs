import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");
assert(source.includes('activePurchases.map((item) => item._recurringItems ? renderRecurringGroup(item) : renderPurchaseItem(item))'),
  "the active list must render each recurring fund as one card");
assert(source.includes('<details class="recurring-group-details">'),
  "individual deductions must stay hidden until the user opens the details");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const context = {
  purchaseSortMode: "profit",
  fundBoxStore: new Map([
    ["monthly-1", { analysis: { position: 0.8 } }],
    ["monthly-2", { analysis: { position: 0.25 } }],
    ["one-off", { analysis: { position: 0.5 } }]
  ]),
  fundBoxKeyForPurchase: (item) => item.id,
  purchaseValuation: (item) => ({
    currentValue: item.currentValue ?? null,
    profitPercent: item.currentValue === null ? null : ((item.currentValue - item.amount) / item.amount) * 100
  })
};
vm.createContext(context);
vm.runInContext([
  "purchaseSortMode = 'profit';",
  extractFunction("purchaseDateCompare"),
  extractFunction("groupActiveRecurringPurchases"),
  extractFunction("recurringGroupValuation"),
  extractFunction("purchaseProfitCompare"),
  extractFunction("purchaseBoxSortValue"),
  extractFunction("purchaseBoxCompare"),
  extractFunction("sortActivePurchases")
].join("\n"), context);

const items = [
  { id: "monthly-1", fund_id: "FUND-A", recurring_plan_id: "plan-1", buy_date: "2026-09-01", amount: 10000, currentValue: 11000, nav: 100 },
  { id: "one-off", fund_id: "FUND-A", buy_date: "2026-10-01", amount: 50000, currentValue: 60000, nav: 100 },
  { id: "monthly-2", fund_id: "FUND-A", recurring_plan_id: "plan-2", buy_date: "2026-10-01", amount: 10000, currentValue: 10000, nav: null },
  { id: "other-fund", fund_id: "FUND-B", recurring_plan_id: "plan-3", buy_date: "2026-10-02", amount: 10000, currentValue: 9000, nav: 100 }
];
const grouped = context.groupActiveRecurringPurchases(items);
assert.equal(grouped.length, 3, "two recurring buys of the same fund should occupy one card");
const combined = grouped.find((item) => item._recurringItems);
assert.equal(combined.id, "monthly-2", "the group uses its latest purchase for date sorting");
assert.equal(combined._recurringItems.map((item) => item.id).join(","), "monthly-2,monthly-1");
assert(grouped.some((item) => item.id === "one-off" && !item._recurringItems), "one-off buys stay separate");
assert(grouped.some((item) => item.id === "other-fund" && !item._recurringItems), "other funds stay separate");

const valuation = context.recurringGroupValuation(combined._recurringItems);
assert.equal(valuation.invested, 20000);
assert.equal(valuation.currentValue, 21000);
assert.equal(valuation.profitPercent, 5, "profit percent must be weighted by invested amount");
assert.equal(valuation.pendingCount, 1);
assert.equal(context.sortActivePurchases(grouped).map((item) => item.id).join(","), "one-off,monthly-2,other-fund");

context.purchaseSortMode = "date";
assert.equal(context.sortActivePurchases(grouped)[0].id, "other-fund");
context.purchaseSortMode = "box";
assert.equal(context.sortActivePurchases(grouped)[0].id, "monthly-2", "box sorting uses the lowest lot position");

items[0].currentValue = null;
assert.equal(context.recurringGroupValuation(combined._recurringItems).profitPercent, null,
  "a missing valuation must not produce a misleading aggregate return");

console.log("Recurring group test passed: one visible holding, weighted value, pending NAV, and sorting");
