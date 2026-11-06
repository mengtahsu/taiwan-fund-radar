import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../fund-box.js";

const source = fs.readFileSync("app.js", "utf8");
assert(source.includes('activePurchases.map((item) => item._purchaseItems ? renderPurchaseGroup(item) : renderPurchaseItem(item))'),
  "the active list must render each fund/strategy as one card");
assert(source.includes('modal.id = "purchaseDetailModal"') && source.includes('data-purchase-group='),
  "individual purchases must remain accessible through a detail dialog");
const groupTemplate = source.slice(source.indexOf("function renderPurchaseGroup("), source.indexOf("function bindPurchaseItemActions("));
assert(!groupTemplate.includes('class="purchase-plan-tag"'), "the group card must omit the circled strategy/count row");
assert(groupTemplate.includes("renderFundBoxTrigger(groupItem)"), "the main card must show a clickable overall box, not a count of broken individual boxes");
assert(groupTemplate.includes(' / 本金 ${wholeMoneyNumber(valuation.invested)}'), "keep the date range and principal row");

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
  extractFunction("purchaseGroupKey"),
  extractFunction("groupActivePurchases"),
  extractFunction("purchaseGroupValuation"),
  extractFunction("purchaseProfitCompare"),
  extractFunction("purchaseBoxSortValue"),
  extractFunction("purchaseBoxCompare"),
  extractFunction("sortActivePurchases"),
  extractFunction("hidePurchaseDetailModal"),
  extractFunction("refreshPurchaseDetailModal"),
  extractFunction("showPurchaseDetailModal")
].join("\n"), context);

const items = [
  { id: "monthly-1", fund_id: "FUND-A", recurring_plan_id: "plan-1", buy_date: "2026-09-01", amount: 10000, currentValue: 11000, nav: 100 },
  { id: "one-off", fund_id: "FUND-A", buy_date: "2026-10-01", amount: 50000, currentValue: 60000, nav: 100 },
  { id: "monthly-2", fund_id: "FUND-A", recurring_plan_id: "plan-2", buy_date: "2026-10-01", amount: 10000, currentValue: 10000, nav: null },
  { id: "other-fund", fund_id: "FUND-B", recurring_plan_id: "plan-3", buy_date: "2026-10-02", amount: 10000, currentValue: 9000, nav: 100 }
];
const grouped = context.groupActivePurchases(items);
assert.equal(grouped.length, 3, "two recurring buys of the same fund should occupy one card");
const combined = grouped.find((item) => item.recurring_plan_id === "plan-2");
assert.equal(combined.id, "monthly-2", "the group uses its latest purchase for date sorting");
assert.equal(combined._purchaseItems.map((item) => item.id).join(","), "monthly-2,monthly-1");
assert(grouped.some((item) => item.id === "one-off" && item._purchaseItems.length === 1), "one-off buys stay separate from recurring buys");
assert(grouped.some((item) => item.id === "other-fund" && item._purchaseItems.length === 1), "other funds stay separate");

const valuation = context.purchaseGroupValuation(combined._purchaseItems);
assert.equal(valuation.invested, 20000);
assert.equal(valuation.currentValue, 21000);
assert.equal(valuation.profitPercent, 5, "profit percent must be weighted by invested amount");
assert.equal(valuation.pendingCount, 1);
assert.equal(context.sortActivePurchases(grouped).map((item) => item.id).join(","), "one-off,monthly-2,other-fund");

context.purchaseSortMode = "date";
assert.equal(context.sortActivePurchases(grouped)[0].id, "other-fund");
context.purchaseSortMode = "box";
context.fundBoxStore.set(`group:${combined._purchaseGroupKey}`, { analysis: { position: 0.25 } });
context.fundBoxStore.set(`group:${grouped.find(item => item.id === "one-off")._purchaseGroupKey}`, { analysis: { position: 0.5 } });
assert.equal(context.sortActivePurchases(grouped)[0].id, "monthly-2", "box sorting uses the overall box displayed on the card");

items[0].currentValue = null;
assert.equal(context.purchaseGroupValuation(combined._purchaseItems).profitPercent, null,
  "a missing valuation must not produce a misleading aggregate return");

