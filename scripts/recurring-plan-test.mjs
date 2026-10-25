import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");

function extractFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const plan = {
  id: "plan-1",
  fund_id: "ACJS06",
  fund_name: "富邦精選五虎基金",
  monthly_amount: 200000,
  debit_day: 31,
  start_date: "2026-10-16"
};
const values = [];
const messages = [];
const elements = {
  purchaseFundName: { value: plan.fund_name },
  purchaseFundId: { value: plan.fund_id },
  purchaseRecurringPlanId: { value: plan.id },
  purchaseRecurringContext: { hidden: false, textContent: "" },
  purchaseAmount: { value: "200000" },
  purchaseDate: { value: "2026-10-16" },
  purchaseNav: { value: "202.25" },
  purchaseNote: { value: "" },
  purchaseMessage: {}
};
const context = {
  Date,
  Intl,
  els: elements,
  recurringPlans: [plan],
  currentUser: { id: "user-1" },
  db: { from: () => ({ insert: async (value) => { values.push(value); return { error: null }; } }) },
  requireLogin: () => true,
  setMessage: (_element, message) => messages.push(message),
  moneyDjFundId: (value) => value,
  markPortfolioSnapshotsDirty: () => {},
  loadPurchases: async () => {},
  rebuildPortfolioSnapshots: async () => {}
};
vm.createContext(context);
vm.runInContext([
  "function todayInputValue() { return '2026-10-16'; }",
  "function clearRecurringPurchaseSelection() { els.purchaseRecurringPlanId.value = ''; els.purchaseRecurringContext.hidden = true; }",
  extractFunction("nextRecurringDebitDate"),
  extractFunction("recurringDueDates"),
  extractFunction("firstPublishedNavForDebit"),
  extractFunction("recurringRecordCoversDue"),
  extractFunction("savePurchase")
].join("\n"), context);

assert.equal(context.nextRecurringDebitDate(plan, "2026-10-16"), "2026-10-31");
assert.equal(context.nextRecurringDebitDate(plan, "2026-11-01"), "2026-11-30");
assert.equal(context.nextRecurringDebitDate(plan, "2027-02-01"), "2027-02-28");
assert.equal(context.nextRecurringDebitDate({ ...plan, start_date: "2026-12-05", debit_day: 10 }, "2026-10-16"), "2026-12-10");
assert.equal(context.recurringDueDates({ ...plan, auto_start_date: "2026-10-16" }, "2026-11-30").join(","), "2026-10-31,2026-11-30");
context.monthlyNavMeta = { items: { ACJS06: { days: [
  { date: "2026-11-30", nav: 207 }, { date: "2026-10-29", nav: 198 },
  { date: "2026-11-02", nav: 201 }
] } } };
assert.equal(context.firstPublishedNavForDebit(plan, "2026-10-31", "2026-11-02")?.date, "2026-11-02");
assert.equal(context.firstPublishedNavForDebit(plan, "2026-10-31", "2026-11-01"), null, "do not use stale NAV before a weekend debit");
assert.equal(context.recurringRecordCoversDue({ buy_date: "2026-11-02" }, "2026-10-31"), true, "next-month settlement must count for the scheduled month");

const event = { preventDefault() {} };
elements.purchaseNav.value = "";
await context.savePurchase(event);
assert.equal(values.length, 0, "a scheduled plan must not create a purchase without an actual NAV");
assert(messages.at(-1).includes("實際扣款日期"));

elements.purchaseNav.value = "202.25";
elements.purchaseFundId.value = "WRONG";
await context.savePurchase(event);
assert.equal(values.length, 0, "a plan must not be recorded against another fund");
elements.purchaseFundId.value = plan.fund_id;

elements.purchaseDate.value = "2026-10-17";
await context.savePurchase(event);
assert.equal(values.length, 0, "future scheduled deductions must not count as investments");
elements.purchaseDate.value = "2026-10-16";

await context.savePurchase(event);
assert.equal(values.length, 1);
assert.equal(values[0].recurring_plan_id, plan.id);
assert.equal(values[0].fund_id, plan.fund_id);
assert.equal(values[0].amount, 200000);
assert.equal(values[0].nav, 202.25);
assert.equal(elements.purchaseRecurringPlanId.value, "");

