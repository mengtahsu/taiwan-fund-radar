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
  const currentNav = Number(fund?.nav) || 0;
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
const navCachePayload = readJson("data/nav_cache.json");
const monthlyNavPayload = readJson("data/monthly_nav.json");

function ageHours(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    return Infinity;
  }
  return (Date.now() - time) / 36e5;
}

const funds = Array.isArray(fundPayload?.funds) ? fundPayload.funds : [];
assert(funds.length >= 1000, `data/funds.json fund count too small: ${funds.length}`);
assert(Boolean(fundPayload?.updatedAt), "data/funds.json missing updatedAt");
assert(ageHours(fundPayload?.updatedAt) <= 96, `data/funds.json too old: ${fundPayload?.updatedAt}`);

const invalidNavFunds = funds.filter((fund) => !Number.isFinite(Number(fund.nav)) || Number(fund.nav) <= 0);
assert(invalidNavFunds.length === 0, `funds with invalid NAV: ${invalidNavFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

const missingNavDateFunds = funds.filter((fund) => Number(fund.nav) > 0 && !fund.navDate);
assert(missingNavDateFunds.length === 0, `funds with NAV but no navDate: ${missingNavDateFunds.slice(0, 5).map((fund) => fund.fundId || fund.name).join(", ")}`);

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
  const latestMonth = monthlyYuantaA.months.at(-1);
  const latestWeek = monthlyYuantaA.weeks.at(-1);
  assert(Number(latestMonth?.nav) > 0, "ACYT161 latest monthly NAV invalid");
  assert(Number(latestWeek?.nav) > 0, "ACYT161 latest weekly NAV invalid");
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

const appSource = fs.readFileSync("app.js", "utf8");
assert(appSource.includes("fundDataLoaded"), "app.js missing fundDataLoaded guard");
assert(appSource.includes("基金資料尚未載入，暫不估算現值"), "app.js missing not-ready portfolio message");
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
assert(appSource.includes("compact-stats"), "fund cards should use compact stat rows");
assert(appSource.includes('performanceTag("3月", fund.return3m)'), "fund cards should keep only 3-month performance in tags");
assert(appSource.includes('performanceTag("1年", fund.return1y)'), "fund cards should keep only 1-year performance in tags");
assert(!appSource.includes('<span class="pill">${escapeHtml(fund.dividend)}</span>'), "fund cards should not render dividend tags");
assert(!appSource.includes("visibleTags(fund.tags).map"), "fund cards should not render extra type/currency tags");

const indexSource = fs.readFileSync("index.html", "utf8");
assert(!indexSource.includes('href="./#compare"'), "top navigation should not show compare");
assert(!indexSource.includes('id="compare"'), "compare section should be removed");

if (failures.length) {
  console.error("Sanity check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Sanity check passed: ${funds.length} funds, ${markets.length} markets`);