const moreItems = [
  ...items,
  { ...items[1], id: "one-off-2", amount: 100000, currentValue: 90000, nav: 120, buy_date: "2026-10-03" },
  { ...items[1], id: "other-currency", fund_id: "FUND-A-USD", fund_name: "Same name" },
  { ...items[1], id: "other-class", fund_id: "FUND-A-B", fund_name: "Same name" },
  { ...items[1], id: "cash-1", fund_id: "manual:資金", amount: 300000, currentValue: 300000 },
  { ...items[1], id: "cash-2", fund_id: "manual:資金", amount: 200000, currentValue: 200000 },
  { ...items[1], id: "sold", sell_date: "2026-10-02" }
];
const before = JSON.stringify(moreItems);
const allGroups = context.groupActivePurchases(moreItems);
const single = allGroups.find(item => item.id === "one-off-2");
assert.deepEqual(Array.from(single._purchaseItems, item => item.id), ["one-off-2", "one-off"]);
assert.equal(context.purchaseGroupValuation(single._purchaseItems).invested, 150000);
assert.equal(context.purchaseGroupValuation(single._purchaseItems).currentValue, 150000);
assert.equal(context.purchaseGroupValuation(single._purchaseItems).profitPercent, 0, "use total profit / total cost, not a mean of lot returns");
assert.notEqual(single._purchaseGroupKey, combined._purchaseGroupKey, "recurring and single groups must never merge");
assert(allGroups.some(item => item.id === "other-currency" && item._purchaseItems.length === 1));
assert(allGroups.some(item => item.id === "other-class" && item._purchaseItems.length === 1));
assert.equal(allGroups.filter(item => item.fund_id === "manual:資金").length, 2, "cash entries retain their individual adjustment history");
assert(allGroups.every(item => item.id !== "sold" && !item._purchaseItems?.some(lot => lot.id === "sold")));
assert.equal(JSON.stringify(moreItems), before, "presentation grouping must not mutate or consolidate the accounting records");
assert.equal(context.purchaseGroupKey({ fund_name: "Same name" }), null, "never guess a grouping from a name");

