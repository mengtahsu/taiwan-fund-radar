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

const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
const app = {
  currentUser: { id: "test-user" },
  portfolioDailyCapital: { loaded: false, rows: [] },
  portfolioSnapshotSource: () => "fresh-source",
  els: { twiiTrendChart: {}, twiiTrendStatus: {}, twiiRebase: {} },
  document: { querySelectorAll: () => [], querySelector: () => null },
  twiiTrendMeta: { items: [], activeMonths: 2, endIndex: null },
  twiiCompareFund: null, twiiCompareFundId: "", showTwiiCapital: true,
  twiiPortfolioBaselineRow: null, twiiPortfolioInitialWindow: null,
  twiiCompareBaselineRows: null, twiiCompareInitialWindow: null,
  twiiVisibleCrisisMarkers: () => [], twiiMonthLabels: () => "",
  formatMarketPrice: String, compactTwdWan: String, escapeHtml: String, formatPercent: String
};
vm.createContext(app);
vm.runInContext([
  "setPortfolioDailyCapital", "dailyCapitalValuesForRows", "twiiPortfolioComparison", "twiiCapitalPath", "shiftIsoDateMonths", "resetTwiiCompareBaseline", "twiiFundComparisonRows",
  "twiiFundComparisonBaseline", "twiiFundComparisonValues", "twiiFundComparisonPath", "twiiTrendPath", "renderTwiiTrendChart",
  "fetchPortfolioDailyCapitalRows"
].map(extract).join("\n"), app);

app.setPortfolioDailyCapital([
  { period_date: dates[2], invested: "0", value: "0", missing: 0 },
  { period_key: dates[0], invested: "300000", value: "330000", missing: 0 },
  { date: dates[1], invested: 280000, value: 310000, missing: 0 },
  { date: dates[3], invested: 280000, value: null, missing: 1 }
], "fresh-source");
const chartDates = ["2026-11-01", ...dates, "2026-11-06"].map(date => ({ date }));
assert.deepEqual(Array.from(app.dailyCapitalValuesForRows(chartDates)), [null, 300000, 280000, 0, 280000, 280000]);
assert.deepEqual(Array.from(app.dailyCapitalValuesForRows(chartDates, "value")), [null, 330000, 310000, 0, null, null], "use each day's historical value; do not convert missing NAV/value into zero");
app.portfolioDailyCapital.sourceUpdatedAt = "stale-source";
assert.equal(app.dailyCapitalValuesForRows(chartDates, "value").length, 0);
app.portfolioDailyCapital.sourceUpdatedAt = "fresh-source";
app.currentUser = null;
assert.equal(app.dailyCapitalValuesForRows(chartDates, "value").length, 0, "logging out must hide private value history");
app.currentUser = { id: "test-user" };

const queryCalls = [];
const query = {
  select(value) { queryCalls.push(["select", value]); return this; },
  eq(...args) { queryCalls.push(["eq", ...args]); return this; },
  order() { return this; },
  async limit(value) { queryCalls.push(["limit", value]); return { data: [], error: null }; }
};
app.db = { from: table => { queryCalls.push(["from", table]); return query; } };
app.DAILY_CAPITAL_SELECT = source.match(/const DAILY_CAPITAL_SELECT = "([^"]+)"/)[1];
app.DAILY_CAPITAL_CHART_LIMIT = 370;
await app.fetchPortfolioDailyCapitalRows();
assert.equal(queryCalls.filter(([kind]) => kind === "from").length, 1, "reuse the existing daily-snapshot query");
assert(queryCalls.some(row => row[0] === "select" && row[1].includes("invested,value,missing")));
assert(queryCalls.some(row => row[0] === "eq" && row[1] === "user_id" && row[2] === "test-user"));
assert(queryCalls.some(row => row[0] === "limit" && row[1] === 370));

app.twiiTrendMeta.items = dates.slice(0, 2).map(date => ({ date, close: 100, ma20: 100, ma60: 100 }));
app.setPortfolioDailyCapital([
  { date: dates[0], invested: 100, value: 200, missing: 1 },
  { date: dates[1], invested: 100, value: 300, missing: 0 }
], "fresh-source");
app.renderTwiiTrendChart();
const html = app.els.twiiTrendChart.innerHTML;
assert.match(html, /twii-capital-line/);
assert.match(html, /twii-value-line/);
assert.match(html, /估算現值 300/);
assert.match(app.els.twiiTrendStatus.textContent, /共同比例/);
assert.match(app.els.twiiTrendStatus.textContent, /部分日期淨值不全/);
const padding = { top: 34, right: 18, bottom: 42, left: 18 };
const capital = app.twiiCapitalPath(app.twiiTrendMeta.items, [100, 100], 680, 250, padding, 84, 316);
const value = app.twiiCapitalPath(app.twiiTrendMeta.items, [200, 300], 680, 250, padding, 84, 316, false);
assert(html.includes(`class="twii-trend-line twii-capital-line" d="${capital}"`));
assert(html.includes(`class="twii-trend-line twii-value-line" d="${value}"`), "capital, value, and index must share the same ratio domain");
assert.match(html, /共同比例 84.0%～316.0%/);
assert.match(value, /L/);
assert.match(capital, /H/);
app.showTwiiCapital = false;
app.renderTwiiTrendChart();
assert.doesNotMatch(app.els.twiiTrendChart.innerHTML, /twii-capital-line|twii-value-line|估算現值|本金 100|共同比例/);
assert.doesNotMatch(app.els.twiiTrendStatus.textContent, /共同比例|部分日期淨值不全/);
app.showTwiiCapital = true;
app.setPortfolioDailyCapital([{ date: dates[0], invested: 0, value: 0 }, { date: dates[1], invested: 0, value: 0 }], "fresh-source");
app.renderTwiiTrendChart();
assert.doesNotMatch(app.els.twiiTrendChart.innerHTML, /class="twii-trend-line twii-value-line"/);
assert.match(app.els.twiiTrendChart.innerHTML, /估算現值 0/);
assert.match(app.els.twiiTrendStatus.textContent, /基準日無可用本金/);
app.setPortfolioDailyCapital([{ date: dates[0], invested: 100 }, { date: dates[1], invested: 100, value: null }], "fresh-source");
app.renderTwiiTrendChart();
assert.doesNotMatch(app.els.twiiTrendChart.innerHTML, /class="twii-trend-line twii-value-line"/);
assert.match(app.els.twiiTrendChart.innerHTML, /估算現值 暫無資料/);
const gap = app.twiiCapitalPath(dates.map(date => ({ date })), [100, null, 300, 200], 680, 250, padding, 84, 316, false);
assert.equal((gap.match(/M/g) || []).length, 2, "missing values must break the line, not invent a collapse to zero");