elements.purchaseFundId.value = plan.fund_id;
elements.purchaseFundName.value = plan.fund_name;
elements.purchaseAmount.value = "10000";
elements.purchaseNav.value = "200";
await context.savePurchase(event);
assert.equal(values.length, 2);
assert(!("recurring_plan_id" in values[1]), "single purchases must work before the recurring migration");

const planWrites = [];
context.recurringPlans = [];
context.purchases = [{ id: "cash-1", fund_id: "manual:cash", fund_name: "資金", buy_date: "2026-10-01", amount: 300000, nav: 100 }];
Object.assign(elements, {
  recurringPlanId: { value: "" },
  recurringFundName: { value: `${plan.fund_name}｜${plan.fund_id}` },
  recurringAmount: { value: "200000" },
  recurringDay: { value: "31" },
  recurringStartDate: { value: "2026-10-16" },
  recurringCashSource: { value: "cash-1" },
  recurringMessage: {}
});
context.recurringPlansSupported = true;
context.recurringAutoSupported = true;
context.isCashSource = (item) => item.fund_id.startsWith("manual:") && item.fund_name.startsWith("資金");
context.recurringFundChoices = () => [{ fundId: plan.fund_id, name: plan.fund_name }];
context.recurringFundLabel = (fund) => `${fund.name}｜${fund.fundId}`;
context.moneyDjFundId = (value) => value === plan.fund_id ? value : "";
context.closeRecurringPlanForm = () => {};
context.loadRecurringPlans = async () => {};
context.db = { from: () => ({ insert: async (value) => { planWrites.push(value); return { error: null }; } }) };
vm.runInContext(extractFunction("saveRecurringPlan"), context);

elements.recurringFundName.value = "另一檔基金";
await context.saveRecurringPlan(event);
assert.equal(planWrites.length, 0, "free text must not silently select a different fund");
elements.recurringFundName.value = `${plan.fund_name}｜${plan.fund_id}`;
await context.saveRecurringPlan(event);
assert.equal(planWrites.length, 1);
assert.equal(planWrites[0].fund_id, plan.fund_id);
assert.equal(planWrites[0].user_id, "user-1");
assert.equal(planWrites[0].monthly_amount, 200000);
assert.equal(planWrites[0].cash_source_id, "cash-1");
assert.equal(planWrites[0].auto_start_date, "2026-10-16");

let rpcCalls = 0;
let reloads = 0;
let navAvailable = false;
const syncContext = {
  currentUser: { id: "user-1" },
  recurringPlans: [{ ...plan, debit_day: 16, auto_start_date: "2026-10-16", cash_source_id: "cash-1" }],
  recurringEvents: [],
  recurringAutoSupported: true,
  purchases: [],
  db: { rpc: async (name) => {
    rpcCalls += 1;
    if (name === "settle_recurring_deduction") {
      syncContext.purchases[0].nav = 202.25;
    }
    return { data: "buy-1", error: null };
  } },
  loadMonthlyNavData: async () => true,
  recurringDueDates: () => ["2026-10-16"],
  firstPublishedNavForDebit: () => navAvailable ? { date: "2026-10-16", nav: 202.25 } : null,
  todayInputValue: () => "2026-10-16",
  compactDate: (value) => value,
  markPortfolioSnapshotsDirty: () => {},
  loadPurchases: async () => { reloads += 1; },
  rebuildPortfolioSnapshots: async () => {},
  loadRecurringPlans: async () => {},
  setMessage: () => {},
  els: { recurringMessage: {} }
};
vm.createContext(syncContext);
vm.runInContext("let recurringSyncPromise = null;\n" + extractFunction("syncRecurringPlans"), syncContext);
await syncContext.syncRecurringPlans();
assert.equal(rpcCalls, 1, "due date must move cash even before NAV publication");
syncContext.purchases.push({ id: "buy-1", recurring_plan_id: plan.id, cash_source_id: "cash-1", nav: null });
navAvailable = true;
await syncContext.syncRecurringPlans();
await syncContext.syncRecurringPlans();
assert.equal(rpcCalls, 2, "the debit and later NAV reconciliation must each run once");
assert.equal(reloads, 2);
syncContext.recurringPlans[0].paused = true;
syncContext.purchases[0].nav = null;
await syncContext.syncRecurringPlans();
assert.equal(rpcCalls, 3, "pausing future debits must not strand an existing pending NAV");

console.log("Recurring plan tests passed: month-end dates, source selection, NAV availability, and idempotent posting");
