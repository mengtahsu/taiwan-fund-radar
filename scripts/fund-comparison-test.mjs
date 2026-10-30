import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const edgeSource = fs.readFileSync("supabase/functions/refresh-nav/index.ts", "utf8");
let handler;
let authenticated = true;
const held = new Set(["AAA100", "BBB200"]);
const sourceCalls = [];
let sourceFails = false;
const history = Array.from({ length: 300 }, (_, index) => ({
  date: new Date(Date.UTC(1985, 0, index + 1)).toISOString().slice(0, 10), nav: index + 100
}));
const wire = `${["19841231", ...history.map(row => row.date.replaceAll("-", ""))].join(",")} ${[99, ...history.map(row => row.nav)].join(",")}`;
const edge = {
  Response, Request, URLSearchParams, AbortSignal,
  Deno: {
    serve: value => { handler = value; },
    env: { get: key => ({ SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "test-key" })[key] }
  },
  fetch: async url => {
    if (url === "https://db.test/auth/v1/user") {
      return authenticated ? Response.json({ id: "user-a" }) : new Response("no", { status: 401 });
    }
    if (url.startsWith("https://db.test/rest/v1/fund_purchases?")) {
      const query = new URL(url).searchParams;
      assert.equal(query.get("user_id"), "eq.user-a");
      assert.equal(query.get("sell_date"), "is.null");
      const id = query.get("or").match(/fund_id\.eq\.([A-Z0-9]+)/)[1];
      return Response.json(held.has(id) ? [{ fund_id: `${id}-TWD` }] : []);
    }
    const query = new URL(url).searchParams;
    assert.equal(query.get("b"), "0", "use explicit dates, not the default one-year series");
    assert.equal(query.get("c"), "1985-01-01");
    sourceCalls.push(query.get("a"));
    return sourceFails ? new Response("no", { status: 503 }) : new Response(wire);
  }
};
vm.createContext(edge);
vm.runInContext(stripTypeScriptTypes(edgeSource), edge);
const invoke = body => handler(new Request("https://edge.test", {
  method: "POST", headers: { Authorization: "Bearer test-user-token" }, body: JSON.stringify(body)
}));
const firstResponse = await invoke({ mode: "comparison", fundId: "AAA100", fundIds: ["ZZZ999"] });
assert.equal(firstResponse.status, 200);
const payload = await firstResponse.json();
assert.equal(payload.history.length, 300, "long history must not be truncated to 190 days");
assert.equal(payload.startDate, "1985-01-01");
assert.deepEqual(sourceCalls, ["AAA100"], "only the selected fund is fetched");
await invoke({ mode: "comparison", fundId: "AAA100" });
assert.equal(sourceCalls.length, 1, "repeated selection uses the bounded source cache");
held.delete("AAA100");
assert.equal((await invoke({ mode: "comparison", fundId: "AAA100" })).status, 403, "ownership must be checked before using cached history");
authenticated = false;
assert.equal((await invoke({ mode: "comparison", fundId: "BBB200" })).status, 403);
authenticated = true;
assert.equal((await invoke({ mode: "comparison", fundId: "../AAA100" })).status, 403);
assert.equal(sourceCalls.length, 1, "unauthorized/invalid requests must not reach MoneyDJ");
sourceFails = true;
assert.equal((await invoke({ mode: "comparison", fundId: "BBB200" })).status, 400);
sourceFails = false;
assert.equal((await invoke({ mode: "comparison", fundId: "BBB200" })).status, 200, "failed requests must remain retryable");

