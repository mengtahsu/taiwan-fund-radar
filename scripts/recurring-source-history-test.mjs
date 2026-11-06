import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

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
const plan = { id: "plan", fund_id: "ACJS06", fund_name: "測試基金", cash_source_id: "old-cash", monthly_amount: 10000, debit_day: 6, start_date: "2026-09-01", auto_start_date: "2026-09-01" };
const oldPurchase = { id: "pending", recurring_plan_id: "plan", fund_id: "ACJS06", cash_source_id: "old-cash", scheduled_date: "2026-10-06", buy_date: "2026-10-06", amount: 10000, nav: null };
const purchases = [
  { id: "old-cash", fund_id: "manual:cash-old", fund_name: "資金舊", buy_date: "2026-09-01", amount: 300000 },
  { id: "new-cash", fund_id: "manual:cash-new", fund_name: "資金新", buy_date: "2026-11-06", amount: 200000 },
  oldPurchase
];
const writes = [], messages = [];
const input = () => ({ value: "", disabled: false, focus() {} });
const els = {
  recurringPlanForm: { hidden: true }, recurringPlanId: input(), recurringFundName: input(),
  recurringCashSource: input(), recurringAmount: input(), recurringDay: input(), recurringStartDate: input(),
  recurringSourceHint: {}, recurringMessage: {}
};
let failSave = false, reloads = 0, serverEffectiveDate = "2026-11-07";
const app = {
  currentUser: { id: "user-a" }, recurringPlans: [plan], purchases, els,
  recurringPlansSupported: true, recurringAutoSupported: true, selectedRecurringFund: null,
  todayInputValue: () => "2026-11-06", requireLogin: () => true,
  isCashSource: item => item.fund_id.startsWith("manual:"), cashBalanceAt: item => item.amount,
  recurringFundLabel: fund => `${fund.name}|${fund.fundId}`, recurringFundChoices: () => [{ fundId: "ACJS06", name: "測試基金" }],
  moneyDjFundId: value => value === "ACJS06" ? value : "",
  renderRecurringCashSources: value => { els.recurringCashSource.value = value; },
  closeRecurringPlanForm: () => { els.recurringPlanForm.hidden = true; },
  setMessage: (element, value) => { element.textContent = value; messages.push(value); },
  loadRecurringPlans: async () => { reloads++; },
  db: { from: table => ({ update(values) {
    const filters = [];
    const result = () => {
      writes.push({ table, values, filters });
      return { data: { cash_source_effective_date: serverEffectiveDate }, error: failSave ? { message: "test failure" } : null };
    };
    return { eq(field, value) {
      filters.push([field, value]);
      return this;
    }, select() { return this; }, async single() { return result(); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
  } }) }
};
vm.createContext(app);
vm.runInContext(["openRecurringPlanForm", "recurringCashSourceEffectiveDate", "syncRecurringSourceHint", "saveRecurringPlan", "recurringRecordCoversDue"].map(extract).join("\n"), app);
const original = JSON.stringify(purchases);
app.openRecurringPlanForm("plan");
assert.equal(els.recurringCashSource.disabled, false, "posted deductions must not lock future source selection");
assert.equal(els.recurringFundName.disabled, true, "changing funds is still prohibited after purchases");
assert.equal(els.recurringCashSource.value, "old-cash");
els.recurringCashSource.value = "new-cash";
app.syncRecurringSourceHint();
assert.equal(els.recurringSourceHint.hidden, false);
assert.match(els.recurringSourceHint.textContent, /2026-11-07/);
const event = { preventDefault() {} };
await app.saveRecurringPlan(event);
assert.equal(writes.length, 1);
assert.equal(writes[0].table, "recurring_investment_plans");
assert.equal(writes[0].values.cash_source_id, "new-cash");
assert.equal(writes[0].values.auto_start_date, "2026-09-01", "a source change must preserve old unposted months for historical-source backfill");
assert.deepEqual(writes[0].filters, [["id", "plan"], ["user_id", "user-a"]]);
assert.equal(JSON.stringify(purchases), original, "saving a source selection must not move past cash or pending purchases");
assert.match(messages.at(-1), /2026-11-07 起使用新資金/);
assert.equal(reloads, 1);
serverEffectiveDate = "2026-11-08";
await app.saveRecurringPlan(event);
assert.match(messages.at(-1), /2026-11-08 起使用新資金/, "save confirmation must use the server date even if a request crosses midnight");
assert.equal(app.recurringCashSourceEffectiveDate("2026-09-01", "2026-11-10"), "2026-11-10");
assert.equal(app.recurringCashSourceEffectiveDate("2027-01-10", "2026-12-20", "2026-12-31"), "2027-01-10");
assert.equal(app.recurringCashSourceEffectiveDate("2026-01-01", "2026-01-01", "2026-12-31"), "2027-01-01");
plan.cash_source_id = "new-cash";
plan.cash_source_effective_date = "2026-11-07";
app.openRecurringPlanForm("plan");
assert.match(els.recurringSourceHint.textContent, /2026-11-07/);
failSave = true;
els.recurringCashSource.value = "old-cash";
await app.saveRecurringPlan(event);
assert.match(messages.at(-1), /儲存失敗/);
assert.equal(reloads, 2, "failed saves must not report success or trigger deductions");
assert.equal(JSON.stringify(purchases), original);
assert.equal(app.recurringRecordCoversDue({ scheduled_date: "2026-10-31", buy_date: "2026-11-02" }, "2026-11-30"), false);
assert.equal(app.recurringRecordCoversDue({ scheduled_date: "2026-11-06", buy_date: "2026-11-06" }, "2026-11-10"), true);

const sql = fs.readFileSync("supabase-recurring-cash-source-history.sql", "utf8");
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all on public\.recurring_plan_cash_source_history from anon, authenticated/i);
assert.match(sql, /effective_date <= p_date/);
assert.match(sql, /old\.auto_start_date is not null then new\.auto_start_date := old\.auto_start_date/);
assert.match(sql, /Posted deduction identity cannot change/);
assert.match(sql, /purchase\.cash_source_id = public\.recurring_cash_source_for_date/);
assert.match(sql, /date_trunc\('month', scheduled_date\) = date_trunc\('month', p_scheduled_date\)/);
assert(!sql.includes("update public.fund_purchases set cash_source_id"), "migration must not rewrite historical cash deductions");
console.log("Recurring source tests passed: editable future sources, preserved auto-start and posted debits, Taiwan date boundaries, error safety, RLS, and cross-month coverage");
