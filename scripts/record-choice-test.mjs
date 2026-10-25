import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

const storage = new Map();
const window = {
  location: { href: "" },
  sessionStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  }
};
const fund = { fundId: "ACJS06", name: "富邦精選五虎基金", nav: 210.5 };
const navigation = { window, isPortfolioView: false, fundLookupKey: (item) => item.fundId };
vm.createContext(navigation);
vm.runInContext(extractFunction("navigateToRecordFund"), navigation);
navigation.navigateToRecordFund(fund, "recurring");
assert.equal(window.location.href, "?view=portfolio");
assert.equal(JSON.parse(storage.get("pendingPurchaseFund")).mode, "recurring");
assert.equal(JSON.parse(storage.get("pendingPurchaseFund")).fundId, fund.fundId);

const els = {
  purchaseFundId: { value: "" },
  purchaseFundName: { value: "" },
  recurringPlanForm: { hidden: true },
  recurringPlanId: { value: "" },
  recurringFundName: { value: "", disabled: false, readOnly: false, focus() {} },
  recurringCashSource: { value: "" },
  recurringAmount: { value: "", focus() {} },
  recurringDay: { value: "" },
  recurringStartDate: { value: "" },
  recurringMessage: {}
};
const writes = [];
const messages = [];
const context = {
  window,
  els,
  isPortfolioView: true,
  currentUser: { id: "user-1" },
  recurringPlansSupported: true,
  recurringAutoSupported: true,
  recurringPlans: [],
  purchases: [{ id: "cash-1", fund_id: "manual:cash", fund_name: "資金", amount: 100000, buy_date: "2026-10-01" }],
  recurringFundChoices: () => [],
  renderRecurringCashSources: () => { els.recurringCashSource.value = "cash-1"; },
  isCashSource: (item) => item.fund_id.startsWith("manual:") && item.fund_name.startsWith("資金"),
  cashBalanceAt: () => 100000,
  todayInputValue: () => "2026-10-25",
  setMessage: (_element, message) => messages.push(message),
  displayFundName: (name) => name,
  requireLogin: () => true,
  moneyDjFundId: (id) => id,
  closeRecurringPlanForm: () => {},
  loadRecurringPlans: async () => {},
  db: { from: () => ({ insert: async (value) => { writes.push(value); return { error: null }; } }) }
};
vm.createContext(context);
vm.runInContext([
  "let pendingRecurringFund = null; let selectedRecurringFund = null;",
  extractFunction("recurringFundLabel"),
  extractFunction("applyPendingPurchaseFund"),
  extractFunction("openPendingRecurringFund"),
  extractFunction("openRecurringPlanForm"),
  source.slice(source.indexOf("async function saveRecurringPlan("), source.indexOf("\nfunction recordRecurringPurchase(", source.indexOf("async function saveRecurringPlan(")))
].join("\n"), context);

context.applyPendingPurchaseFund();
assert.equal(storage.has("pendingPurchaseFund"), true, "unclaimed selection must survive a reload before login");
assert.equal(els.purchaseFundId.value, "", "recurring choice must not prefill the one-off form");
const pending = vm.runInContext("pendingRecurringFund", context);
assert.equal(pending.fundId, fund.fundId);
context.setRecurringFund = (selected) => context.openRecurringPlanForm("", selected);
context.openPendingRecurringFund();
assert.equal(storage.has("pendingPurchaseFund"), false, "claimed selection must be cleared");
assert.equal(els.recurringFundName.value, `${fund.name}｜${fund.fundId}`);
assert.equal(els.recurringFundName.readOnly, true);
assert.equal(els.recurringCashSource.value, "cash-1");

els.recurringAmount.value = "10000";
els.recurringDay.value = "25";
els.recurringStartDate.value = "2026-10-25";
await context.saveRecurringPlan({ preventDefault() {} });
assert.equal(writes.length, 1, "card selection must save even when the suggestion list is empty");
assert.equal(writes[0].fund_id, fund.fundId, "save the exact selected fund ID");

els.recurringFundName.value = "名稱相近的另一檔基金";
await context.saveRecurringPlan({ preventDefault() {} });
assert.equal(writes.length, 1, "a changed label must not silently save the selected fund ID");
assert(messages.at(-1).includes("正確的基金"));

console.log("Record choice test passed: exact fund transfer, recurring prefill, and wrong-fund rejection");
