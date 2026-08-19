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

function growthScoreForFund(fund) {
  const performanceScore = (
    numeric(fund.return1m) * 2
    + numeric(fund.return3m) * 2
    + numeric(fund.return6m) * 0.4
    + numeric(fund.return1y) * 0.1
  );
  const sharpeScore = clamp(numeric(fund.sharpe) / 2, 0, 1) * 100;
  const riskFit = (1 - Math.max(0, numeric(fund.risk) - 5) / 4) * 100;
  return Math.round(performanceScore + sharpeScore * 0.2 + riskFit * 0.1);
}

const funds = Array.isArray(fundPayload?.funds) ? fundPayload.funds : [];
assert(funds.length >= 1000, `data/funds.json fund count too small: ${funds.length}`);
assert(Boolean(fundPayload?.updatedAt), "data/funds.json missing updatedAt");
assert(ageHours(fundPayload?.updatedAt) <= 96, `data/funds.json too old: ${fundPayload?.updatedAt}`);

const invalidNavFunds = funds.filter((fund) => !Number.isFinite(Number(fund.nav)) || Number(fund.nav) <= 0);
assert(invalidNavFunds.length === 0, `funds with invalid NAV: ${invalidNavFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

const missingNavDateFunds = funds.filter((fund) => Number(fund.nav) > 0 && !fund.navDate);
assert(missingNavDateFunds.length === 0, `funds with NAV but no navDate: ${missingNavDateFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

const topScreenedFunds = funds
  .map((fund) => ({
    ...fund,
    computedScore: growthScoreForFund(fund),
    navAge: navAgeDays(fund, fundPayload?.updatedAt)
  }))
  .filter((fund) => String(fund.type || "") !== "ETF" && numeric(fund.risk) <= 5 && numeric(fund.return3y) >= 20 && fund.navAge <= 14)
  .sort((a, b) => b.computedScore - a.computedScore)
  .slice(0, 50);
const missingRecentTopFunds = topScreenedFunds.filter((fund) => fund.return1m === undefined);
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
assert(markets.length >= 8, `market count too small: ${markets.length}`);
for (const id of ["twii", "sp500", "sox", "nasdaq", "nikkei", "kospi"]) {
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
const trailingBoxSqlSource = fs.readFileSync("supabase-trailing-boxes.sql", "utf8");
const updateFundsSource = fs.readFileSync("update_funds.py", "utf8");
const refreshNavFunctionSource = fs.readFileSync("supabase/functions/refresh-nav/index.ts", "utf8");
assert(updateFundsSource.includes("parse_moneydj_mobile_latest_nav"), "update_funds.py should parse MoneyDJ mobile latest NAV");
assert(updateFundsSource.includes("fetch_moneydj_mobile_latest_nav(fund_id)"), "recent NAV refresh should check MoneyDJ mobile latest NAV");
assert(updateFundsSource.includes('latest_source = "MoneyDJ mobile"'), "recent NAV refresh should mark MoneyDJ mobile NAV source");
assert(updateFundsSource.includes("period_return_from_series(series, RECENT_RETURN_DAYS)"), "recent returns should still use BCD historical NAV series");
assert(updateFundsSource.includes('number(fund.get("return1m") or 0, "return1m") * 2'), "backend ranking should multiply raw 1-month performance by 2");
assert(updateFundsSource.includes('number(fund.get("return3m") or 0, "return3m") * 2'), "backend ranking should multiply raw 3-month performance by 2");
assert(updateFundsSource.includes('number(fund.get("return6m") or 0, "return6m") * 0.4'), "backend ranking should multiply raw 6-month performance by 0.4");
assert(updateFundsSource.includes('number(fund.get("return1y") or 0, "return1y") * 0.1'), "backend ranking should multiply raw 1-year performance by 0.1");
assert(!updateFundsSource.includes("load_taiwan_benchmark_returns"), "backend score ranking should not use Taiwan benchmark returns");
assert(updateFundsSource.includes("math.floor(score + 0.5)"), "backend score rounding should match JavaScript Math.round");
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
assert(appSource.includes('MARKET_DISPLAY_IDS = ["twii", "txf", "sp500", "sox", "nasdaq", "nasdaqFuture", "nikkei", "kospi"]'), "market display should place SOX before Nasdaq");
assert(appSource.includes("visibleMarkets = MARKET_DISPLAY_IDS.map"), "market UI should use the fixed market display order");
assert(appSource.includes("MARKET_DISPLAY_LABELS[market.id] || market.label"), "market UI should use short display labels");
assert(appSource.includes("市場非即時"), "market UI should mark market quotes as non-live in the data status line");
assert(!appSource.includes("market-note"), "market UI should not add a second market timestamp/status line");
assert(appSource.includes('"txf"'), "market display should include Taiwan futures");
assert(appSource.includes('nasdaqFuture: "Nasdaq 期貨"'), "market display should include Nasdaq futures");
assert(appSource.includes('sox: "費半"'), "market display should label the Philadelphia Semiconductor Index as 費半");
assert(updateFundsSource.includes('"id": "sox", "label": "費城半導體", "symbol": "^SOX"'), "market updater should fetch the Philadelphia Semiconductor Index");
assert(!appSource.includes("LIVE_MARKET_REFRESH_MS"), "market UI should not claim minute-level live refresh");
assert(!appSource.includes("fetchLiveMarketQuote"), "market UI should not fetch fake live quotes from the browser");
assert(!appSource.includes("setInterval(refreshLiveMarkets"), "market UI should not poll market quotes every minute");
assert(!appSource.includes('document.querySelector("#compareTable")'), "compare table should be removed");
assert(!appSource.includes('data-fund="${escapeHtml(fund.name)}"'), "fund cards should not render compare checkboxes");
assert(appSource.includes("displayFundName(fund.name)"), "fund cards should use compact display names");
assert(appSource.includes("fund-list-row"), "fund cards should use list-row layout");
assert(appSource.includes("period-performance-row"), "fund cards should use a compact absolute-performance row");
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
assert(appSource.includes('section.addEventListener("pointermove"'), "Fund box chart should redraw while the finger is moving");
assert(appSource.includes("section.setPointerCapture(event.pointerId)"), "Fund box chart should retain pointer capture while dragging");
assert(appSource.includes("requestAnimationFrame"), "Interactive charts should throttle redraws with animation frames");
assert(appSource.includes('data-fund-box-segment="'), "Fund box chart segments should be individually selectable");
assert(!appSource.includes("fundBoxWidthText"), "fixed 20% box width should not be repeated in fund summaries");
assert(!appSource.includes("<span>箱寬"), "selected box popovers should not repeat the fixed box width");
assert(styleSource.includes(".fund-box-segment-popover"), "Selected fund boxes should show a compact detail popover");
assert(appSource.includes("twiiMonthLabels"), "TWII trend should label months and year boundaries");
assert(!appSource.includes("function capitalAtDate"), "TWII trend must not recalculate capital with a separate buy/sell shortcut");
assert(appSource.includes('DAILY_CAPITAL_SELECT = "period_key,period_date,invested,source_updated_at"'), "TWII trend should read the same invested field as daily profit");
assert(appSource.includes("fetchPortfolioDailyCapitalRows"), "TWII trend should load lightweight daily-profit capital snapshots");
assert(appSource.includes("dailyCapitalValuesForRows"), "TWII trend should align daily-profit capital with TWII dates");
assert(appSource.includes("portfolioDailyCapital.sourceUpdatedAt === portfolioSnapshotSource()"), "TWII trend should reject stale daily-capital snapshots");
assert(!appSource.includes("!sourceMatches || portfolioSnapshotsDirty"), "fresh daily-profit calculations should remain drawable while snapshots are being saved");
assert(appSource.includes("twiiCapitalPath"), "TWII trend should overlay the daily invested-capital series");
assert(appSource.includes("twii-capital-line"), "TWII trend should render the invested-capital line");
assert(appSource.includes("showTwiiCapital = true"), "TWII capital line should be visible by default");
assert(appSource.includes('twiiCapitalToggle?.addEventListener("change"'), "TWII capital line should be user-toggleable");
assert(appSource.includes("const capitalVisible = showTwiiCapital"), "TWII capital toggle should also control its legend and status note");
assert(appSource.includes("renderTwiiTrendChart();\n  portfolioPeriodsLoading = true"), "purchase loading should redraw the capital overlay immediately");
assert(updateFundsSource.includes("def moving_average"), "TWII moving averages should be calculated by the updater");
assert(updateFundsSource.includes('"monthly": 20, "quarterly": 60'), "TWII updater should use 20-day and 60-day averages");
assert(appSource.includes("fund-action-row"), "fund metrics and action buttons should share one row");
assert(appSource.includes("fund-info-block"), "fund nav/performance/metrics should be grouped on the left side");
assert(appSource.includes("period-performance-row"), "fund cards should show a compact 1/3/6-month performance row");
assert(styleSource.includes("grid-template-columns: repeat(3, minmax(0, 1fr));"), "1-month, 3-month, and 6-month performance should use three equal columns");
assert(styleSource.includes(".period-performance-row > span:nth-child(-n + 3)"), "the three period metrics should be centered in equal columns");
assert(styleSource.includes("grid-column: 1 / 3;"), "volatility should occupy a separate second row");
assert(!appSource.includes("compact-stats"), "fund cards should not render nested metric cards");
assert(appSource.includes('performanceTag("1年", fund.return1y)'), "fund cards should keep only 1-year performance in tags");
assert(appSource.includes('performanceTag("3年年化", fund.return3y)'), "fund cards should place 3-year annualized performance after NAV and 1-year performance");
assert(appSource.includes('performanceMetric("1月", fund.return1m)'), "fund cards should show absolute 1-month performance");
assert(appSource.includes('performanceMetric("3月", fund.return3m)'), "fund cards should show absolute 3-month performance");
assert(appSource.includes('performanceMetric("6月", fund.return6m)'), "fund cards should show absolute 6-month performance");
assert(appSource.includes('performanceMetric("波動度", fund.volatility, { colorize: false, signed: false })'), "fund cards should retain volatility beside period performance");
assert(appSource.includes('<span class="fund-data-date">${escapeHtml(fund.navDate)}</span>'), "fund cards should render a separate NAV date");
assert(styleSource.includes(".fund-data-date"), "fund NAV dates should have a fixed card position");
assert(styleSource.includes("position: absolute;\n  right: 0;"), "fund NAV dates should be anchored at the right edge");
assert(styleSource.includes("grid-template-columns: minmax(0, 1fr) 68px;"), "fund action columns should keep every NAV date horizontally aligned");
assert(!appSource.includes("compactBenchmarkStatus"), "fund cards should not show 1-month or 2-week benchmark comparisons");
assert(!appSource.includes('<span class="pill">${escapeHtml(fund.dividend)}</span>'), "fund cards should not render dividend tags");
assert(!appSource.includes("visibleTags(fund.tags).map"), "fund cards should not render extra type/currency tags");
assert(appSource.includes("function scoreBreakdown(fund)"), "score clicks should use the same calculation as fund ranking");
assert(appSource.includes('data-score-fund="${escapeHtml(fundLookupKey(fund))}"'), "fund score circles should open their calculation details");
assert(appSource.includes("分數 × 倍率"), "score details should show each component score and multiplier");
assert(appSource.includes("漲幾 % 就是幾分，跌幾 % 就是負幾分"), "score details should disclose direct positive and negative performance scoring");
assert(appSource.includes('{ label: "近 1 月績效", detail: scorePercentValue(fund.return1m), score: Number(fund.return1m) || 0, factor: 2'), "score should multiply raw 1-month performance by 2");
assert(appSource.includes('{ label: "近 3 月績效", detail: scorePercentValue(fund.return3m), score: Number(fund.return3m) || 0, factor: 2'), "score should multiply raw 3-month performance by 2");
assert(appSource.includes('{ label: "近 6 月績效", detail: scorePercentValue(fund.return6m), score: Number(fund.return6m) || 0, factor: 0.4'), "score should multiply raw 6-month performance by 0.4");
assert(appSource.includes('{ label: "近 1 年績效", detail: scorePercentValue(fund.return1y), score: Number(fund.return1y) || 0, factor: 0.1'), "score should multiply raw 1-year performance by 0.1");
assert(!appSource.includes("recentMomentumBreakdown"), "score should not group recent momentum");
assert(!appSource.includes("longTermMomentumBreakdown"), "score should not group long-term momentum");
assert(appSource.includes("event.target === modal"), "score detail modal should close when its backdrop is tapped");
assert(!appSource.includes('<button class="score compact-score"'), "score circles should keep their existing non-button appearance");
assert(!styleSource.includes(".score[data-score-fund]::after"), "clickable scores should not add a line below the number");
assert(fundBoxSource.includes('const VERSION = "2.0"'), "trailing fund box algorithm should declare a new version");
assert(fundBoxSource.includes("width: 0.2"), "trailing fund boxes should remain exactly 20% wide");
assert(fundBoxSource.includes("historyPoints: 400"), "trailing fund boxes should retain sparse bootstrap history");
assert(fundBoxSource.includes("candidateValue > peak"), "fund box peaks should only move upward on a new high");
assert(fundBoxSource.includes("value * (1 - settings.width)"), "fund box floors should trail the peak by exactly 20%");
assert(fundBoxSource.includes('status: "distribution_unadjusted"'), "fund box should block unadjusted distribution NAV");
assert(fundBoxSource.includes("function buyDecision"), "fund box should translate technical states into a plain buy decision");
assert(fundBoxSource.includes("function lowZoneMetrics"), "fund entry timing should measure the multi-month low zone");
assert(fundBoxSource.includes('label: "低點區可分批"'), "a stabilized multi-month low should be a visible entry reference");
assert(fundBoxSource.includes('label: "暫緩加碼"'), "failed or broken boxes should clearly warn against large additions");
assert(fundBoxSource.includes("function holdingDecision"), "fund boxes should separately calculate a holding decision");
assert(fundBoxSource.includes('label: "尚未跌破箱底"'), "healthy or rising funds should remain invested without profit-taking");
assert(fundBoxSource.includes('label: "跌破箱底"'), "the first trailing-floor breach should display a clear warning");
assert(fundBoxSource.includes("是否贖回由你判斷"), "the site must leave every redemption decision to the user");
assert(updateFundsSource.includes("DAILY_NAV_DAYS = 190"), "fund box history should retain about six calendar months");
assert(appSource.includes("exactMonthlyNavForPurchase"), "owned-fund boxes should match exact MoneyDJ fund IDs");
assert(appSource.includes('/(不配息|累積型|累積)/.test(name)'), "fund box distribution detection should prioritize accumulating class names");
assert(appSource.includes("buildFundBoxStore(activePurchases)"), "active purchases should build trailing boxes");
assert(appSource.includes("return `purchase:${purchaseId}`"), "each purchase record should have an independent trailing box key");
assert(appSource.includes("savedBox?.tracking_start_date === trackingStartDate"), "editing a buy date should invalidate the old saved peak");
assert(appSource.includes("這筆買入紀錄使用自己的箱子"), "the box detail should identify its per-purchase scope");
assert(appSource.includes("某筆紀錄賣出後只清除該筆箱子"), "selling one purchase should not reset another purchase of the same fund");
assert(appSource.includes('from("fund_trailing_boxes")'), "saved trailing peaks should load from the authenticated database");
assert(appSource.includes("bootstrapLimited"), "incomplete pre-launch daily history should be disclosed");
assert(appSource.includes("navItem?.months") && appSource.includes("navItem?.weeks"), "older month/week NAV rows should bootstrap existing holdings");
assert(appSource.includes("persistFundTrailingBox(entry)"), "new high-water marks should be persisted for future sessions");
assert(appSource.includes("最高淨值目前未寫入帳號"), "the UI should disclose when a trailing peak is not persisted");
assert(trailingBoxSqlSource.includes("primary key (user_id, fund_id)"), "each user and fund should have only one saved trailing box");
assert(trailingBoxSqlSource.includes("auth.uid() = user_id"), "trailing box peaks must be protected by per-user RLS");
assert(appSource.includes('valuation.isSold ? "" : renderFundBoxTrigger(item)'), "sold purchases should not show fund boxes");
assert(appSource.includes("fundBoxChart"), "fund box details should include a NAV chart");
assert(appSource.includes("完整邏輯與算法"), "fund box modal should disclose the full algorithm");
assert(appSource.includes("買點判斷"), "fund box modal should lead with a multi-month low entry reference");
assert(appSource.includes("賣點判斷"), "fund box modal should show a separate sell decision");
assert(appSource.includes("基金上漲時不顯示停利"), "fund box explanation should preserve long-term winners without redemption gaps");
assert(appSource.includes("fund-box-stop-line"), "fund box chart should draw the active stop-loss bottom");
assert(appSource.includes("currentTrailingSegment.startIndex"), "the current floor line should begin at the current high, not rewrite chart history");
assert(appSource.includes("20%箱底"), "fund box chart should label the active 20% floor");
assert(appSource.includes("function fundBoxVisibleWindow"), "fund box chart should calculate a calendar-month viewport");
assert(appSource.includes('data-fund-box-months="2"'), "fund box chart should offer a two-month view");
assert(appSource.includes('data-fund-box-months="4"'), "fund box chart should offer a four-month view");
assert(appSource.includes('addEventListener("pointerdown"'), "fund box chart should support horizontal finger navigation");
assert(appSource.includes("section.clientWidth"), "fund box SVG should use the actual displayed width instead of shrinking fixed coordinates");
assert(styleSource.includes("touch-action: pan-y"), "fund box chart should reserve horizontal gestures while preserving vertical page scrolling");
assert(styleSource.includes(".fund-box-range-tabs button.active"), "fund box range control should visibly identify the selected range");
assert(appSource.includes("技術狀態："), "fund box modal should keep the technical state as supporting detail");
assert(appSource.includes("配息未還原｜暫不判斷"), "fund box UI should explain unadjusted distribution data");
assert(styleSource.includes(".fund-box-rect.trailing"), "20% trailing boxes should have distinct chart styling");

const indexSource = fs.readFileSync("index.html", "utf8");
assert(indexSource.includes("融資餘額趨勢"), "index should include margin trend section");
assert(indexSource.includes("指數、月線、季線"), "index should include TWII moving-average trend section");
assert(indexSource.includes('id="twiiTrendChart"'), "index should include the draggable TWII trend chart");
assert(indexSource.includes('id="twiiCapitalToggle" type="checkbox" checked'), "TWII trend should include a default-on capital-line toggle");
for (const months of [2, 6, 12]) {
  assert(indexSource.includes(`data-twii-range="${months}"`), `index should include the ${months}-month TWII range button`);
}
assert(indexSource.includes('id="returnInput" type="range" min="-5" max="80" step="0.5" value="20"'), "minimum 3-year annualized return default should be 20");
assert(indexSource.indexOf("fund-box.js") < indexSource.indexOf("app.js"), "fund box algorithm should load before the app");
assert(!indexSource.includes('href="./#compare"'), "top navigation should not show compare");
assert(!indexSource.includes('id="compare"'), "compare section should be removed");

const workflowSource = fs.readFileSync(".github/workflows/pages.yml", "utf8");
const scheduleGateSource = fs.readFileSync("scripts/scheduled-update-gate.py", "utf8");
const pagesDeploySource = fs.readFileSync("scripts/deploy-pages-without-cancel.mjs", "utf8");
assert(workflowSource.includes('cron: "55 3,11,19 * * *"'), "scheduled updates should avoid GitHub's top-of-hour congestion");
assert(workflowSource.includes('cron: "55 2,10,18 * * *"'), "scheduled updates should include an early fallback attempt");
assert(workflowSource.includes('cron: "25 3,11,19 * * *"'), "scheduled updates should include a middle fallback attempt");
assert(workflowSource.includes('cron: "25 1,9,17 * * *"'), "scheduled updates should compensate for delays up to 2.5 hours");
assert((workflowSource.match(/timezone: Asia\/Taipei/g) || []).length === 6, "scheduled updates should provide six guarded attempts per target");
assert(workflowSource.includes("timezone: Asia/Taipei"), "scheduled updates should declare the Taiwan timezone");
assert(workflowSource.includes("scripts/scheduled-update-gate.py"), "scheduled retries should use the freshness gate");
assert(scheduleGateSource.includes("EARLY_WINDOW_MINUTES = 180"), "early attempts should cover GitHub scheduler delays up to three hours");
assert(scheduleGateSource.includes("wait_seconds"), "the schedule gate should calculate time remaining before the Taiwan target");
assert(workflowSource.includes('run: sleep "$WAIT_SECONDS"'), "early attempts should wait online for the Taiwan target time");
assert(workflowSource.includes("id: update_gate"), "scheduled updates should recheck freshness after waiting");
assert((workflowSource.match(/steps\.update_gate\.outputs\.should_update/g) || []).length >= 10, "data and deploy steps should use the post-wait update gate");
assert(workflowSource.includes("cancel-in-progress: false"), "fallback attempts must not cancel an update already in progress");
assert(workflowSource.includes("scripts/deploy-pages-without-cancel.mjs"), "Pages deployment should preserve slow queued deployments");
assert(workflowSource.includes("timeout-minutes: 35"), "Pages deployment job should remain active through long queues");
assert(pagesDeploySource.includes("still queued after 30 minutes"), "slow Pages deployments must remain queued");
assert(!pagesDeploySource.includes('cancelDeployment(buildVersion)'), "Pages deployment must not cancel its own queued build on timeout");
assert(workflowSource.includes("--provider twii-history"), "scheduled updates should refresh TWII moving-average history");

if (failures.length) {
  console.error("Sanity check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Sanity check passed: ${funds.length} funds, ${markets.length} markets`);