const title = {}, caption = {}, body = {};
let focusCalls = 0;
const close = { focus() { focusCalls++; } };
const modal = {
  hidden: true,
  querySelector: selector => ({ "#purchaseDetailTitle": title, ".purchase-detail-caption": caption, ".period-modal-body": body, ".period-modal-close": close })[selector]
};
Object.assign(context, {
  purchases: moreItems, currentUser: { id: "user-a" }, fundDataLoaded: true,
  purchaseDetailGroupKey: null, purchaseDetailUserId: null, purchaseDetailOpener: null,
  document: { querySelector: () => modal, activeElement: null },
  renderPurchaseItem: item => `<row id="${item.id}" amount="${item.amount}">`,
  bindPurchaseItemActions: () => {}
});
context.showPurchaseDetailModal(single._purchaseGroupKey);
assert.equal(modal.hidden, false);
assert.match(caption.textContent, /單筆 · 2 筆買入/);
assert.match(body.innerHTML, /one-off-2/);
assert.match(body.innerHTML, /one-off"/);
assert.doesNotMatch(body.innerHTML, /monthly-|sold|cash-/);
const oldAmount = moreItems[1].amount;
moreItems.find(item => item.id === "one-off-2").amount = 200000;
context.refreshPurchaseDetailModal();
assert.match(body.innerHTML, /id="one-off-2" amount="200000"/);
assert.equal(moreItems[1].amount, oldAmount, "editing a detail must retain the other purchase's original amount");
moreItems.find(item => item.id === "one-off-2").sell_date = "2026-11-06";
context.refreshPurchaseDetailModal();
assert.match(caption.textContent, /1 筆買入/);
assert.doesNotMatch(body.innerHTML, /one-off-2/);
context.currentUser = { id: "user-b" };
context.refreshPurchaseDetailModal();
assert.equal(modal.hidden, true, "account changes close the previous owner's detail dialog");
context.currentUser = { id: "user-a" };
context.showPurchaseDetailModal(combined._purchaseGroupKey);
assert.match(caption.textContent, /定期定額 · 2 筆買入/);
assert.doesNotMatch(body.innerHTML, /one-off/);
context.currentUser = null;
context.refreshPurchaseDetailModal();
assert.equal(modal.hidden, true);
assert(focusCalls >= 2);

const lots = [
  { id: "early", fund_id: "A-TWD", fund_name: "Fund A", buy_date: "2026-08-01", nav: 100, amount: 100000 },
  { id: "late", fund_id: "A-TWD", fund_name: "Fund A", buy_date: "2026-09-01", nav: 120, amount: 200000 },
  { id: "regular", fund_id: "A-TWD", fund_name: "Fund A", buy_date: "2026-10-01", nav: 130, amount: 10000, recurring_plan_id: "plan-a" }
];
const navs = { days: [
  { date: "2026-08-01", nav: 100 }, { date: "2026-08-15", nav: 150 },
  { date: "2026-09-01", nav: 120 }, { date: "2026-11-05", nav: 125 }
] };
const persistedKeys = [];
const boxes = {
  fundBoxStore: new Map(), fundTrailingBoxes: new Map(),
  currentFundForPurchase: () => ({ fundId: "A-TWD", nav: 125, navDate: "2026-11-05" }),
  exactMonthlyNavForPurchase: () => navs,
  isDistributingFund: () => false,
  isoDateFromShortNavDate: value => value,
  moneyDjFundId: value => value,
  fundBoxKeyForPurchase: item => `purchase:${item.id}`,
  persistFundTrailingBox: entry => persistedKeys.push(entry.key),
  window: { FundBox: { analyzeFundBox: (rows, options) => globalThis.FundBox.analyzeFundBox(rows, { ...options, now: "2026-11-06" }) } }
};
vm.createContext(boxes);
vm.runInContext(["purchaseDateCompare", "purchaseGroupKey", "groupActivePurchases", "createFundBoxEntry", "buildFundBoxStore"].map(extractFunction).join("\n"), boxes);
const groupsBefore = JSON.stringify(lots);
boxes.buildFundBoxStore(lots);
const singleBoxKey = `group:${boxes.purchaseGroupKey(lots[0])}`;
const regularBoxKey = `group:${boxes.purchaseGroupKey(lots[2])}`;
let overall = boxes.fundBoxStore.get(singleBoxKey);
assert.equal(overall.trackingStartDate, "2026-08-01");
assert.equal(overall.analysis.top, 150, "overall top is the actual highest NAV since the earliest held buy, not an average");
assert.equal(overall.analysis.bottom, 120);
assert.equal(overall.purchases.length, 2, "the overall chart includes both entry markers");
assert.equal(overall.grouped, true);
assert.equal(boxes.fundBoxStore.get("purchase:late").analysis.top, 125, "each lot keeps its own start date in the detail dialog");
assert.equal(boxes.fundBoxStore.get(regularBoxKey).analysis.top, 130, "recurring plans never inherit a single-purchase peak");
assert(persistedKeys.every(key => key.startsWith("purchase:")), "group display must not add duplicate peak writes");
boxes.fundTrailingBoxes.set("purchase:early", { tracking_start_date: "2026-08-01", peak_nav: 200, peak_date: "2026-08-20" });
navs.days = navs.days.slice(-1);
boxes.buildFundBoxStore(lots);
overall = boxes.fundBoxStore.get(singleBoxKey);
assert.equal(overall.analysis.top, 200, "a shortened NAV cache must retain the recorded group peak");
assert.equal(overall.analysis.bottom, 160);
assert.equal(overall.analysis.status, "trailing_breakdown");
const changedDate = lots.map(item => item.id === "early" ? { ...item, buy_date: "2026-10-02" } : item);
boxes.buildFundBoxStore(changedDate);
assert.equal(boxes.fundBoxStore.get(singleBoxKey).analysis.top, 125, "editing a buy date must invalidate that lot's saved peak in the overall box too");
boxes.buildFundBoxStore(lots.slice(1));
assert.equal(boxes.fundBoxStore.get(singleBoxKey).trackingStartDate, "2026-09-01");
assert.equal(boxes.fundBoxStore.get(singleBoxKey).analysis.top, 125, "selling an older lot must remove its old peak from the current holding period");
boxes.isDistributingFund = () => true;
boxes.buildFundBoxStore(lots);
assert.equal(boxes.fundBoxStore.get(singleBoxKey).analysis.status, "distribution_unadjusted", "missing distribution history must still fail closed for overall boxes");
assert.equal(JSON.stringify(lots), groupsBefore, "building overall boxes must not mutate trade records");
console.log("Purchase group test passed: separate strategies, weighted value, editable details, overall trailing boxes, per-lot isolation, retained peaks, and cash/sold safety");