const indexRows = dates.map((date, index) => ({ date, close: [100, 110, 90, 120][index], ma20: 100, ma60: 100 }));
app.twiiPortfolioBaselineRow = null;
app.twiiPortfolioInitialWindow = null;
app.setPortfolioDailyCapital(indexRows.map(row => ({ date: row.date, invested: 1000000, value: row.close * 10000 })), "fresh-source");
const projected = app.twiiPortfolioComparison(indexRows, indexRows, []);
assert.equal(projected.invested, 1000000);
assert.deepEqual(Array.from(projected.valuePoints), [100, 110, 90, 120]);
assert.equal(app.twiiCapitalPath(indexRows, projected.valuePoints, 680, 250, padding, 60, 120, false),
  app.twiiTrendPath(indexRows, "close", 680, 250, padding, 60, 120), "identical percentage changes must overlap exactly on a 60%-120% index domain");
const panned = app.twiiPortfolioComparison(indexRows, indexRows.slice(2), []);
assert.equal(panned.base.date, dates[0]);
assert.deepEqual(Array.from(panned.valuePoints), [90, 120], "panning must not renormalize historical money values");
app.twiiTrendMeta = { items: indexRows, endIndex: 4, visibleCount: 2, activeMonths: 2 };
assert.equal(app.resetTwiiCompareBaseline(), true, "manual rebasing must work even without a selected comparison fund");
const rebased = app.twiiPortfolioComparison(indexRows, indexRows.slice(2), []);
assert.equal(rebased.base.date, dates[2]);
assert.deepEqual(Array.from(rebased.capitalPoints), [90, 90]);
assert.deepEqual(Array.from(rebased.valuePoints), [81, 108]);
assert.equal(rebased.valuePoints[0] / rebased.base.close, 0.9, "existing losses must remain visible after a rebase; do not give value its own 100% denominator");
const zeroEndRows = [{ date: dates[0], invested: 1000000, value: 1000000 }, { date: dates[1], invested: 0, value: 0 }];
app.setPortfolioDailyCapital(zeroEndRows, "fresh-source");
app.twiiPortfolioBaselineRow = indexRows[0];
const zeroEnd = app.twiiPortfolioComparison(indexRows, indexRows.slice(0, 2), []);
assert.equal(zeroEnd.valuePoints[1], 0, "a true zero remains a true zero when the baseline principal is valid");
const beforePortfolio = { date: "1985-01-04", close: 100 };
const noBasis = app.twiiPortfolioComparison([beforePortfolio, ...indexRows], indexRows.slice(0, 2), [beforePortfolio]);
assert(noBasis.valuePoints.every(value => value === null), "do not invent a denominator for an index baseline before portfolio records begin");
app.twiiCompareFund = { name: "Comparison fixture", history: indexRows.map(row => ({ date: row.date, nav: row.close })) };
app.twiiCompareFundId = "FIXTURE";
app.twiiCompareBaselineRows = [indexRows[1]];
app.twiiTrendMeta = { items: indexRows, endIndex: 4, activeMonths: 2 };
app.setPortfolioDailyCapital(indexRows.map(row => ({ date: row.date, invested: 1000000, value: 1000000 * row.close / indexRows[1].close })), "fresh-source");
app.renderTwiiTrendChart();
const mixed = app.els.twiiTrendChart.innerHTML;
const moneyPath = mixed.match(/class="twii-trend-line twii-value-line" d="([^"]+)"/)[1];
const indexPath = mixed.match(/class="twii-trend-line twii-close-line" d="([^"]+)"/)[1];
const fundPath = mixed.match(/class="twii-trend-line twii-fund-line" d="([^"]+)"/)[1];
assert.equal(moneyPath, indexPath);
assert.equal(fundPath, indexPath, "selected fund, portfolio value, and index must use one date and one percentage scale");
assert.match(app.els.twiiTrendStatus.textContent, /基準 2026\/11\/03/);
console.log("Portfolio value chart passed: historical snapshots, one query, shared index percentage scale, fixed/rebased principal, missing/zero safety, and joint toggle");
