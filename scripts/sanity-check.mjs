import fs from "node:fs";

const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} cannot be read as JSON: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function moneyDjFundId(value) {
  if (String(value || "").startsWith("manual:")) {
    return "";
  }
  const match = String(value || "").trim().toUpperCase().match(/[A-Z]{2,}\d{2,}/);
  return match ? match[0] : "";
}

function normalizedFundName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\(（][^()（）]*(?:本金|配息來源|收益平準金|保證收益)[^()（）]*[\)）]/g, "")
    .replace(/證券投資信託基金|投資信託基金|基金|新台幣|新臺幣|台幣|臺幣/g, "")
    .replace(/[\s　\-_－—/／、:：.．]+/g, "")
    .toLowerCase();
}

function fundLookupKey(fund) {
  return String(fund.fundId || fund.name || "");
}

function currentFundForPurchase(funds, item) {
  const itemFundId = moneyDjFundId(item.fund_id);
  if (itemFundId) {
    const idMatch = funds.find((fund) => moneyDjFundId(fund.fundId || fundLookupKey(fund)) === itemFundId);
    if (idMatch) {
      return idMatch;
    }
  }
  const nameKey = normalizedFundName(item.fund_name);
  if (!nameKey) {
    return null;
  }
  const exactMatches = funds.filter((fund) => normalizedFundName(fund.name) === nameKey);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (nameKey.length < 8) {
    return null;
  }
  const looseMatches = funds.filter((fund) => {
    const fundName = normalizedFundName(fund.name);
    return fundName && (fundName.includes(nameKey) || nameKey.includes(fundName));
  });
  return looseMatches.length === 1 ? looseMatches[0] : null;
}

function purchaseValuation(funds, item) {
  const amount = Number(item.amount) || 0;
  const buyNav = Number(item.nav) || 0;
  const fund = currentFundForPurchase(funds, item);
  const isManualFund = String(item.fund_id || "").startsWith("manual:");
  const currentNav = Number(fund?.nav) || (isManualFund ? buyNav : 0);
  const sellNav = Number(item.sell_nav) || 0;
  const sellAmount = Number(item.sell_amount) || 0;
  const isSold = Boolean(item.sell_date);
  const valueNav = isSold ? sellNav : currentNav;
  const units = amount > 0 && buyNav > 0 ? amount / buyNav : 0;
  if (units <= 0 || (sellAmount <= 0 && valueNav <= 0)) {
    return { fund, currentNav: valueNav, currentValue: null, profit: null };
  }
  const currentValue = isSold && sellAmount > 0 ? sellAmount : units * valueNav;
  return { fund, currentNav: valueNav, currentValue, profit: currentValue - amount };
}

const fundPayload = readJson("data/funds.json");
const marketPayload = readJson("data/markets.json");
const marginPayload = readJson("data/margin.json");
const twiiHistoryPayload = readJson("data/twii_history.json");
const navCachePayload = readJson("data/nav_cache.json");
const monthlyNavPayload = readJson("data/monthly_nav.json");

