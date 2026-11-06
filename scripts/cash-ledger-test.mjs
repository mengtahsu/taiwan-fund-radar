import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const source = fs.readFileSync("app.js", "utf8");
function extract(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert(match, name);
  let params = 0, body = -1;
  for (let i = source.indexOf("(", match.index); i < source.length; i++) {
    if (source[i] === "(") params++;
    if (source[i] === ")" && --params === 0) { body = source.indexOf("{", i + 1); break; }
  }
  let depth = 0;
  for (let i = body; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(name);
}
const cash = { id: "cash", fund_id: "manual:資金21", fund_name: "資金21", buy_date: "2026-11-01", amount: 300000, nav: 100 };
const amount = { value: "2000" }, date = { value: "2026-11-02" }, note = { value: "補登支出" }, message = {}, button = { disabled: false };
const modal = {
  dataset: { purchaseId: "cash", userId: "user-a", direction: "-1" }, hidden: false,
  querySelector: selector => ({ ".cash-flow-amount": amount, ".cash-flow-date": date, ".cash-flow-note": note, ".cash-flow-message": message, 'button[type="submit"]': button })[selector]
};
const calls = [];
let dirty = 0, rebuilds = 0, renderCalls = 0, failOnce = true;
const committedRequests = new Map();
const app = {
  currentUser: { id: "user-a" }, purchases: [cash, { id: "debit", cash_source_id: "cash", scheduled_date: "2026-11-03", buy_date: "2026-11-04", fund_name: "定期基金", amount: 20000 }],
  cashAdjustments: [{ id: "flow-1", cash_purchase_id: "cash", effective_date: "2026-11-02", delta: -10000 }, { id: "flow-2", cash_purchase_id: "cash", effective_date: "2026-11-05", delta: 50000, note: "入帳" }],
  todayInputValue: () => "2026-11-06", crypto: { randomUUID },
  wholeMoneyNumber: String,
  document: { querySelector: () => modal }, window: { prompt: () => "資金" },
  els: { purchaseMessage: {} }, setMessage: (element, text) => { element.textContent = text; },
  renderPurchases: () => { renderCalls++; }, renderRecurringCashSources: () => {}, renderRecurringPlans: () => {}, renderCashLedger: () => {},
  markPortfolioSnapshotsDirty: () => { dirty++; }, loadPurchases: async () => {}, rebuildPortfolioSnapshots: async () => { rebuilds++; },
  db: { rpc: async (name, payload) => {
    calls.push({ name, ...payload });
    if (name === "rename_cash_source") return { data: payload.p_cash_purchase_id, error: null };
    if (!committedRequests.has(payload.p_request_id)) {
      committedRequests.set(payload.p_request_id, payload);
      app.cashAdjustments.push({ id: payload.p_request_id, cash_purchase_id: payload.p_cash_purchase_id, effective_date: payload.p_effective_date, delta: payload.p_delta, note: payload.p_note });
    }
    if (failOnce) { failOnce = false; throw new Error("lost acknowledgement"); }
    return { data: payload.p_request_id, error: null };
  } }
};
vm.createContext(app);
vm.runInContext(["cashDeductionsForSource", "cashDeductionDate", "cashBalanceAt", "isCashSource", "cashLedgerRows", "portfolioPurchaseFingerprint", "renameCashSource", "submitCashFlow"].map(extract).join("\n"), app);
assert.equal(app.cashBalanceAt(cash, "2026-11-01"), 300000);
assert.equal(app.cashBalanceAt(cash, "2026-11-03"), 270000);
assert.equal(app.cashBalanceAt(cash, "2026-11-04"), 270000, "NAV settlement must not deduct twice");
assert.equal(app.cashBalanceAt(cash), 320000);
const ledger = app.cashLedgerRows(cash);
assert.equal(ledger.length, 4, "opening balance, two adjustments, and one automatic deduction must remain visible");
assert.equal(ledger.reduce((sum, row) => sum + row.delta, 0), 320000);
assert.equal(ledger.find(row => row.id === "debit").date, "2026-11-03");
assert(ledger.every(row => row.balance === app.cashBalanceAt(cash, row.date)));
const original = { ...cash };
const fingerprint = app.portfolioPurchaseFingerprint();
await app.renameCashSource("cash");
assert.equal(cash.fund_name, "資金");
assert.equal(cash.id, original.id);
assert.equal(cash.fund_id, original.fund_id);
assert.equal(cash.amount, original.amount);
assert.equal(cash.buy_date, original.buy_date);
assert.equal(app.portfolioPurchaseFingerprint(), fingerprint, "rename must not invalidate or change historical financial snapshots");
assert.equal(dirty, 0);
assert.equal(renderCalls, 1);
app.window.prompt = () => null;
await app.renameCashSource("cash");
assert.equal(calls.length, 1);

const event = { preventDefault() {} };
await app.submitCashFlow(event);
assert.match(message.textContent, /連線失敗/);
const request = modal.dataset.requestId;
assert(request);
await app.submitCashFlow(event);
const flowCalls = calls.filter(call => call.name === "record_cash_flow");
assert.equal(flowCalls.length, 2);
assert.equal(flowCalls[0].p_request_id, flowCalls[1].p_request_id, "a lost response must retry the same idempotent request");
assert.equal(flowCalls[0].p_delta, -2000);
assert.equal(flowCalls[0].p_effective_date, "2026-11-02");
assert.equal(committedRequests.size, 1);
assert.equal(app.cashBalanceAt(cash, "2026-11-01"), 300000);
assert.equal(app.cashBalanceAt(cash, "2026-11-02"), 288000);
assert.equal(app.cashBalanceAt(cash), 318000);
assert.equal(cash.amount, 300000, "a dated flow must never overwrite the opening amount");
assert.equal(dirty, 1);
assert.equal(rebuilds, 1, "successful backdated flows must refresh period snapshots");
assert.equal(modal.dataset.requestId, undefined);
assert.equal(button.disabled, false);
assert.notEqual(app.portfolioPurchaseFingerprint(), fingerprint);
amount.value = "2000";
await app.submitCashFlow(event);
assert.notEqual(calls.at(-1).p_request_id, request, "a second intentional expense must get its own ledger row");
assert.equal(committedRequests.size, 2);
const count = calls.length;
amount.value = "-1";
await app.submitCashFlow(event);
amount.value = "100"; date.value = "2026-10-01";
await app.submitCashFlow(event);
assert.equal(calls.length, count, "invalid amounts and dates must not reach the database");
date.value = "2026-11-02";
let resolve;
app.db.rpc = () => new Promise(done => { resolve = done; });
const pending = app.submitCashFlow(event);
app.currentUser = { id: "user-b" };
resolve({ data: "id", error: null });
await pending;
assert.equal(dirty, 2, "a stale response must not update another user's snapshots");

const sql = fs.readFileSync("supabase-cash-ledger.sql", "utf8");
assert.match(sql, /for update/i);
assert.match(sql, /request_id is not null/i);
assert.match(sql, /p_effective_date > today_taiwan/);
assert.match(sql, /where dates.date >= p_effective_date/);
assert.match(sql, /Cash ledger cannot be deleted/);
assert.match(sql, /record a dated cash flow instead/);
assert.match(sql, /grant execute .* to authenticated/);
assert(!sql.includes("delete from public.cash_balance_adjustments"));
console.log("Cash ledger tests passed: dated balances, permanent rows, recurring transfers, rename identity, retry safety, snapshot refresh, and account isolation");