const appSource = fs.readFileSync("app.js", "utf8");
function extract(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert(match, name);
  const start = match.index;
  let params = 0, body = -1;
  for (let i = appSource.indexOf("(", start); i < appSource.length; i++) {
    if (appSource[i] === "(") params++;
    if (appSource[i] === ")" && --params === 0) { body = appSource.indexOf("{", i + 1); break; }
  }
  let depth = 0;
  for (let i = body; i < appSource.length; i++) {
    if (appSource[i] === "{") depth++;
    if (appSource[i] === "}" && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(name);
}
const storage = new Map();
const clientCalls = [];
const select = {};
let pendingResolve;
const app = {
  currentUser: { id: "user-a" },
  purchases: [
    { fund_id: "AAA100", fund_name: "Held A" }, { fund_id: "AAA100", fund_name: "Held A" },
    { fund_id: "BBB200", fund_name: "Sold", sell_date: "2026-01-01" },
    { fund_id: "CCC300", fund_name: "Held C" }, { fund_id: "manual:cash", fund_name: "Cash" }
  ],
  funds: [{ fundId: "AAA100", name: "Official A" }, { fundId: "ZZZ999", name: "Not held" }],
  monthlyNavIndex: { ids: ["ZZZ999"] },
  monthlyNavMeta: { items: {} },
  twiiCompareFundId: "", twiiCompareFund: null, twiiCompareLoadToken: 0,
  twiiCompareHistoryCache: new Map(), twiiCompareCacheUserId: null,
  els: { twiiCompareFund: select },
  moneyDjFundId: value => String(value || "").split("-", 1)[0],
  escapeHtml: value => value,
  renderTwiiTrendChart: () => {},
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  db: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-a" }, access_token: "test-user-token" } } }) } },
  NAV_REFRESH_FUNCTION_URL: "https://edge.test", SUPABASE_KEY: "test-key",
  fetch: async (url, options) => {
    assert.equal(url, "https://edge.test");
    const body = JSON.parse(options.body);
    clientCalls.push(body);
    if (body.fundId === "CCC300") await new Promise(resolve => { pendingResolve = resolve; });
    return { ok: true, json: async () => ({ ...payload, fundId: body.fundId }) };
  }
};
vm.createContext(app);
vm.runInContext([
  "ownedTwiiCompareFunds", "renderTwiiCompareOptions", "selectTwiiCompareFund", "navHistoryRows",
  "twiiFundComparisonRows", "twiiFundComparisonValues", "twiiFundComparisonPath", "twiiTrendPath"
].map(extract).join("\n"), app);
app.renderTwiiCompareOptions();
assert.match(select.innerHTML, /Official A/);
assert.match(select.innerHTML, /CCC300/);
assert.doesNotMatch(select.innerHTML, /BBB200|ZZZ999|manual:cash/);
assert.equal((select.innerHTML.match(/value="AAA100"/g) || []).length, 1, "duplicate lots appear once");
assert.equal(clientCalls.length, 0, "rendering options must not download all histories");
await app.selectTwiiCompareFund("ZZZ999");
assert.equal(clientCalls.length, 0);
await app.selectTwiiCompareFund("AAA100");
assert.deepEqual(clientCalls, [{ mode: "comparison", fundId: "AAA100" }]);
assert.equal(app.twiiCompareFund.history.length, 300);
assert.equal(app.twiiCompareFund.name, "Official A");
assert.equal(Object.keys(app.monthlyNavMeta.items).length, 0, "long chart data must not enlarge portfolio accounting history");
await app.selectTwiiCompareFund("AAA100");
assert.equal(clientCalls.length, 1);
const slow = app.selectTwiiCompareFund("CCC300");
await new Promise(resolve => setImmediate(resolve));
await app.selectTwiiCompareFund("AAA100");
pendingResolve();
await slow;
assert.equal(app.twiiCompareFund.fundId, "AAA100", "a slow old response cannot replace the selected fund");
app.purchases = [];
app.renderTwiiCompareOptions();
assert.equal(app.twiiCompareFund, null, "selling the last lot removes its comparison");
assert.equal(select.disabled, true);
app.currentUser = null;
app.renderTwiiCompareOptions();
assert.equal(app.twiiCompareHistoryCache.size, 0, "logout clears cached personal selections");
app.currentUser = { id: "user-a" };
app.purchases = [{ fund_id: "AAA100", fund_name: "Held A" }];
app.db.auth.getSession = async () => ({ data: { session: null } });
app.renderTwiiCompareOptions();
await app.selectTwiiCompareFund("AAA100");
assert.equal(app.twiiCompareFund.unavailable, true, "an expired session must show an error instead of loading forever");

const rows = [
  { date: "1985-01-04", close: 100 }, { date: "1985-01-07", close: 110 }, { date: "1985-01-08", close: 120 }
];
const navs = [{ date: "1985-01-04", nav: 10 }, { date: "1985-01-07", nav: 11 }, { date: "1985-01-08", nav: 12 }];
const comparison = app.twiiFundComparisonValues(rows, navs);
assert(Math.abs(comparison.fundReturn - 20) < 1e-8);
assert(Math.abs(comparison.twiiReturn - 20) < 1e-8);
const padding = { left: 10, right: 10, top: 10, bottom: 10 };
assert.equal(app.twiiFundComparisonPath(comparison.points, rows, 200, 100, padding, 80, 140),
  app.twiiTrendPath(rows, "close", 200, 100, padding, 80, 140), "identical returns must overlap, including across weekends");
assert.equal(app.twiiFundComparisonValues(rows, navs.slice(-1)), null, "one shared date is not a performance period");
assert.equal(app.twiiFundComparisonValues(rows, [{ date: "1994-10-11", nav: 10 }]), null, "never invent NAVs before a fund's available history");
const common = app.twiiFundComparisonValues(rows, navs.slice(1));
assert.equal(common.startDate, "1985-01-07", "fund and index must use the same starting day");
const fullIndex = [...rows, { date: "1985-01-09", close: 130 }, { date: "1985-01-10", close: 140 }];
const divergentNavs = [...navs, { date: "1985-01-09", nav: 15 }, { date: "1985-01-10", nav: 18 }];
const full = app.twiiFundComparisonValues(fullIndex, divergentNavs, fullIndex);
const earlier = app.twiiFundComparisonValues(fullIndex.slice(0, 4), divergentNavs, fullIndex);
const later = app.twiiFundComparisonValues(fullIndex.slice(2), divergentNavs, fullIndex);
assert.equal(later.startDate, "1985-01-04", "panning must retain the first shared historical date");
assert.deepEqual(Array.from(later.points), Array.from(full.points.slice(2)), "the same date's plotted value must not change after panning");
assert.deepEqual(Array.from(earlier.points), Array.from(full.points.slice(0, 4)), "resizing the window must not change historical values");
assert.equal(later.fundReturn, full.fundReturn, "a shorter window with the same end date retains cumulative returns");
assert.equal(later.twiiReturn, full.twiiReturn);
assert.equal(later.points[1].value, 150, "do not rebase the fund to the visible starting index");
const lateFund = app.twiiFundComparisonValues(fullIndex.slice(2), divergentNavs.slice(1), fullIndex);
assert.equal(lateFund.startDate, "1985-01-07", "later-starting funds retain their own first shared historical date");
assert.equal(app.twiiFundComparisonValues(rows.slice(0, 2), divergentNavs.slice(3), fullIndex), null, "no line is fabricated before the fixed baseline");
console.log("Fund comparison tests passed: 1985 history, held-only authorization, on-demand cache, account/race safety, matched dates, and fixed baseline across chart windows");