function ageHours(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    return Infinity;
  }
  return (Date.now() - time) / 36e5;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function parseShortNavDate(value, sourceValue) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const sourceDate = new Date(sourceValue || Date.now());
  const date = new Date(sourceDate.getFullYear(), Number(match[1]) - 1, Number(match[2]));
  if (date.getTime() - sourceDate.getTime() > 31 * 86400000) {
    date.setFullYear(date.getFullYear() - 1);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

function navAgeDays(fund, sourceValue) {
  const navDate = parseShortNavDate(fund.navDate, sourceValue);
  const sourceDate = new Date(sourceValue || Date.now());
  if (!navDate || Number.isNaN(sourceDate.getTime())) {
    return Infinity;
  }
  return Math.floor((sourceDate - navDate) / 86400000);
}

function growthScoreForFund(fund, benchmark) {
  const return3mScore = clamp(numeric(fund.return3m) / 60, 0, 1);
  const excess2wScore =
    fund.return2w === undefined || benchmark.return2w === undefined
      ? 0
      : clamp((numeric(fund.return2w) - numeric(benchmark.return2w) + 10) / 25, 0, 1);
  const excess1mScore =
    fund.return1m === undefined || benchmark.return1m === undefined
      ? 0
      : clamp((numeric(fund.return1m) - numeric(benchmark.return1m) + 12) / 30, 0, 1);
  const momentumScore = return3mScore * 0.45 + excess2wScore * 0.3 + excess1mScore * 0.25;
  const returnScore = clamp(numeric(fund.return3y) / 80, 0, 1);
  const sharpeScore = clamp(numeric(fund.sharpe) / 2, 0, 1);
  const riskFit = 1 - Math.max(0, numeric(fund.risk) - 5) / 4;
  return Math.round((returnScore * 0.25 + momentumScore * 0.45 + sharpeScore * 0.2 + riskFit * 0.1) * 100);
}

const funds = Array.isArray(fundPayload?.funds) ? fundPayload.funds : [];
assert(funds.length >= 1000, `data/funds.json fund count too small: ${funds.length}`);
assert(Boolean(fundPayload?.updatedAt), "data/funds.json missing updatedAt");
assert(ageHours(fundPayload?.updatedAt) <= 96, `data/funds.json too old: ${fundPayload?.updatedAt}`);

const invalidNavFunds = funds.filter((fund) => !Number.isFinite(Number(fund.nav)) || Number(fund.nav) <= 0);
assert(invalidNavFunds.length === 0, `funds with invalid NAV: ${invalidNavFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

const missingNavDateFunds = funds.filter((fund) => Number(fund.nav) > 0 && !fund.navDate);
assert(missingNavDateFunds.length === 0, `funds with NAV but no navDate: ${missingNavDateFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

const twiiBenchmark = (Array.isArray(marketPayload?.markets) ? marketPayload.markets : []).find((market) => market.id === "twii") || {};
const topScreenedFunds = funds
  .map((fund) => ({
    ...fund,
    computedScore: growthScoreForFund(fund, twiiBenchmark),
    navAge: navAgeDays(fund, fundPayload?.updatedAt)
  }))
  .filter((fund) => String(fund.type || "") !== "ETF" && numeric(fund.risk) <= 5 && numeric(fund.return3y) >= 20 && fund.navAge <= 14)
  .sort((a, b) => b.computedScore - a.computedScore)
  .slice(0, 50);
const missingRecentTopFunds = topScreenedFunds.filter((fund) => fund.return2w === undefined || fund.return1m === undefined);
assert(
  missingRecentTopFunds.length <= 10,
  `too many top screened funds missing recent returns: ${missingRecentTopFunds.length}/50`
);

const yuantaA = funds.find((fund) => fund.fundId === "ACYT161");
const yuantaB = funds.find((fund) => fund.fundId === "ACYT162");
assert(Boolean(yuantaA), "missing ACYT161 元大高股息優質龍頭 A");
assert(Boolean(yuantaB), "missing ACYT162 元大高股息優質龍頭 B");
if (yuantaA) {
  assert(Number(yuantaA.nav) > 0, "ACYT161 NAV must be positive");
  assert(Boolean(yuantaA.navDate), "ACYT161 missing navDate");
  if (yuantaA.fubonFundId) {
    assert(yuantaA.fubonFundId === "0456", `ACYT161 Fubon id mismatch: ${yuantaA.fubonFundId}`);
  }
}
if (yuantaB) {
  assert(Number(yuantaB.nav) > 0, "ACYT162 NAV must be positive");
  assert(Boolean(yuantaB.navDate), "ACYT162 missing navDate");
  if (yuantaB.fubonFundId) {
    assert(yuantaB.fubonFundId === "0457", `ACYT162 Fubon id mismatch: ${yuantaB.fubonFundId}`);
  }
}

const navCacheItems = navCachePayload?.items && typeof navCachePayload.items === "object" ? navCachePayload.items : {};
assert(Object.keys(navCacheItems).length >= 1000, `nav cache item count too small: ${Object.keys(navCacheItems).length}`);
assert(ageHours(navCachePayload?.updatedAt) <= 96, `nav_cache.json too old: ${navCachePayload?.updatedAt}`);
if (navCacheItems.ACYT161) {
  assert(Number(navCacheItems.ACYT161.nav) === Number(yuantaA?.nav), "ACYT161 nav_cache NAV does not match funds.json NAV");
  assert(navCacheItems.ACYT161.navDate === yuantaA?.navDate, "ACYT161 nav_cache navDate does not match funds.json navDate");
}

const monthlyNavItems = monthlyNavPayload?.items && typeof monthlyNavPayload.items === "object" ? monthlyNavPayload.items : {};
assert(Object.keys(monthlyNavItems).length >= 20, `monthly NAV item count too small: ${Object.keys(monthlyNavItems).length}`);
assert(ageHours(monthlyNavPayload?.updatedAt) <= 96, `monthly_nav.json too old: ${monthlyNavPayload?.updatedAt}`);
const monthlyYuantaA = monthlyNavItems.ACYT161;
assert(Boolean(monthlyYuantaA), "monthly_nav missing ACYT161");
if (monthlyYuantaA) {
  assert(Array.isArray(monthlyYuantaA.months) && monthlyYuantaA.months.length >= 3, "ACYT161 monthly NAV has too few months");
  assert(Array.isArray(monthlyYuantaA.weeks) && monthlyYuantaA.weeks.length >= 8, "ACYT161 weekly NAV has too few weeks");
  assert(Array.isArray(monthlyYuantaA.days) && monthlyYuantaA.days.length >= 10, "ACYT161 daily NAV has too few days");
  const latestMonth = monthlyYuantaA.months.at(-1);
  const latestWeek = monthlyYuantaA.weeks.at(-1);
  const latestDay = monthlyYuantaA.days.at(-1);
  assert(Number(latestMonth?.nav) > 0, "ACYT161 latest monthly NAV invalid");
  assert(Number(latestWeek?.nav) > 0, "ACYT161 latest weekly NAV invalid");
  assert(Number(latestDay?.nav) > 0, "ACYT161 latest daily NAV invalid");
}

const valuationFixtureFund = {
  fundId: "TEST001",
  name: "測試基金A不配息",
  nav: 93.8,
  navDate: "07/08"
};
const valuation = purchaseValuation([valuationFixtureFund], {
  fund_id: "TEST001",
  fund_name: "測試基金A不配息",
  buy_date: "2026-06-25",
  amount: 500000,
  nav: 109.94
});
assert(valuation.fund === valuationFixtureFund, "purchase valuation fixture did not match fund by id");
assert(Math.round(valuation.currentValue) === 426596, `purchase valuation fixture value mismatch: ${valuation.currentValue}`);

const missingFundValuation = purchaseValuation([], {
  fund_id: "MISSING001",
  fund_name: "不存在基金",
  buy_date: "2026-06-25",
  amount: 500000,
  nav: 109.94
});
assert(missingFundValuation.currentValue === null, "missing fund valuation must be null, not zero");

const manualFundValuation = purchaseValuation([], {
  fund_id: "manual:現金科目",
  fund_name: "現金科目",
  buy_date: "2026-07-21",
  amount: 500000,
  nav: 1
});
assert(manualFundValuation.currentValue === 500000, "manual fund valuation should use entered NAV as current NAV");
assert(manualFundValuation.profit === 0, "manual fund valuation should keep profit at zero when NAV is unchanged");

const ambiguousFunds = [
  { fundId: "AAA001", name: "範例高股息基金A不配息", nav: 10 },
  { fundId: "AAA002", name: "範例高股息基金B配息", nav: 9 }
];
const ambiguousMatch = currentFundForPurchase(ambiguousFunds, {
  fund_id: "manual:範例高股息",
  fund_name: "範例高股息"
});
assert(ambiguousMatch === null, "ambiguous name fallback must not choose a fund");

const markets = Array.isArray(marketPayload?.markets) ? marketPayload.markets : [];
assert(markets.length >= 7, `market count too small: ${markets.length}`);
for (const id of ["twii", "sp500", "nasdaq", "nikkei", "kospi"]) {
  const market = markets.find((item) => item.id === id);
  assert(Boolean(market), `missing market ${id}`);
  if (market) {
    assert(Number.isFinite(Number(market.price)) && Number(market.price) > 0, `market ${id} price invalid`);
  }
}

const marginItems = Array.isArray(marginPayload?.items) ? marginPayload.items : [];
assert(marginItems.length >= 20, `margin history too short: ${marginItems.length}`);
assert(ageHours(marginPayload?.updatedAt) <= 96, `margin.json too old: ${marginPayload?.updatedAt}`);
const latestMargin = marginItems.at(-1);
assert(Number(latestMargin?.marginBalanceMillion) > 0, "latest margin balance invalid");
const latestPairedMargin = [...marginItems]
  .reverse()
  .find((item) => Number(item?.marginBalanceMillion) > 0 && Number(item?.twiiClose) > 0);
assert(Boolean(latestPairedMargin), "margin history has no row paired with a TWII close");
if (latestMargin?.date && latestPairedMargin?.date) {
  const pairedLagDays = Math.round((Date.parse(latestMargin.date) - Date.parse(latestPairedMargin.date)) / 86400000);
  assert(pairedLagDays <= 7, `latest margin/TWII paired row is too old: ${latestPairedMargin.date}`);
}

const twiiHistoryItems = Array.isArray(twiiHistoryPayload?.items) ? twiiHistoryPayload.items : [];
assert(twiiHistoryItems.length >= 1400, `TWII history too short: ${twiiHistoryItems.length}`);
assert(twiiHistoryItems[0]?.date <= "2020-01-15", `TWII history should begin in 2020: ${twiiHistoryItems[0]?.date}`);
assert(ageHours(twiiHistoryPayload?.updatedAt) <= 96, `twii_history.json too old: ${twiiHistoryPayload?.updatedAt}`);
const latestTwiiHistory = twiiHistoryItems.at(-1);
assert(Number(latestTwiiHistory?.close) > 0, "latest TWII history close invalid");
const latestTwiiLagDays = (Date.now() - Date.parse(latestTwiiHistory?.date || "")) / 86400000;
assert(latestTwiiLagDays <= 10, `latest TWII history row is too old: ${latestTwiiHistory?.date}`);
assert(twiiHistoryItems.every((item, index) => index === 0 || item.date > twiiHistoryItems[index - 1].date), "TWII history dates should be strictly increasing");
for (const [window, key] of [[20, "ma20"], [60, "ma60"]]) {
  const closes = twiiHistoryItems.slice(-window).map((item) => Number(item.close));
  const expected = closes.reduce((sum, value) => sum + value, 0) / window;
  assert(Math.abs(Number(latestTwiiHistory?.[key]) - expected) <= 0.02, `${key} does not match ${window}-day average`);
}

const appSource = fs.readFileSync("app.js", "utf8");
const styleSource = fs.readFileSync("styles.css", "utf8");
const fundBoxSource = fs.readFileSync("fund-box.js", "utf8");
const updateFundsSource = fs.readFileSync("update_funds.py", "utf8");
const refreshNavFunctionSource = fs.readFileSync("supabase/functions/refresh-nav/index.ts", "utf8");
assert(updateFundsSource.includes("parse_moneydj_mobile_latest_nav"), "update_funds.py should parse MoneyDJ mobile latest NAV");
assert(updateFundsSource.includes("fetch_moneydj_mobile_latest_nav(fund_id)"), "recent NAV refresh should check MoneyDJ mobile latest NAV");
assert(updateFundsSource.includes('latest_source = "MoneyDJ mobile"'), "recent NAV refresh should mark MoneyDJ mobile NAV source");
assert(updateFundsSource.includes("period_return_from_series(series, RECENT_RETURN_DAYS)"), "recent returns should still use BCD historical NAV series");
assert(updateFundsSource.includes('if any(keyword in name for keyword in ["不配息", "累積"])'), "fund normalization should not misclassify accumulating classes as distributing");
assert(refreshNavFunctionSource.includes("https://m.moneydj.com/a1.aspx"), "refresh-nav function should fetch MoneyDJ mobile fund pages");
assert(refreshNavFunctionSource.includes("parseMoneyDjMobileLatestNav"), "refresh-nav function should parse MoneyDJ mobile latest NAV");
assert(appSource.includes("fundDataLoaded"), "app.js missing fundDataLoaded guard");
assert(appSource.includes("基金資料尚未載入，暫不估算現值"), "app.js missing not-ready portfolio message");
assert(appSource.includes("NAV_REFRESH_FUNCTION_URL"), "refresh flow should define a single-fund NAV refresh function endpoint");
assert(appSource.includes("refreshOwnedFundNavFromFunction"), "refresh flow should attempt immediate owned-fund NAV refresh");
assert(appSource.includes("applyLatestNavToPeriodData"), "instant NAV refresh should update current month/week period data");
assert(appSource.includes("LOCAL_NAV_OVERRIDES_KEY"), "instant NAV refresh should persist local NAV overrides");
assert(appSource.includes("applyLocalNavOverridesToFunds"), "fund load should reapply persisted NAV overrides");
assert(appSource.includes("markPortfolioSnapshotsDirty();"), "instant NAV refresh should force portfolio period snapshots to recalculate");
assert(appSource.indexOf("await loadMonthlyNavData();") < appSource.indexOf("const instantRefresh = await refreshOwnedFundNavFromFunction();"), "refresh flow should load monthly NAV history before applying instant NAV override");
assert(appSource.includes("DAILY_PERIOD_DISPLAY_LIMIT = 10"), "daily profit should show at most 10 days");
assert(appSource.includes("每天賺賠"), "portfolio stats should render daily profit");
assert(appSource.includes("sortSoldByDate"), "sold purchases should be sorted by sell date");
assert(styleSource.includes(".weekly-breakdown,\n.daily-breakdown"), "daily profit should share weekly/monthly block styling");
assert(styleSource.includes(".weekly-breakdown p,\n.daily-breakdown p"), "daily profit rows should share weekly row layout");
assert(appSource.includes("即時單檔更新尚未啟用"), "refresh flow should not silently pretend immediate NAV refresh is enabled");
assert(appSource.includes("loadPurchases({ requestNavHistory: false, render: false })"), "refresh flow should load purchases without intermediate render");
assert(appSource.includes('MARKET_DISPLAY_IDS = ["twii", "txf", "sp500", "nasdaq", "nasdaqFuture", "nikkei", "kospi"]'), "market display should include Taiwan, futures, US, Japan, and Korea indexes");
assert(appSource.includes("visibleMarkets = MARKET_DISPLAY_IDS.map"), "market UI should use the fixed market display order");
assert(appSource.includes("MARKET_DISPLAY_LABELS[market.id] || market.label"), "market UI should use short display labels");
assert(appSource.includes("市場非即時"), "market UI should mark market quotes as non-live in the data status line");
assert(!appSource.includes("market-note"), "market UI should not add a second market timestamp/status line");
assert(appSource.includes('"txf"'), "market display should include Taiwan futures");
assert(appSource.includes('nasdaqFuture: "Nasdaq 期貨"'), "market display should include Nasdaq futures");
assert(!appSource.includes("LIVE_MARKET_REFRESH_MS"), "market UI should not claim minute-level live refresh");
assert(!appSource.includes("fetchLiveMarketQuote"), "market UI should not fetch fake live quotes from the browser");
assert(!appSource.includes("setInterval(refreshLiveMarkets"), "market UI should not poll market quotes every minute");
assert(!appSource.includes('document.querySelector("#compareTable")'), "compare table should be removed");
assert(!appSource.includes('data-fund="${escapeHtml(fund.name)}"'), "fund cards should not render compare checkboxes");
assert(appSource.includes("displayFundName(fund.name)"), "fund cards should use compact display names");
assert(appSource.includes("fund-list-row"), "fund cards should use list-row layout");
assert(appSource.includes("metric-strip"), "fund cards should use a single compact metric strip");
assert(appSource.includes("fundDisplayLimit"), "fund list should support increasing the visible result limit");
assert(appSource.includes("data-load-more-funds"), "fund list should render a load-more button");
assert(appSource.includes("fundDisplayLimit += DISPLAY_LIMIT"), "load-more button should show the next batch");
assert(appSource.includes("renderMarginChart"), "app.js should render margin balance trend chart");
assert(appSource.includes("data/margin.json"), "app.js should load margin history data");
assert(appSource.includes("relativeChangeSeries"), "margin chart should compare both series from the same 0% baseline");
assert(appSource.includes("combinedSeries"), "margin chart should use one shared percentage scale");
assert(appSource.includes("marginToTwiiRatio"), "margin chart should calculate margin balance relative to TWII");
assert(appSource.includes("ratioSeries"), "margin chart should plot margin-to-TWII strength");
assert(appSource.includes("融資／台股＝融資餘額÷台股指數"), "margin chart should explain the margin-to-TWII ratio");
assert(appSource.includes("三者皆以起點 0% 比較"), "margin chart should explain its shared percentage baseline");
assert(appSource.includes("TWII_TREND_MONTHS = [2, 6, 12]"), "TWII trend should support 2, 6, and 12-month windows");
assert(appSource.includes("shiftIsoDateMonths"), "TWII range selection should use calendar months instead of estimated trading days");
assert(appSource.includes("renderTwiiTrendChart"), "app.js should render the TWII moving-average chart");
assert(appSource.includes('fetch("data/twii_history.json"'), "app.js should load TWII history data");
assert(appSource.includes('addEventListener("pointermove"'), "TWII trend should support finger dragging");
assert(appSource.includes("twiiMonthLabels"), "TWII trend should label months and year boundaries");
assert(!appSource.includes("function capitalAtDate"), "TWII trend must not recalculate capital with a separate buy/sell shortcut");
assert(appSource.includes('DAILY_CAPITAL_SELECT = "period_key,period_date,invested,source_updated_at"'), "TWII trend should read the same invested field as daily profit");
assert(appSource.includes("fetchPortfolioDailyCapitalRows"), "TWII trend should load lightweight daily-profit capital snapshots");
assert(appSource.includes("dailyCapitalValuesForRows"), "TWII trend should align daily-profit capital with TWII dates");
assert(appSource.includes("portfolioDailyCapital.sourceUpdatedAt === portfolioSnapshotSource()"), "TWII trend should reject stale daily-capital snapshots");
assert(!appSource.includes("!sourceMatches || portfolioSnapshotsDirty"), "fresh daily-profit calculations should remain drawable while snapshots are being saved");
assert(appSource.includes("twiiCapitalPath"), "TWII trend should overlay the daily invested-capital series");
assert(appSource.includes("twii-capital-line"), "TWII trend should render the invested-capital line");
assert(appSource.includes("renderTwiiTrendChart();\n  portfolioPeriodsLoading = true"), "purchase loading should redraw the capital overlay immediately");
assert(updateFundsSource.includes("def moving_average"), "TWII moving averages should be calculated by the updater");
assert(updateFundsSource.includes('"monthly": 20, "quarterly": 60'), "TWII updater should use 20-day and 60-day averages");
assert(appSource.includes("fund-action-row"), "fund metrics and action buttons should share one row");
assert(appSource.includes("fund-info-block"), "fund nav/performance/metrics should be grouped on the left side");
assert(appSource.includes("metric-line"), "fund metrics should be arranged in two readable lines");
assert(appSource.includes("3年年化"), "fund metric labels should use full three-year annualized wording");
assert(appSource.includes("波動度"), "fund metric labels should use full volatility wording");
assert(!appSource.includes("compact-stats"), "fund cards should not render nested metric cards");
assert(appSource.includes('performanceTag("3月", fund.return3m)'), "fund cards should keep only 3-month performance in tags");
assert(appSource.includes('performanceTag("1年", fund.return1y)'), "fund cards should keep only 1-year performance in tags");
assert(!appSource.includes('<span class="pill">${escapeHtml(fund.dividend)}</span>'), "fund cards should not render dividend tags");
assert(!appSource.includes("visibleTags(fund.tags).map"), "fund cards should not render extra type/currency tags");
assert(fundBoxSource.includes('const VERSION = "1.0"'), "fund box algorithm should declare a version");
assert(fundBoxSource.includes("confirmationDays: 3"), "fund box top and bottom should require three-day confirmation");
assert(fundBoxSource.includes("minimumWidth: 0.1"), "fund box should have a 10% minimum width");
assert(fundBoxSource.includes("maximumWidth: 0.2"), "fund box should reject boxes wider than 20%");
assert(fundBoxSource.includes('status: "distribution_unadjusted"'), "fund box should block unadjusted distribution NAV");
assert(appSource.includes("exactMonthlyNavForPurchase"), "owned-fund boxes should match exact MoneyDJ fund IDs");
assert(appSource.includes('/(不配息|累積型|累積)/.test(name)'), "fund box distribution detection should prioritize accumulating class names");
assert(appSource.includes("buildFundBoxStore(activePurchases)"), "same-fund purchases should share one box calculation");
assert(appSource.includes('valuation.isSold ? "" : renderFundBoxTrigger(item)'), "sold purchases should not show fund boxes");
assert(appSource.includes("fundBoxChart"), "fund box details should include a NAV chart");
assert(appSource.includes("完整邏輯與算法"), "fund box modal should disclose the full algorithm");
assert(appSource.includes("配息未還原｜暫不判斷"), "fund box UI should explain unadjusted distribution data");
assert(styleSource.includes(".fund-box-rect.provisional"), "provisional boxes should have distinct chart styling");
assert(styleSource.includes(".fund-box-rect.confirmed"), "confirmed boxes should have distinct chart styling");

const indexSource = fs.readFileSync("index.html", "utf8");
assert(indexSource.includes("融資餘額趨勢"), "index should include margin trend section");
assert(indexSource.includes("指數、月線、季線"), "index should include TWII moving-average trend section");
assert(indexSource.includes('id="twiiTrendChart"'), "index should include the draggable TWII trend chart");
for (const months of [2, 6, 12]) {
  assert(indexSource.includes(`data-twii-range="${months}"`), `index should include the ${months}-month TWII range button`);
}
assert(indexSource.includes('id="returnInput" type="range" min="-5" max="80" step="0.5" value="20"'), "minimum 3-year annualized return default should be 20");
assert(indexSource.indexOf("fund-box.js") < indexSource.indexOf("app.js"), "fund box algorithm should load before the app");
assert(!indexSource.includes('href="./#compare"'), "top navigation should not show compare");
assert(!indexSource.includes('id="compare"'), "compare section should be removed");

const workflowSource = fs.readFileSync(".github/workflows/pages.yml", "utf8");
assert(workflowSource.includes('cron: "55 3,11,19 * * *"'), "scheduled updates should avoid GitHub's top-of-hour congestion");
assert(workflowSource.includes('cron: "55 2,10,18 * * *"'), "scheduled updates should include an early fallback attempt");
assert(workflowSource.includes('cron: "25 3,11,19 * * *"'), "scheduled updates should include a middle fallback attempt");
assert(workflowSource.includes('cron: "25 1,9,17 * * *"'), "scheduled updates should compensate for delays up to 2.5 hours");
assert((workflowSource.match(/timezone: Asia\/Taipei/g) || []).length === 6, "scheduled updates should provide six guarded attempts per target");
assert(workflowSource.includes("timezone: Asia/Taipei"), "scheduled updates should declare the Taiwan timezone");
assert(workflowSource.includes("scripts/scheduled-update-gate.py"), "scheduled retries should use the freshness gate");
assert(workflowSource.includes("cancel-in-progress: false"), "fallback attempts must not cancel an update already in progress");
assert(workflowSource.includes("--provider twii-history"), "scheduled updates should refresh TWII moving-average history");

if (failures.length) {
  console.error("Sanity check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Sanity check passed: ${funds.length} funds, ${markets.length} markets`);
