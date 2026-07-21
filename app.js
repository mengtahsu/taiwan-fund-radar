const sampleFunds = [
  {
    name: "台灣核心成長示範基金",
    company: "範例投信",
    type: "台股",
    region: "台灣",
    risk: 4,
    return3y: 10.8,
    fee: 1.28,
    volatility: 18.6,
    sharpe: 0.66,
    aum: 428,
    dividend: "累積型",
    minRsp: 3000,
    tags: ["大型股", "電子", "成長"]
  },
  {
    name: "台灣高股息收益示範基金",
    company: "範例資產管理",
    type: "台股",
    region: "台灣",
    risk: 4,
    return3y: 7.4,
    fee: 1.05,
    volatility: 14.2,
    sharpe: 0.58,
    aum: 980,
    dividend: "月配",
    minRsp: 1000,
    tags: ["高股息", "價值", "收益"]
  },
  {
    name: "台灣中小精選示範基金",
    company: "示範投信",
    type: "台股",
    region: "台灣",
    risk: 5,
    return3y: 13.2,
    fee: 1.62,
    volatility: 24.5,
    sharpe: 0.54,
    aum: 156,
    dividend: "累積型",
    minRsp: 3000,
    tags: ["中小型", "主動", "高波動"]
  },
  {
    name: "台灣平衡配置示範基金",
    company: "範例投信",
    type: "平衡",
    region: "台灣",
    risk: 3,
    return3y: 5.6,
    fee: 0.92,
    volatility: 8.1,
    sharpe: 0.61,
    aum: 342,
    dividend: "季配",
    minRsp: 1000,
    tags: ["股債平衡", "穩健", "配置"]
  },
  {
    name: "投資級債券示範基金",
    company: "示範投信",
    type: "債券",
    region: "全球",
    risk: 2,
    return3y: 3.1,
    fee: 0.68,
    volatility: 5.2,
    sharpe: 0.42,
    aum: 760,
    dividend: "月配",
    minRsp: 1000,
    tags: ["投資級", "低波動", "收益"]
  },
  {
    name: "美國科技連結示範基金",
    company: "範例資產管理",
    type: "ETF連結",
    region: "美國",
    risk: 5,
    return3y: 15.4,
    fee: 0.78,
    volatility: 22.4,
    sharpe: 0.71,
    aum: 512,
    dividend: "累積型",
    minRsp: 3000,
    tags: ["科技", "ETF", "成長"]
  },
  {
    name: "全球永續股票示範基金",
    company: "示範投信",
    type: "全球股票",
    region: "全球",
    risk: 4,
    return3y: 8.9,
    fee: 1.16,
    volatility: 16.3,
    sharpe: 0.63,
    aum: 298,
    dividend: "累積型",
    minRsp: 3000,
    tags: ["ESG", "全球", "成長"]
  },
  {
    name: "亞洲收益平衡示範基金",
    company: "範例投信",
    type: "平衡",
    region: "亞洲",
    risk: 3,
    return3y: 4.8,
    fee: 1.08,
    volatility: 9.5,
    sharpe: 0.49,
    aum: 226,
    dividend: "季配",
    minRsp: 1000,
    tags: ["亞洲", "收益", "配置"]
  }
];

let funds = [...sampleFunds];
let sourceMeta = {
  source: "示範資料",
  updatedAt: null
};
let fundDataLoaded = false;
let marketMeta = {
  source: "市場資料未載入",
  updatedAt: null,
  markets: [],
  benchmarks: {}
};
let monthlyNavMeta = {
  source: "月底淨值未載入",
  updatedAt: null,
  items: {}
};

const DISPLAY_LIMIT = 50;
const PERIOD_DISPLAY_LIMIT = 12;
const DAILY_PERIOD_DISPLAY_LIMIT = 10;
const MARKET_DISPLAY_IDS = ["twii", "txf", "sp500", "nasdaq", "nasdaqFuture", "nikkei", "kospi"];
const MARKET_DISPLAY_LABELS = {
  twii: "台股",
  txf: "台指期",
  sp500: "S&P 500",
  nasdaq: "Nasdaq",
  nasdaqFuture: "Nasdaq 期貨",
  nikkei: "日股",
  kospi: "韓股"
};
const SUPABASE_URL = "https://yobdglsovihychcfszbi.supabase.co";
const SUPABASE_KEY = "sb_publishable_EeqYDx4CWa5l-DyPbz3I5g_PlSVCukK";
const NAV_REFRESH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/refresh-nav`;
const SITE_URL = "https://mengtahsu.github.io/taiwan-fund-radar/";
const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const isPortfolioView = new URLSearchParams(window.location.search).get("view") === "portfolio";

if (isPortfolioView) {
  document.body.classList.add("portfolio-view");
}

let currentUser = null;
let purchases = [];
let portfolioPeriodSnapshots = {
  loaded: false,
  supported: true,
  sourceUpdatedAt: null,
  months: new Map(),
  weeks: new Map(),
  days: new Map()
};
let portfolioSnapshotsDirty = false;
let portfolioSnapshotsSaving = false;
let periodDetailStore = new Map();
let periodHistoryStore = new Map();
let fundDisplayLimit = DISPLAY_LIMIT;

const els = {
  query: document.querySelector("#queryInput"),
  type: document.querySelector("#typeSelect"),
  region: document.querySelector("#regionSelect"),
  risk: document.querySelector("#riskInput"),
  return: document.querySelector("#returnInput"),
  beatBenchmark: document.querySelector("#beatBenchmarkInput"),
  riskValue: document.querySelector("#riskValue"),
  returnValue: document.querySelector("#returnValue"),
  sort: document.querySelector("#sortSelect"),
  scoreExplain: document.querySelector("#scoreExplain"),
  grid: document.querySelector("#fundGrid"),
  count: document.querySelector("#resultCount"),
  metricTotal: document.querySelector("#metricTotal"),
  metricReturn: document.querySelector("#metricReturn"),
  dataStatus: document.querySelector("#dataStatus"),
  marketList: document.querySelector("#marketList"),
  reset: document.querySelector("#resetBtn"),
  authStatus: document.querySelector("#authStatus"),
  authForm: document.querySelector("#authForm"),
  accountPanel: document.querySelector("#accountPanel"),
  accountEmail: document.querySelector("#accountEmail"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  signIn: document.querySelector("#signInBtn"),
  signUp: document.querySelector("#signUpBtn"),
  signOut: document.querySelector("#signOutBtn"),
  authMessage: document.querySelector("#authMessage"),
  purchaseForm: document.querySelector("#purchaseForm"),
  purchaseFundId: document.querySelector("#purchaseFundId"),
  purchaseFundName: document.querySelector("#purchaseFundName"),
  purchaseDate: document.querySelector("#purchaseDate"),
  purchaseAmount: document.querySelector("#purchaseAmount"),
  purchaseNav: document.querySelector("#purchaseNav"),
  purchaseNote: document.querySelector("#purchaseNote"),
  purchaseMessage: document.querySelector("#purchaseMessage"),
  portfolioStats: document.querySelector("#portfolioStats"),
  purchaseList: document.querySelector("#purchaseList"),
  purchaseRefreshStatus: document.querySelector("#purchaseRefreshStatus"),
  refreshPurchases: document.querySelector("#refreshPurchasesBtn")
};

function goal() {
  return document.querySelector("input[name='goal']:checked").value;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function benchmarkForFund(fund) {
  return marketMeta.benchmarks.twii || null;
}

function excessReturn(fund, returnKey) {
  if (typeof fund[returnKey] !== "number") {
    return null;
  }
  const benchmark = benchmarkForFund(fund);
  if (!benchmark || typeof benchmark[returnKey] !== "number") {
    return null;
  }
  return fund[returnKey] - benchmark[returnKey];
}

function excessReturn2w(fund) {
  return excessReturn(fund, "return2w");
}

function excessReturn1m(fund) {
  return excessReturn(fund, "return1m");
}

function recentMomentumScore(fund) {
  const return3mScore = clamp((fund.return3m ?? 0) / 60, 0, 1);
  const excess2w = excessReturn2w(fund);
  const excess1m = excessReturn1m(fund);
  const excess2wScore = excess2w === null ? 0.45 : clamp((excess2w + 10) / 25, 0, 1);
  const excess1mScore = excess1m === null ? 0.45 : clamp((excess1m + 12) / 30, 0, 1);
  return return3mScore * 0.45 + excess2wScore * 0.3 + excess1mScore * 0.25;
}

function scoreFund(fund) {
  const currentGoal = goal();
  const riskFit = 1 - Math.max(0, fund.risk - Number(els.risk.value)) / 4;
  const returnScore = clamp(fund.return3y / 80, 0, 1);
  const stabilityScore = 1 - clamp(fund.volatility / 28, 0, 1);
  const incomeScore = fund.dividend.includes("配") ? 1 : 0.35;
  const sharpeScore = clamp(fund.sharpe / 2, 0, 1);
  const momentumScore = recentMomentumScore(fund);

  const scoreParts = {
    growth: [
      [returnScore, 0.25],
      [momentumScore, 0.45],
      [sharpeScore, 0.2],
      [riskFit, 0.1]
    ],
    income: [
      [incomeScore, 0.35],
      [stabilityScore, 0.3],
      [riskFit, 0.2],
      [momentumScore, 0.15]
    ],
    stability: [
      [stabilityScore, 0.35],
      [riskFit, 0.3],
      [sharpeScore, 0.2],
      [momentumScore, 0.15]
    ]
  }[currentGoal];

  return Math.round(scoreParts.reduce((total, [score, weight]) => total + score * weight, 0) * 100);
}

function scoreTitle() {
  return {
    growth: "自訂綜合分數：三年年化 25%、近期動能 45%、Sharpe 20%、風險符合度 10%。近期動能含近 3 月報酬、近 1 月與近 2 週相對台股",
    income: "自訂綜合分數：配息型態 35%、低波動 30%、風險符合度 20%、近期動能 15%。近期動能含近 3 月報酬、近 1 月與近 2 週相對台股",
    stability: "自訂綜合分數：低波動 35%、風險符合度 30%、Sharpe 20%、近期動能 15%。近期動能含近 3 月報酬、近 1 月與近 2 週相對台股"
  }[goal()];
}

function renderScoreExplain() {
  if (!els.scoreExplain) {
    return;
  }
  const label = {
    growth: "成長目標",
    income: "配息目標",
    stability: "穩健目標"
  }[goal()];
  els.scoreExplain.textContent = `${label}的綜合分數算法：${scoreTitle().replace("自訂綜合分數：", "")}。Sharpe = 報酬 / 波動。分數只用來排序，不代表買賣建議。`;
}

function filteredFunds() {
  const q = els.query.value.trim().toLowerCase();
  const maxRisk = Number(els.risk.value);
  const minReturn = Number(els.return.value);
  const beatOnly = els.beatBenchmark.checked;
  const typeValue = els.type.value;

  return funds
    .filter((fund) => {
      const haystack = [fund.name, fund.company, fund.ticker || "", fund.fundId || "", fund.type, fund.region, ...fund.tags].join(" ").toLowerCase();
      const excess2w = excessReturn2w(fund);
      const typeMatched =
        typeValue === "all" ||
        (typeValue === "non-etf" ? fund.type !== "ETF" : typeValue === "fubon-buyable" ? Boolean(fund.fubonBuyUrl) : fund.type === typeValue);
      return (
        (!q || haystack.includes(q)) &&
        typeMatched &&
        (els.region.value === "all" || fund.region === els.region.value) &&
        fund.risk <= maxRisk &&
        fund.return3y >= minReturn &&
        (!beatOnly || (excess2w !== null && excess2w > 0))
      );
    })
    .map((fund) => ({ ...fund, score: scoreFund(fund), excess2w: excessReturn2w(fund) ?? -999 }))
    .sort((a, b) => {
      if (els.sort.value === "volatility") {
        return a[els.sort.value] - b[els.sort.value];
      }
      return b[els.sort.value] - a[els.sort.value];
    });
}

function formatMoney(value) {
  return `${value.toLocaleString("zh-TW")} 億`;
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCompactPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
}

function formatMarketPrice(value) {
  return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function formatTaiwanDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return date
    .toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })
    .replace(/\//g, "/");
}

function formatShortDate(value) {
  if (!value) {
    return "";
  }
  const parts = String(value).split("-");
  if (parts.length !== 3) {
    return String(value);
  }
  const [, month, day] = parts;
  return `${month}/${day}`;
}

function fundReturnDate(fund, period) {
  return formatShortDate(fund[`return${period}EndDate`]);
}

function benchmarkStatus(fund, period) {
  const benchmark = benchmarkForFund(fund);
  const returnKey = `return${period}`;
  const periodLabel = period === "1m" ? "近 1 月" : "近 2 週";
  if (typeof fund[returnKey] !== "number") {
    return `
      <div class="benchmark pending">
        <span>${periodLabel}台股</span>
        <strong>更新中</strong>
      </div>
    `;
  }
  if (!benchmark || typeof benchmark[returnKey] !== "number") {
    return `
      <div class="benchmark pending">
        <span>${periodLabel}台股</span>
        <strong>等大盤</strong>
      </div>
    `;
  }
  const excess = fund[returnKey] - benchmark[returnKey];
  const statusClass = excess >= 0 ? "beat" : "lag";
  const label = excess >= 0 ? `${periodLabel}贏台股` : `${periodLabel}輸台股`;
  const dataDate = fundReturnDate(fund, period);
  return `
    <div class="benchmark ${statusClass}">
      <span>${label}</span>
      <strong>${formatPercent(excess)}</strong>
      ${dataDate ? `<small>資料 ${escapeHtml(dataDate)}</small>` : ""}
    </div>
  `;
}

function compactBenchmarkStatus(fund, period) {
  const benchmark = benchmarkForFund(fund);
  const returnKey = `return${period}`;
  const shortLabel = period === "1m" ? "1月" : "2週";
  if (typeof fund[returnKey] !== "number" || !benchmark || typeof benchmark[returnKey] !== "number") {
    return {
      className: "pending",
      label: `${shortLabel}台股`,
      value: "更新中",
      valueNumber: null,
      date: fundReturnDate(fund, period)
    };
  }
  const excess = fund[returnKey] - benchmark[returnKey];
  return {
    className: excess >= 0 ? "beat" : "lag",
    label: `${shortLabel}${excess >= 0 ? "贏" : "輸"}`,
    value: formatPercent(excess),
    valueNumber: excess,
    date: fundReturnDate(fund, period)
  };
}

function formatPrice(fund) {
  if (typeof fund.nav === "number" && fund.nav > 0) {
    return `${fund.nav.toLocaleString("zh-TW", { maximumFractionDigits: 4 })}`;
  }
  if (typeof fund.price === "number" && fund.price > 0) {
    return `NT$ ${fund.price.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
  }
  return formatMoney(fund.aum);
}

function liquidityLabel(fund) {
  if (fund.navDate) {
    return fund.navDate;
  }
  if (typeof fund.averageVolume === "number" && fund.averageVolume > 0) {
    return `${fund.averageVolume.toLocaleString("zh-TW")} 股`;
  }
  return formatMoney(fund.aum);
}

function riskClass(risk) {
  return risk >= 4 ? "risk-high" : "risk-low";
}

function renderFundName(fund) {
  const name = escapeHtml(displayFundName(fund.name));
  const url = moneyDjFundUrl(fund.fundId);
  if (!url) {
    return name;
  }
  return `<a class="fund-name-link" href="${url}">${name}</a>`;
}

function moneyDjFundUrl(fundId) {
  const moneyDjId = String(fundId || "").split("-", 1)[0].trim();
  if (!moneyDjId) {
    return "";
  }
  return `https://m.moneydj.com/a1.aspx?a=${encodeURIComponent(moneyDjId)}`;
}

function displayFundName(name) {
  return String(name || "")
    .replace(/[\(（][^()（）]*[\)）]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPurchaseFundName(item, matchedFund) {
  const name = escapeHtml(item.fund_name || "");
  const url = moneyDjFundUrl(matchedFund?.fundId || item.fund_id);
  if (!url) {
    return name;
  }
  return `<a class="fund-name-link" href="${url}">${name}</a>`;
}

function renderPurchaseScore(matchedFund) {
  if (!matchedFund) {
    return "";
  }
  return `<span class="purchase-score" title="${scoreTitle()}">${scoreFund(matchedFund)}</span>`;
}

function renderBuyLink(fund) {
  if (fund.fubonBuyUrl) {
    const navHint = typeof fund.nav === "number" && Number.isFinite(fund.nav) ? `，先核對淨值 ${moneyNumber(fund.nav)}${fund.navDate ? ` / ${fund.navDate}` : ""}` : "";
    return `<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}" title="請在富邦確認基金名稱與淨值${escapeHtml(navHint)}">富邦 App 申購</a>`;
  }
  if (fund.fundrichAppUrl) {
    const label = fund.fundrichSource === "MoneyDJ 申購清單" ? "基富通申購" : "基富通 App 申購";
    return `<a class="buy-link secondary" href="${escapeHtml(fund.fundrichAppUrl)}">${label}</a>`;
  }
  return "";
}

function fundLookupKey(fund) {
  return String(fund.fundId || fund.name);
}

function moneyDjFundId(value) {
  if (String(value || "").startsWith("manual:")) {
    return "";
  }
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/[A-Z]{2,}\d{2,}/);
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

function setMessage(element, text, isError = false) {
  if (!element) {
    return;
  }
  element.textContent = text || "";
  element.classList.toggle("error", Boolean(isError));
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function moneyNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return number.toLocaleString("zh-TW", { maximumFractionDigits: 4 });
}

function wholeMoneyNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return Math.round(number).toLocaleString("zh-TW");
}

function compactDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!match) {
    return text;
  }
  return `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function twd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return number.toLocaleString("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  });
}

function compactTwdWan(value) {
  const wan = (Number(value) || 0) / 10000;
  const maximumFractionDigits = Math.abs(wan) >= 100 ? 0 : 1;
  return `${wan.toLocaleString("zh-TW", { maximumFractionDigits })}萬`;
}

function currentFundForPurchase(item) {
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

function monthlyNavForPurchase(item) {
  const items = monthlyNavMeta.items || {};
  const direct = items[item.fund_id];
  if (direct) {
    return direct;
  }
  const fund = currentFundForPurchase(item);
  const fundId = fund?.fundId || "";
  return fundId ? items[fundId] || null : null;
}

function upsertPeriodNav(rows, keyName, keyValue, date, nav) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const existingIndex = list.findIndex((row) => row?.[keyName] === keyValue);
  const nextRow = {
    ...(existingIndex >= 0 ? list[existingIndex] : {}),
    [keyName]: keyValue,
    date,
    nav
  };
  if (existingIndex >= 0) {
    list[existingIndex] = nextRow;
  } else {
    list.push(nextRow);
  }
  return list.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function applyLatestNavToPeriodData(item, fund) {
  const fundId = String(item?.fundId || "");
  const nav = Number(item?.nav);
  const navFullDate = String(item?.navFullDate || "");
  if (!fundId || !Number.isFinite(nav) || nav <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(navFullDate)) {
    return false;
  }
  monthlyNavMeta.items = monthlyNavMeta.items || {};
  const existing = monthlyNavMeta.items[fundId] || {
    fundId,
    name: fund?.name || fundId,
    months: [],
    weeks: [],
    days: []
  };
  const monthKey = monthKeyFromDate(navFullDate);
  const weekKey = weekKeyFromDate(navFullDate);
  existing.fundId = fundId;
  existing.name = existing.name || fund?.name || fundId;
  existing.months = upsertPeriodNav(existing.months, "month", monthKey, navFullDate, nav);
  existing.weeks = upsertPeriodNav(existing.weeks, "week", weekKey, navFullDate, nav);
  existing.days = upsertPeriodNav(existing.days, "day", navFullDate, navFullDate, nav);
  monthlyNavMeta.items[fundId] = existing;
  return true;
}

function monthKeyFromDate(value) {
  return String(value || "").slice(0, 7) || "未填日期";
}

function weekKeyFromDate(value) {
  if (!value) {
    return "未填日期";
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "未填日期";
  }
  const target = new Date(date.valueOf());
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dayKeyFromDate(value) {
  return String(value || "").slice(0, 10) || "未填日期";
}

function periodIndex(period, periodType) {
  if (periodType === "day") {
    const time = Date.parse(`${period}T00:00:00Z`);
    return Number.isFinite(time) ? Math.floor(time / 86400000) : null;
  }
  if (periodType === "week") {
    const match = String(period || "").match(/^(\d{4})-W(\d{2})$/);
    if (!match) {
      return null;
    }
    return Number(match[1]) * 60 + Number(match[2]);
  }
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 12 + Number(match[2]);
}

function periodsAreContinuous(previousPeriod, currentPeriod, periodType) {
  if (previousPeriod === currentPeriod) {
    return true;
  }
  if (periodType === "day") {
    return periodIndex(previousPeriod, "day") !== null && periodIndex(currentPeriod, "day") !== null;
  }
  const previous = periodIndex(previousPeriod, periodType);
  const current = periodIndex(currentPeriod, periodType);
  return previous !== null && current !== null && current - previous === 1;
}

function periodProfitRowsForPurchase(item, periodType) {
  const amount = Number(item.amount) || 0;
  const buyNav = Number(item.nav) || 0;
  const units = amount > 0 && buyNav > 0 ? amount / buyNav : 0;
  if (units <= 0) {
    return { rows: [], missing: true };
  }
  const sellNav = Number(item.sell_nav) || 0;
  const isSold = Boolean(item.sell_date);
  const hasSellNav = sellNav > 0;
  const navItem = monthlyNavForPurchase(item);
  const buyDate = String(item.buy_date || "");
  const sellDate = String(item.sell_date || "");
  const periodKey = periodType === "day" ? "day" : periodType === "week" ? "week" : "month";
  const periodFromDate = periodType === "day" ? dayKeyFromDate : periodType === "week" ? weekKeyFromDate : monthKeyFromDate;
  const sellPeriod = isSold ? periodFromDate(sellDate) : "";
  const sourceRows = periodType === "day" ? navItem?.days || [] : periodType === "week" ? navItem?.weeks || [] : navItem?.months || [];
  const points = sourceRows
    .filter((row) => row?.date && Number(row.nav) > 0)
    .filter((row) => row.date >= buyDate && (!isSold || row.date < sellDate))
    .map((row) => ({
      period: row[periodKey] || periodFromDate(row.date),
      date: row.date,
      nav: Number(row.nav)
    }));

  if (isSold && hasSellNav) {
    points.push({
      period: sellPeriod,
      date: sellDate,
      nav: sellNav
    });
  }

  let previousNav = buyNav;
  let previousPeriod = periodFromDate(buyDate);
  let hasBaseline = periodType !== "day";
  let hasGap = false;
  const rowsByPeriod = new Map();
  points
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((point) => {
      const isSalePoint = isSold && point.period === sellPeriod && point.date === sellDate;
      if (!hasBaseline && !isSalePoint && point.date > buyDate) {
        previousNav = point.nav;
        previousPeriod = point.period;
        hasBaseline = true;
        return;
      }
      hasBaseline = true;
      if (!periodsAreContinuous(previousPeriod, point.period, periodType)) {
        hasGap = true;
        if (!isSalePoint) {
          previousNav = point.nav;
          previousPeriod = point.period;
          return;
        }
      }
      const profit = units * (point.nav - previousNav);
      const periodValue = isSold && point.period === sellPeriod ? 0 : units * point.nav;
      const row = rowsByPeriod.get(point.period) || {
        period: point.period,
        date: point.date,
        profit: 0,
        invested: isSold && point.period === sellPeriod ? 0 : amount,
        value: periodValue,
        startNav: previousNav,
        endNav: point.nav,
        valued: 1
      };
      row.profit += profit;
      row.value = periodValue;
      row.endNav = point.nav;
      if (isSold && point.period === sellPeriod) {
        row.invested = 0;
        row.value = 0;
      }
      if (!row.date || point.date > row.date) {
        row.date = point.date;
      }
      rowsByPeriod.set(point.period, row);
      previousNav = point.nav;
      previousPeriod = point.period;
    });

  const rows = [...rowsByPeriod.values()];
  return { rows, missing: rows.length === 0 || hasGap || (isSold && !hasSellNav) };
}

function monthlyProfitRowsForPurchase(item) {
  return periodProfitRowsForPurchase(item, "month");
}

function weeklyProfitRowsForPurchase(item) {
  return periodProfitRowsForPurchase(item, "week");
}

function dailyProfitRowsForPurchase(item) {
  return periodProfitRowsForPurchase(item, "day");
}

function purchaseValuation(item) {
  const amount = Number(item.amount) || 0;
  const buyNav = Number(item.nav) || 0;
  const fund = currentFundForPurchase(item);
  const isManualFund = String(item.fund_id || "").startsWith("manual:");
  const currentNav = Number(fund?.nav) || (isManualFund ? buyNav : 0);
  const sellNav = Number(item.sell_nav) || 0;
  const sellAmount = Number(item.sell_amount) || 0;
  const isSold = Boolean(item.sell_date);
  const valueNav = isSold ? sellNav : currentNav;
  const units = amount > 0 && buyNav > 0 ? amount / buyNav : 0;
  if (units <= 0 || (sellAmount <= 0 && valueNav <= 0)) {
    return {
      fund,
      currentNav: valueNav,
      units,
      isSold,
      currentValue: null,
      profit: null,
      profitPercent: null
    };
  }
  const currentValue = isSold && sellAmount > 0 ? sellAmount : units * valueNav;
  const profit = currentValue - amount;
  return {
    fund,
    currentNav: valueNav,
    units,
    isSold,
    currentValue,
    profit,
    profitPercent: amount > 0 ? (profit / amount) * 100 : null
  };
}

function portfolioSummary(options = {}) {
  const includePeriods = options.includePeriods !== false;
  const summary = {
    invested: 0,
    valuedCostBasis: 0,
    currentValue: 0,
    realizedProfit: 0,
    unrealizedProfit: 0,
    valuedCount: 0,
    holdings: new Map(),
    months: new Map(),
    weeks: new Map(),
    days: new Map()
  };
  purchases.forEach((item) => {
    const amount = Number(item.amount) || 0;
    const valuation = purchaseValuation(item);
    const isActive = !valuation.isSold;
    if (isActive) {
      summary.invested += amount;
    }
    if (valuation.profit !== null) {
      summary.valuedCostBasis += amount;
      summary.valuedCount += 1;
      if (isActive) {
        summary.currentValue += valuation.currentValue;
        summary.unrealizedProfit += valuation.profit;
      } else {
        summary.realizedProfit += valuation.profit;
      }
    }
    if (isActive) {
      const key = item.fund_id || item.fund_name;
      const existing = summary.holdings.get(key) || {
        name: item.fund_name,
        invested: 0,
        currentValue: 0,
        valued: 0
      };
      existing.invested += amount;
      if (valuation.currentValue !== null) {
        existing.currentValue += valuation.currentValue;
        existing.valued += 1;
      }
      summary.holdings.set(key, existing);
    }

    if (!includePeriods) {
      return;
    }

    const monthly = monthlyProfitRowsForPurchase(item);
    if (monthly.missing && !monthly.rows.length) {
      const isActive = !item.sell_date;
      const fallbackValue = isActive && valuation.currentValue !== null ? valuation.currentValue : null;
      const fallbackProfit = fallbackValue !== null ? fallbackValue - amount : null;
      const fallbackDate = fallbackValue !== null ? valuation.fund?.navDate || item.buy_date : item.buy_date;
      const monthKey = monthKeyFromDate(item.buy_date);
      const month = summary.months.get(monthKey) || {
        key: monthKey,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      if (isActive) {
        month.invested += amount;
      }
      if (fallbackValue !== null) {
        month.value += fallbackValue;
        month.profit += fallbackProfit;
        month.valued += 1;
      }
      month.missing += 1;
      month.details.push({
        name: item.fund_name,
        invested: isActive ? amount : 0,
        value: fallbackValue,
        profit: fallbackProfit,
        startNav: Number(item.nav) || null,
        endNav: fallbackValue !== null ? valuation.currentNav : null,
        date: fallbackDate,
        missing: true
      });
      summary.months.set(monthKey, month);
    }
    monthly.rows.forEach((row) => {
      const month = summary.months.get(row.period) || {
        key: row.period,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      month.invested += row.invested;
      month.value += row.value;
      month.profit += row.profit;
      month.valued += row.valued;
      month.details.push({
        name: item.fund_name,
        invested: row.invested,
        value: row.value,
        profit: row.profit,
        startNav: row.startNav,
        endNav: row.endNav,
        date: row.date,
        missing: false
      });
      summary.months.set(row.period, month);
    });
    const buyMonthKey = monthKeyFromDate(item.buy_date);
    if (monthly.rows.length && !monthly.rows.some((row) => row.period === buyMonthKey)) {
      const month = summary.months.get(buyMonthKey) || {
        key: buyMonthKey,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      month.invested += amount;
      month.value += amount;
      month.valued += 1;
      month.details.push({
        name: item.fund_name,
        invested: amount,
        value: amount,
        profit: 0,
        startNav: Number(item.nav) || null,
        endNav: Number(item.nav) || null,
        date: item.buy_date,
        missing: false
      });
      summary.months.set(buyMonthKey, month);
    }

    const weekly = weeklyProfitRowsForPurchase(item);
    if (weekly.missing && !weekly.rows.length) {
      const isActive = !item.sell_date;
      const fallbackValue = isActive && valuation.currentValue !== null ? valuation.currentValue : null;
      const fallbackProfit = fallbackValue !== null ? fallbackValue - amount : null;
      const fallbackDate = fallbackValue !== null ? valuation.fund?.navDate || item.buy_date : item.buy_date;
      const weekKey = weekKeyFromDate(item.buy_date);
      const week = summary.weeks.get(weekKey) || {
        key: weekKey,
        date: fallbackDate,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      if (isActive) {
        week.invested += amount;
      }
      if (fallbackValue !== null) {
        week.value += fallbackValue;
        week.profit += fallbackProfit;
        week.valued += 1;
        if (!week.date || fallbackDate > week.date) {
          week.date = fallbackDate;
        }
      }
      week.missing += 1;
      week.details.push({
        name: item.fund_name,
        invested: isActive ? amount : 0,
        value: fallbackValue,
        profit: fallbackProfit,
        startNav: Number(item.nav) || null,
        endNav: fallbackValue !== null ? valuation.currentNav : null,
        date: fallbackDate,
        missing: true
      });
      summary.weeks.set(weekKey, week);
    }
    weekly.rows.forEach((row) => {
      const week = summary.weeks.get(row.period) || {
        key: row.period,
        date: row.date,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      if (!week.date || row.date > week.date) {
        week.date = row.date;
      }
      week.invested += row.invested;
      week.value += row.value;
      week.profit += row.profit;
      week.valued += row.valued;
      week.details.push({
        name: item.fund_name,
        invested: row.invested,
        value: row.value,
        profit: row.profit,
        startNav: row.startNav,
        endNav: row.endNav,
        date: row.date,
        missing: false
      });
      summary.weeks.set(row.period, week);
    });
    const buyWeekKey = weekKeyFromDate(item.buy_date);
    if (weekly.rows.length && !weekly.rows.some((row) => row.period === buyWeekKey)) {
      const week = summary.weeks.get(buyWeekKey) || {
        key: buyWeekKey,
        date: item.buy_date,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      week.invested += amount;
      week.value += amount;
      week.valued += 1;
      week.details.push({
        name: item.fund_name,
        invested: amount,
        value: amount,
        profit: 0,
        startNav: Number(item.nav) || null,
        endNav: Number(item.nav) || null,
        date: item.buy_date,
        missing: false
      });
      summary.weeks.set(buyWeekKey, week);
    }

    const daily = dailyProfitRowsForPurchase(item);
    daily.rows.forEach((row) => {
      const day = summary.days.get(row.period) || {
        key: row.period,
        date: row.date,
        invested: 0,
        value: 0,
        profit: 0,
        valued: 0,
        missing: 0,
        details: []
      };
      if (!day.date || row.date > day.date) {
        day.date = row.date;
      }
      day.invested += row.invested;
      day.value += row.value;
      day.profit += row.profit;
      day.valued += row.valued;
      day.details.push({
        name: item.fund_name,
        invested: row.invested,
        value: row.value,
        profit: row.profit,
        startNav: row.startNav,
        endNav: row.endNav,
        date: row.date,
        missing: false
      });
      summary.days.set(row.period, day);
    });
  });
  return summary;
}

function portfolioSnapshotSource() {
  return monthlyNavMeta.updatedAt || sourceMeta.updatedAt || "no-source-time";
}

function resetPortfolioSnapshots() {
  portfolioPeriodSnapshots = {
    loaded: false,
    supported: true,
    sourceUpdatedAt: null,
    months: new Map(),
    weeks: new Map(),
    days: new Map()
  };
}

function periodMapFromSnapshotRows(rows, periodType) {
  return new Map(
    rows
      .filter((row) => row.period_type === periodType)
      .map((row) => [
        row.period_key,
        {
          key: row.period_key,
          date: row.period_date || null,
          invested: Number(row.invested) || 0,
          value: Number(row.value) || 0,
          profit: Number(row.profit) || 0,
          valued: Number(row.valued) || 0,
          missing: Number(row.missing) || 0,
          details: Array.isArray(row.details) ? row.details : []
        }
      ])
  );
}

async function loadPortfolioPeriodSnapshots() {
  if (!db || !currentUser) {
    resetPortfolioSnapshots();
    return;
  }
  try {
    const { data, error } = await db
      .from("portfolio_period_snapshots")
      .select("period_type,period_key,period_date,invested,value,profit,valued,missing,details,source_updated_at")
      .eq("user_id", currentUser.id);
    if (error) {
      throw error;
    }
    const rows = data || [];
    portfolioPeriodSnapshots = {
      loaded: true,
      supported: true,
      sourceUpdatedAt: rows[0]?.source_updated_at || null,
      months: periodMapFromSnapshotRows(rows, "month"),
      weeks: periodMapFromSnapshotRows(rows, "week"),
      days: periodMapFromSnapshotRows(rows, "day")
    };
  } catch (_error) {
    portfolioPeriodSnapshots = {
      loaded: false,
      supported: false,
      sourceUpdatedAt: null,
      months: new Map(),
      weeks: new Map(),
      days: new Map()
    };
  }
}

function snapshotRowsFromSummary(summary) {
  const sourceUpdatedAt = portfolioSnapshotSource();
  const rows = [];
  const pushRows = (periodType, periods) => {
    periods.forEach((item) => {
      rows.push({
        user_id: currentUser.id,
        period_type: periodType,
        period_key: item.key,
        period_date: item.date || null,
        invested: item.invested || 0,
        value: item.value || 0,
        profit: item.profit || 0,
        valued: item.valued || 0,
        missing: item.missing || 0,
        details: item.details || [],
        source_updated_at: sourceUpdatedAt
      });
    });
  };
  pushRows("month", summary.months);
  pushRows("week", summary.weeks);
  pushRows("day", summary.days);
  return rows;
}

async function savePortfolioPeriodSnapshots(summary) {
  if (!db || !currentUser || !portfolioPeriodSnapshots.supported || portfolioSnapshotsSaving) {
    return;
  }
  portfolioSnapshotsSaving = true;
  const rows = snapshotRowsFromSummary(summary);
  try {
    const deleteResult = await db.from("portfolio_period_snapshots").delete().eq("user_id", currentUser.id);
    if (deleteResult.error) {
      throw deleteResult.error;
    }
    for (let index = 0; index < rows.length; index += 500) {
      const { error } = await db.from("portfolio_period_snapshots").insert(rows.slice(index, index + 500));
      if (error) {
        throw error;
      }
    }
    portfolioPeriodSnapshots = {
      loaded: true,
      supported: true,
      sourceUpdatedAt: portfolioSnapshotSource(),
      months: new Map(summary.months),
      weeks: new Map(summary.weeks),
      days: new Map(summary.days)
    };
    portfolioSnapshotsDirty = false;
  } catch (_error) {
    portfolioPeriodSnapshots.supported = false;
  } finally {
    portfolioSnapshotsSaving = false;
  }
}

function markPortfolioSnapshotsDirty() {
  portfolioSnapshotsDirty = true;
}

function renderPeriodDetailsContent(details) {
  if (!details?.length) {
    return "";
  }
  const rows = [...details].sort((a, b) => Math.abs(Number(b.profit) || 0) - Math.abs(Number(a.profit) || 0));
  return rows
    .map((detail) => {
      const profit = Number(detail.profit);
      const hasProfit = detail.profit !== null && detail.profit !== undefined && Number.isFinite(profit);
      const profitClass = hasProfit ? (profit >= 0 ? "up" : "down") : "";
      const navText =
        detail.startNav && detail.endNav ? `${moneyNumber(detail.startNav)} -> ${moneyNumber(detail.endNav)}` : "缺淨值";
      return `
        <div class="period-detail-row">
          <span>${escapeHtml(detail.name || "未命名基金")}</span>
          <small>本${compactTwdWan(detail.invested)} / 現${detail.value === null ? "缺" : compactTwdWan(detail.value)} / ${navText}${detail.date ? ` / ${escapeHtml(detail.date)}` : ""}</small>
          <strong class="${profitClass}">${hasProfit ? twd(profit) : "缺資料"}</strong>
        </div>
      `;
    })
    .join("");
}

function periodDetailButton(key, label, className) {
  return `<button class="period-profit-button ${className}" type="button" data-period-detail="${escapeHtml(key)}">${label}</button>`;
}

function periodDisplayLabel(item, periodType) {
  if (periodType === "week" || periodType === "day") {
    return item.date ? item.date.slice(5).replace("-", "/") : item.key;
  }
  return item.key === "未填日期" ? item.key : item.key.slice(5);
}

function periodDetailTitleLabel(item, periodType) {
  if (periodType === "week" || periodType === "day") {
    return item.date || item.key;
  }
  return item.key === "未填日期" ? item.key : item.key.replace("-", "/");
}

function periodHistoryYear(item, periodType) {
  if (periodType === "week" || periodType === "day") {
    return String(item.date || item.key || "").slice(0, 4) || "未填日期";
  }
  return String(item.key || "").slice(0, 4) || "未填日期";
}

function renderPeriodRow(item, periodType) {
  const profit = item.profit || 0;
  const percent = item.invested > 0 && item.valued > 0 ? (profit / item.invested) * 100 : null;
  const profitClass = profit >= 0 ? "up" : "down";
  const label = periodDisplayLabel(item, periodType);
  const investedText = compactTwdWan(item.invested);
  const valueText = item.valued ? compactTwdWan(item.value) : "缺";
  const detailKey = `${periodType}:${item.key}`;
  const profitLabel = item.valued ? `${twd(profit)} ${percent === null ? "" : `(${formatPercent(percent)})`}` : "-";
  periodDetailStore.set(detailKey, {
    title: `${periodDetailTitleLabel(item, periodType)} 明細`,
    details: item.details || []
  });
  return `
    <div class="period-row">
      <p>
        <span class="period-text">
          <span class="period-prefix">${escapeHtml(label)}：</span>
          <span class="period-amounts">
            <span>本${escapeHtml(investedText)} /</span>
            <span>現${escapeHtml(valueText)}</span>
          </span>
        </span>
        ${periodDetailButton(detailKey, profitLabel, profitClass)}
      </p>
    </div>
  `;
}

function renderPeriodHistoryContent(rows, periodType) {
  const groups = new Map();
  rows.forEach((item) => {
    const year = periodHistoryYear(item, periodType);
    const items = groups.get(year) || [];
    items.push(item);
    groups.set(year, items);
  });
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, items], index) => `
      <details class="period-year" ${index === 0 ? "open" : ""}>
        <summary>${escapeHtml(year)} 年（${items.length} 筆）</summary>
        ${items.map((item) => renderPeriodRow(item, periodType)).join("")}
      </details>
    `)
    .join("");
}

function ensurePeriodDetailModal() {
  let modal = document.querySelector("#periodDetailModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "periodDetailModal";
  modal.className = "period-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="period-modal-panel" role="dialog" aria-modal="true" aria-labelledby="periodDetailTitle">
      <button class="period-modal-close" type="button" aria-label="關閉">×</button>
      <h3 id="periodDetailTitle"></h3>
      <div class="period-modal-body"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-period-detail]");
    if (detailButton) {
      showPeriodDetailModal(detailButton.dataset.periodDetail);
      return;
    }
    if (event.target === modal || event.target.closest(".period-modal-close")) {
      hidePeriodDetailModal();
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function showPeriodDetailModal(key) {
  const data = periodDetailStore.get(key);
  if (!data) {
    return;
  }
  const modal = ensurePeriodDetailModal();
  modal.querySelector("#periodDetailTitle").textContent = data.title;
  modal.querySelector(".period-modal-body").innerHTML = renderPeriodDetailsContent(data.details);
  modal.hidden = false;
}

function showPeriodHistoryModal(key) {
  const data = periodHistoryStore.get(key);
  if (!data) {
    return;
  }
  const modal = ensurePeriodDetailModal();
  modal.querySelector("#periodDetailTitle").textContent = data.title;
  modal.querySelector(".period-modal-body").innerHTML = data.html;
  modal.hidden = false;
}

function hidePeriodDetailModal() {
  const modal = document.querySelector("#periodDetailModal");
  if (modal) {
    modal.hidden = true;
  }
}

function ensureSellModal() {
  let modal = document.querySelector("#sellModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "sellModal";
  modal.className = "period-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <form class="sell-modal-panel" role="dialog" aria-modal="true" aria-labelledby="sellModalTitle">
      <button class="period-modal-close" type="button" aria-label="關閉">×</button>
      <h3 id="sellModalTitle">記錄賣出</h3>
      <p class="sell-modal-fund"></p>
      <label>
        賣出日期
        <input class="sell-date-input" type="date" required>
      </label>
      <label>
        賣出淨值
        <input class="sell-nav-input" type="number" min="0" step="0.0001" inputmode="decimal" required>
      </label>
      <div class="button-row">
        <button class="primary" type="submit">儲存賣出</button>
        <button class="sell-modal-cancel" type="button">取消</button>
      </div>
    </form>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".period-modal-close") || event.target.closest(".sell-modal-cancel")) {
      hideSellModal();
    }
  });
  modal.querySelector("form").addEventListener("submit", submitSellModal);
  document.body.appendChild(modal);
  return modal;
}

function showSellModal(item) {
  const valuation = purchaseValuation(item);
  const modal = ensureSellModal();
  modal.dataset.purchaseId = item.id;
  modal.querySelector(".sell-modal-fund").textContent = item.fund_name || "";
  modal.querySelector(".sell-date-input").value = item.sell_date || todayInputValue();
  modal.querySelector(".sell-nav-input").value = item.sell_nav || valuation.currentNav || "";
  modal.hidden = false;
  modal.querySelector(".sell-date-input").focus();
}

function hideSellModal() {
  const modal = document.querySelector("#sellModal");
  if (modal) {
    modal.hidden = true;
  }
}

async function submitSellModal(event) {
  event.preventDefault();
  const modal = ensureSellModal();
  const id = modal.dataset.purchaseId;
  const sellDate = modal.querySelector(".sell-date-input").value;
  const sellNav = Number(modal.querySelector(".sell-nav-input").value);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(sellDate) || !Number.isFinite(sellNav) || sellNav <= 0) {
    setMessage(els.purchaseMessage, "賣出日期或賣出淨值格式不正確。", true);
    return;
  }
  const { error } = await db
    .from("fund_purchases")
    .update({
      sell_date: sellDate,
      sell_nav: sellNav,
      sell_amount: null
    })
    .eq("id", id);
  if (error) {
    setMessage(els.purchaseMessage, `賣出紀錄失敗：${error.message}`, true);
    return;
  }
  hideSellModal();
  setMessage(els.purchaseMessage, "已記錄賣出。");
  markPortfolioSnapshotsDirty();
  await loadPurchases();
}

function renderPortfolioStats() {
  if (!els.portfolioStats) {
    return;
  }
  if (!currentUser || !purchases.length) {
    els.portfolioStats.innerHTML = "";
    return;
  }
  const currentSnapshotSource = portfolioSnapshotSource();
  const canUseSnapshots =
    portfolioPeriodSnapshots.loaded &&
    portfolioPeriodSnapshots.sourceUpdatedAt === currentSnapshotSource &&
    !portfolioSnapshotsDirty &&
    (portfolioPeriodSnapshots.months.size > 0 || portfolioPeriodSnapshots.weeks.size > 0 || portfolioPeriodSnapshots.days.size > 0);
  const summary = portfolioSummary({ includePeriods: !canUseSnapshots });
  if (canUseSnapshots) {
    summary.months = new Map(portfolioPeriodSnapshots.months);
    summary.weeks = new Map(portfolioPeriodSnapshots.weeks);
    summary.days = new Map(portfolioPeriodSnapshots.days);
  } else {
    void savePortfolioPeriodSnapshots(summary);
  }
  const profit = summary.realizedProfit + summary.unrealizedProfit;
  const profitPercent =
    summary.valuedCostBasis > 0 && summary.valuedCount > 0 ? (profit / summary.valuedCostBasis) * 100 : null;
  const profitClass = profit >= 0 ? "up" : "down";
  const topHoldings = [...summary.holdings.values()]
    .sort((a, b) => b.invested - a.invested)
    .slice(0, 3);
  const monthlyAllRows = [...summary.months.values()].sort((a, b) => b.key.localeCompare(a.key));
  const weeklyAllRows = [...summary.weeks.values()].sort((a, b) => b.key.localeCompare(a.key));
  const dailyAllRows = [...summary.days.values()].sort((a, b) => b.key.localeCompare(a.key));
  const monthlyRows = monthlyAllRows.slice(0, PERIOD_DISPLAY_LIMIT);
  const weeklyRows = weeklyAllRows.slice(0, PERIOD_DISPLAY_LIMIT);
  const dailyRows = dailyAllRows.slice(0, DAILY_PERIOD_DISPLAY_LIMIT);
  periodDetailStore = new Map();
  periodHistoryStore = new Map();
  if (monthlyAllRows.length > PERIOD_DISPLAY_LIMIT) {
    periodHistoryStore.set("month", {
      title: "每月歷史",
      html: renderPeriodHistoryContent(monthlyAllRows, "month")
    });
  }
  if (weeklyAllRows.length > PERIOD_DISPLAY_LIMIT) {
    periodHistoryStore.set("week", {
      title: "每週歷史",
      html: renderPeriodHistoryContent(weeklyAllRows, "week")
    });
  }
  els.portfolioStats.innerHTML = `
    <div class="portfolio-stat">
      <span>投入金額</span>
      <strong>${twd(summary.invested)}</strong>
    </div>
    <div class="portfolio-stat">
      <span>估算現值</span>
      <strong>${summary.valuedCount ? twd(summary.currentValue) : "-"}</strong>
    </div>
    <div class="portfolio-stat">
      <span>總賺賠</span>
      <strong class="${profitClass}">${summary.valuedCount ? `${twd(profit)} ${profitPercent === null ? "" : `(${formatPercent(profitPercent)})`}` : "-"}</strong>
    </div>
    <div class="portfolio-stat">
      <span>可估算筆數</span>
      <strong>${summary.valuedCount} / ${purchases.length}</strong>
    </div>
    <div class="holding-breakdown">
      <h4>前三大投入</h4>
      ${
        topHoldings.length
          ? topHoldings.map((item) => `<p>${escapeHtml(item.name)}：${twd(item.invested)}</p>`).join("")
          : "<p>尚無資料</p>"
      }
    </div>
    <div class="monthly-breakdown">
      <h4>每月賺賠</h4>
      ${
        monthlyRows.length
          ? monthlyRows.map((item) => renderPeriodRow(item, "month")).join("")
          : "<p>尚無資料</p>"
      }
      ${monthlyAllRows.length > PERIOD_DISPLAY_LIMIT ? `<button class="period-history-button" type="button" data-period-history="month">看全部每月歷史（${monthlyAllRows.length} 筆）</button>` : ""}
    </div>
    <div class="weekly-breakdown">
      <h4>每週賺賠</h4>
      ${
        weeklyRows.length
          ? weeklyRows.map((item) => renderPeriodRow(item, "week")).join("")
          : "<p>尚無資料</p>"
      }
      ${weeklyAllRows.length > PERIOD_DISPLAY_LIMIT ? `<button class="period-history-button" type="button" data-period-history="week">看全部每週歷史（${weeklyAllRows.length} 筆）</button>` : ""}
    </div>
    <div class="daily-breakdown">
      <h4>每天賺賠</h4>
      ${
        dailyRows.length
          ? dailyRows.map((item) => renderPeriodRow(item, "day")).join("")
          : "<p>尚無資料</p>"
      }
    </div>
  `;
  document.querySelectorAll("[data-period-detail]").forEach((button) => {
    button.addEventListener("click", () => showPeriodDetailModal(button.dataset.periodDetail));
  });
  document.querySelectorAll("[data-period-history]").forEach((button) => {
    button.addEventListener("click", () => showPeriodHistoryModal(button.dataset.periodHistory));
  });
}

function renderAuthState() {
  if (!els.authStatus) {
    return;
  }
  if (!db) {
    els.authStatus.textContent = "登入服務未載入";
    setMessage(els.authMessage, "Supabase 載入失敗，請重新整理。", true);
    return;
  }
  const loggedIn = Boolean(currentUser);
  els.authStatus.textContent = loggedIn ? "已登入" : "尚未登入";
  if (els.authForm) {
    els.authForm.hidden = loggedIn;
  }
  if (els.accountPanel) {
    els.accountPanel.hidden = !loggedIn;
  }
  if (els.accountEmail) {
    els.accountEmail.textContent = currentUser?.email || "";
  }
}

function requireLogin() {
  if (currentUser) {
    return true;
  }
  setMessage(els.authMessage, "請先登入，再記錄買入基金。", true);
  document.querySelector("#portfolio")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return false;
}

function setPurchaseFund(fund) {
  if (!requireLogin()) {
    return;
  }
  if (!isPortfolioView) {
    window.sessionStorage.setItem(
      "pendingPurchaseFund",
      JSON.stringify({
        fundId: fundLookupKey(fund),
        name: fund.name,
        nav: typeof fund.nav === "number" && fund.nav > 0 ? fund.nav : null
      })
    );
    window.location.href = "?view=portfolio";
    return;
  }
  els.purchaseFundId.value = fundLookupKey(fund);
  els.purchaseFundName.value = fund.name;
  els.purchaseDate.value = els.purchaseDate.value || todayInputValue();
  if (typeof fund.nav === "number" && fund.nav > 0) {
    els.purchaseNav.value = fund.nav;
  }
  setMessage(els.purchaseMessage, "");
  els.purchaseAmount.focus();
}

function applyPendingPurchaseFund() {
  if (!isPortfolioView || !els.purchaseFundId || !els.purchaseFundName) {
    return;
  }
  const raw = window.sessionStorage.getItem("pendingPurchaseFund");
  if (!raw) {
    return;
  }
  window.sessionStorage.removeItem("pendingPurchaseFund");
  try {
    const fund = JSON.parse(raw);
    els.purchaseFundId.value = fund.fundId || "";
    els.purchaseFundName.value = fund.name || "";
    els.purchaseDate.value = els.purchaseDate.value || todayInputValue();
    if (fund.nav) {
      els.purchaseNav.value = fund.nav;
    }
    setMessage(els.purchaseMessage, "");
    els.purchaseAmount.focus();
  } catch (_error) {
    // Ignore stale session data.
  }
}

function renderPurchases() {
  if (!els.purchaseList) {
    return;
  }
  if (!currentUser) {
    if (els.portfolioStats) {
      els.portfolioStats.innerHTML = "";
    }
    els.purchaseList.innerHTML = '<div class="empty">登入後會顯示你的買入紀錄。</div>';
    return;
  }
  if (!purchases.length) {
    if (els.portfolioStats) {
      els.portfolioStats.innerHTML = "";
    }
    els.purchaseList.innerHTML = '<div class="empty">還沒有買入紀錄。</div>';
    return;
  }
  if (!fundDataLoaded) {
    if (els.portfolioStats) {
      els.portfolioStats.innerHTML = "";
    }
    els.purchaseList.innerHTML = '<div class="empty">基金資料尚未載入，暫不估算現值。</div>';
    return;
  }
  renderPortfolioStats();
  const sortByProfit = (items) => [...items].sort((a, b) => {
    const aProfit = purchaseValuation(a).profitPercent;
    const bProfit = purchaseValuation(b).profitPercent;
    if (aProfit === null && bProfit === null) {
      return String(b.buy_date).localeCompare(String(a.buy_date));
    }
    if (aProfit === null) {
      return 1;
    }
    if (bProfit === null) {
      return -1;
    }
    return bProfit - aProfit;
  });
  const sortSoldByDate = (items) => [...items].sort((a, b) => {
    const dateCompare = String(b.sell_date || "").localeCompare(String(a.sell_date || ""));
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(b.buy_date || "").localeCompare(String(a.buy_date || ""));
  });
  const renderPurchaseItem = (item) => {
    const valuation = purchaseValuation(item);
    const profitClass = (valuation.profit || 0) >= 0 ? "up" : "down";
    const matchedFund = valuation.fund;
    const currentDate = valuation.isSold ? item.sell_date : matchedFund?.navDate;
    const currentNavText = valuation.currentNav ? moneyNumber(valuation.currentNav) : "-";
    const currentAmountText = valuation.currentValue === null ? "-" : wholeMoneyNumber(valuation.currentValue);
    const valueLine = valuation.isSold
      ? `${escapeHtml(compactDate(currentDate))} / 金額 ${currentAmountText} / 淨值 ${currentNavText} / 賺賠`
      : `${escapeHtml(compactDate(currentDate))} / 金額 ${currentAmountText} / 淨值 ${currentNavText} / 損益`;
    return `
      <article class="purchase-item${valuation.isSold ? " sold" : ""}">
        <div>
          <div class="purchase-title">
            <h4>${renderPurchaseFundName(item, matchedFund)}</h4>
            ${renderPurchaseScore(matchedFund)}
          </div>
          <p>${escapeHtml(compactDate(item.buy_date))} / 金額 ${wholeMoneyNumber(item.amount)} / 淨值 ${moneyNumber(item.nav)}</p>
          <p>${valueLine} <strong class="${profitClass}">${valuation.profitPercent === null ? "-" : formatPercent(valuation.profitPercent)}</strong></p>
          ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
        </div>
        <div class="purchase-actions">
          <button type="button" data-edit-purchase="${escapeHtml(item.id)}">編輯</button>
          <button type="button" data-sell-purchase="${escapeHtml(item.id)}">${valuation.isSold ? "改賣出" : "賣出"}</button>
          ${valuation.isSold ? `<button type="button" data-clear-sale="${escapeHtml(item.id)}">取消賣出</button>` : ""}
          <button class="delete-purchase" type="button" data-delete-purchase="${escapeHtml(item.id)}">刪除</button>
        </div>
      </article>
    `;
  };
  const activePurchases = sortByProfit(purchases.filter((item) => !item.sell_date));
  const soldPurchases = sortSoldByDate(purchases.filter((item) => item.sell_date));
  els.purchaseList.innerHTML = `
    ${activePurchases.length ? activePurchases.map(renderPurchaseItem).join("") : '<div class="empty">目前沒有持有中的基金。</div>'}
    ${
      soldPurchases.length
        ? `
          <details class="sold-purchases">
            <summary>已賣出 ${soldPurchases.length} 筆</summary>
            ${soldPurchases.map(renderPurchaseItem).join("")}
          </details>
        `
        : ""
    }
  `;
  document.querySelectorAll("[data-delete-purchase]").forEach((button) => {
    button.addEventListener("click", () => deletePurchase(button.dataset.deletePurchase));
  });
  document.querySelectorAll("[data-edit-purchase]").forEach((button) => {
    button.addEventListener("click", () => editPurchase(button.dataset.editPurchase));
  });
  document.querySelectorAll("[data-sell-purchase]").forEach((button) => {
    button.addEventListener("click", () => markPurchaseSold(button.dataset.sellPurchase));
  });
  document.querySelectorAll("[data-clear-sale]").forEach((button) => {
    button.addEventListener("click", () => clearPurchaseSale(button.dataset.clearSale));
  });
}

async function loadPurchases(options = {}) {
  if (!db || !currentUser) {
    purchases = [];
    resetPortfolioSnapshots();
    if (options.render !== false) {
      renderPurchases();
    }
    return;
  }
  let { data, error } = await db
    .from("fund_purchases")
    .select("id,fund_id,fund_name,buy_date,amount,nav,sell_date,sell_nav,sell_amount,note,created_at")
    .order("buy_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error && /sell_/i.test(error.message || "")) {
    ({ data, error } = await db
      .from("fund_purchases")
      .select("id,fund_id,fund_name,buy_date,amount,nav,note,created_at")
      .order("buy_date", { ascending: false })
      .order("created_at", { ascending: false }));
  }
  if (error) {
    purchases = [];
    if (options.render !== false) {
      renderPurchases();
    }
    setMessage(els.purchaseMessage, `讀取失敗：${error.message}`, true);
    return;
  }
  purchases = data || [];
  await loadPortfolioPeriodSnapshots();
  if (options.requestNavHistory !== false) {
    requestOwnedFundNavHistory();
  }
  if (options.render !== false) {
    renderPurchases();
  }
}

async function requestOwnedFundNavHistory() {
  if (!db || !purchases.length) {
    return 0;
  }
  const requests = [...new Map(
    purchases
      .filter((item) => item.fund_id && !String(item.fund_id).startsWith("manual:"))
      .map((item) => [
        item.fund_id,
        {
          fund_id: item.fund_id,
          fund_name: item.fund_name,
          requested_at: new Date().toISOString()
        }
      ])
  ).values()];
  if (!requests.length) {
    return 0;
  }
  try {
    await db.from("fund_nav_requests").upsert(requests, { onConflict: "fund_id" });
    return requests.length;
  } catch (_error) {
    // The request table is optional; purchases must keep working if the migration has not been run.
    return 0;
  }
}

function purchaseNavSnapshot() {
  return new Map(
    purchases.map((item) => {
      const valuation = purchaseValuation(item);
      return [
        item.id,
        {
          nav: valuation.currentNav,
          value: valuation.currentValue,
          navDate: valuation.fund?.navDate || item.sell_date || ""
        }
      ];
    })
  );
}

function changedPurchaseNavCount(beforeSnapshot) {
  return purchases.reduce((count, item) => {
    const before = beforeSnapshot.get(item.id);
    if (!before) {
      return count;
    }
    const valuation = purchaseValuation(item);
    const next = {
      nav: valuation.currentNav,
      value: valuation.currentValue,
      navDate: valuation.fund?.navDate || item.sell_date || ""
    };
    return count + (before.nav !== next.nav || before.value !== next.value || before.navDate !== next.navDate ? 1 : 0);
  }, 0);
}

async function fetchLatestFundValues() {
  const response = await fetch("data/funds.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("找不到更新資料。");
  }
  const parsed = normalizePayload(await response.json());
  if (!parsed.funds.every(validateFund)) {
    throw new Error("更新資料格式不符合欄位需求。");
  }
  funds = parsed.funds;
  sourceMeta = parsed.meta;
  fundDataLoaded = true;
}

function applyLatestNavItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return 0;
  }
  const fundById = new Map(funds.map((fund) => [String(fund.fundId || ""), fund]));
  let updated = 0;
  let periodUpdated = false;
  items.forEach((item) => {
    const fundId = String(item?.fundId || "");
    const nav = Number(item?.nav);
    const navDate = String(item?.navDate || "");
    const fund = fundById.get(fundId);
    if (!fund || !Number.isFinite(nav) || nav <= 0 || !navDate) {
      return;
    }
    if (fund.nav !== nav || fund.navDate !== navDate) {
      updated += 1;
    }
    fund.nav = nav;
    fund.navDate = navDate;
    fund.navSource = item.navSource || "MoneyDJ mobile";
    periodUpdated = applyLatestNavToPeriodData(item, fund) || periodUpdated;
  });
  if (periodUpdated) {
    markPortfolioSnapshotsDirty();
  }
  return updated;
}

async function refreshOwnedFundNavFromFunction() {
  if (!db || !purchases.length) {
    return { updated: 0, unavailable: true };
  }
  const fundIds = [...new Set(
    purchases
      .map((item) => String(item.fund_id || "").trim())
      .filter((fundId) => fundId && !fundId.startsWith("manual:"))
  )];
  if (!fundIds.length) {
    return { updated: 0, unavailable: false };
  }
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token || SUPABASE_KEY;
  try {
    const response = await fetch(NAV_REFRESH_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ fundIds })
    });
    if (!response.ok) {
      return { updated: 0, unavailable: true };
    }
    const payload = await response.json();
    const updated = applyLatestNavItems(payload.items);
    return {
      updated,
      unavailable: false,
      fetched: Array.isArray(payload.items) ? payload.items.length : 0,
      failed: Array.isArray(payload.errors) ? payload.errors.length : 0
    };
  } catch (_error) {
    return { updated: 0, unavailable: true };
  }
}

async function loadMonthlyNavData() {
  try {
    const response = await fetch("data/monthly_nav.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("找不到月底淨值資料。");
    }
    const payload = await response.json();
    monthlyNavMeta = {
      source: payload.source || "月底淨值資料",
      updatedAt: payload.updatedAt || null,
      items: payload.items || {}
    };
  } catch (error) {
    monthlyNavMeta = {
      source: "月底淨值未載入",
      updatedAt: null,
      items: {}
    };
  } finally {
    renderPurchases();
  }
}

async function refreshPurchaseValues() {
  if (!requireLogin()) {
    return;
  }
  const originalText = els.refreshPurchases?.textContent || "更新淨值";
  if (els.refreshPurchases) {
    els.refreshPurchases.disabled = true;
    els.refreshPurchases.textContent = "更新中...";
  }
  setMessage(els.purchaseRefreshStatus, "正在更新淨值...");
  setMessage(els.purchaseMessage, "");
  try {
    await loadPurchases({ requestNavHistory: false, render: false });
    if (!purchases.length) {
      renderPurchases();
      setMessage(els.purchaseRefreshStatus, "目前沒有買入紀錄可更新。");
      return;
    }
    const requestedCount = await requestOwnedFundNavHistory();
    const beforeSnapshot = purchaseNavSnapshot();
    await fetchLatestFundValues();
    await loadMonthlyNavData();
    const instantRefresh = await refreshOwnedFundNavFromFunction();
    renderPurchases();
    const changedCount = changedPurchaseNavCount(beforeSnapshot);
    const dataTime = sourceMeta.updatedAt ? formatTaiwanDateTime(sourceMeta.updatedAt) : "最新資料";
    const instantText = instantRefresh.unavailable
      ? "，即時單檔更新尚未啟用"
      : `，即時檢查 ${instantRefresh.fetched || 0} 檔`;
    const requestText = requestedCount ? `，已排入 ${requestedCount} 檔後端更新` : "";
    const changeText = changedCount ? `，${changedCount} 筆有新淨值` : "，目前沒有新淨值";
    setMessage(els.purchaseRefreshStatus, `資料 ${dataTime}${changeText}${instantText}${requestText}`);
  } catch (error) {
    setMessage(els.purchaseRefreshStatus, `更新失敗：${error.message}`, true);
  } finally {
    if (els.refreshPurchases) {
      els.refreshPurchases.disabled = false;
      els.refreshPurchases.textContent = originalText;
    }
  }
}

async function savePurchase(event) {
  event.preventDefault();
  if (!requireLogin()) {
    return;
  }
  const typedFundName = els.purchaseFundName.value.trim();
  const fundId = els.purchaseFundId.value.trim() || (typedFundName ? `manual:${typedFundName}` : "");
  const fundName = typedFundName;
  const amount = Number(els.purchaseAmount.value);
  const nav = els.purchaseNav.value ? Number(els.purchaseNav.value) : null;
  if (!fundId || !fundName) {
    setMessage(els.purchaseMessage, "請先選基金，或直接輸入基金名稱。", true);
    return;
  }
  if (!els.purchaseDate.value || !Number.isFinite(amount) || amount <= 0) {
    setMessage(els.purchaseMessage, "請填買入日期和買入金額。", true);
    return;
  }
  const { error } = await db.from("fund_purchases").insert({
    user_id: currentUser.id,
    fund_id: fundId,
    fund_name: fundName,
    buy_date: els.purchaseDate.value,
    amount,
    nav,
    note: els.purchaseNote.value.trim() || null
  });
  if (error) {
    setMessage(els.purchaseMessage, `儲存失敗：${error.message}`, true);
    return;
  }
  els.purchaseAmount.value = "";
  els.purchaseNote.value = "";
  setMessage(els.purchaseMessage, "已儲存。");
  markPortfolioSnapshotsDirty();
  await loadPurchases();
}

async function deletePurchase(id) {
  if (!db || !currentUser || !id) {
    return;
  }
  if (!window.confirm("確定要刪除這筆買入紀錄？")) {
    return;
  }
  const { error } = await db.from("fund_purchases").delete().eq("id", id);
  if (error) {
    setMessage(els.purchaseMessage, `刪除失敗：${error.message}`, true);
    return;
  }
  setMessage(els.purchaseMessage, "已刪除。");
  markPortfolioSnapshotsDirty();
  await loadPurchases();
}

async function editPurchase(id) {
  if (!db || !currentUser || !id) {
    return;
  }
  const item = purchases.find((purchase) => purchase.id === id);
  if (!item) {
    return;
  }
  const isManualFund = String(item.fund_id || "").startsWith("manual:");
  const fundName = isManualFund ? window.prompt("基金名稱", item.fund_name || "") : item.fund_name;
  if (!fundName || !String(fundName).trim()) {
    return;
  }
  const buyDate = window.prompt("買入日期 YYYY-MM-DD", item.buy_date || todayInputValue());
  if (!buyDate) {
    return;
  }
  const amountText = window.prompt("買入金額", String(item.amount || ""));
  if (!amountText) {
    return;
  }
  const navText = window.prompt("買入淨值", item.nav ? String(item.nav) : "");
  const note = window.prompt("備註，可留空", item.note || "");
  const amount = Number(amountText);
  const nav = navText ? Number(navText) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buyDate) || !Number.isFinite(amount) || amount <= 0 || (nav !== null && (!Number.isFinite(nav) || nav < 0))) {
    setMessage(els.purchaseMessage, "買入日期、金額或淨值格式不正確。", true);
    return;
  }
  if (item.sell_date && buyDate > item.sell_date) {
    setMessage(els.purchaseMessage, "買入日期不能晚於賣出日期。", true);
    return;
  }
  const nextFundId = isManualFund ? `manual:${fundName.trim()}` : item.fund_id;
  const { error } = await db
    .from("fund_purchases")
    .update({
      fund_id: nextFundId,
      fund_name: fundName.trim(),
      buy_date: buyDate,
      amount,
      nav,
      note: note?.trim() || null
    })
    .eq("id", id);
  if (error) {
    setMessage(els.purchaseMessage, `更新失敗：${error.message}`, true);
    return;
  }
  setMessage(els.purchaseMessage, "已更新買入紀錄。");
  markPortfolioSnapshotsDirty();
  await loadPurchases();
}

function markPurchaseSold(id) {
  if (!db || !currentUser || !id) {
    return;
  }
  const item = purchases.find((purchase) => purchase.id === id);
  if (!item) {
    return;
  }
  showSellModal(item);
}

async function clearPurchaseSale(id) {
  if (!db || !currentUser || !id) {
    return;
  }
  if (!window.confirm("確定要取消這筆賣出紀錄？")) {
    return;
  }
  const { error } = await db
    .from("fund_purchases")
    .update({
      sell_date: null,
      sell_nav: null,
      sell_amount: null
    })
    .eq("id", id);
  if (error) {
    setMessage(els.purchaseMessage, `取消賣出失敗：${error.message}`, true);
    return;
  }
  setMessage(els.purchaseMessage, "已取消賣出。");
  markPortfolioSnapshotsDirty();
  await loadPurchases();
}

async function signIn() {
  if (!db) {
    return;
  }
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const { error } = await db.auth.signInWithPassword({ email, password });
  setMessage(els.authMessage, error ? `登入失敗：${error.message}` : "已登入。", Boolean(error));
}

async function signUp() {
  if (!db) {
    return;
  }
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const { error } = await db.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${SITE_URL}?view=portfolio`
    }
  });
  setMessage(els.authMessage, error ? `註冊失敗：${error.message}` : "註冊完成，請依 Supabase 設定確認 email 後登入。", Boolean(error));
}

async function signOut() {
  if (!db) {
    return;
  }
  await db.auth.signOut();
}

async function initAuth() {
  renderAuthState();
  renderPurchases();
  if (!db) {
    return;
  }
  const { data } = await db.auth.getSession();
  currentUser = data.session?.user || null;
  renderAuthState();
  await loadPurchases();
  db.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    renderAuthState();
    renderFunds();
    await loadPurchases();
  });
}

function visibleTags(tags) {
  return (tags || []).filter((tag) => {
    const text = String(tag).trim();
    return text && !/^RR\s*\d+$/i.test(text) && !["富邦銀行可買", "基富通可買"].includes(text);
  });
}

function compactTag(tag) {
  const text = String(tag || "").trim();
  if (text === "國內股票開放型一般股票型") {
    return "國內股票";
  }
  if (text.startsWith("國內股票開放型")) {
    return text.replace("國內股票開放型", "國內").slice(0, 8);
  }
  return text;
}

function navTag(fund) {
  if (typeof fund.nav !== "number" || !Number.isFinite(fund.nav) || fund.nav <= 0) {
    return "";
  }
  return `<span class="pill nav-pill">淨值 ${moneyNumber(fund.nav)}</span>`;
}

function performanceTag(label, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return `<span class="pill">${escapeHtml(label)} ${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%</span>`;
}

function renderCompactBuyLink(fund) {
  if (fund.fubonBuyUrl) {
    const navHint = typeof fund.nav === "number" && Number.isFinite(fund.nav) ? `，先核對淨值 ${moneyNumber(fund.nav)}${fund.navDate ? ` / ${fund.navDate}` : ""}` : "";
    return `<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}" title="請在富邦確認基金名稱與淨值${escapeHtml(navHint)}">富邦</a>`;
  }
  if (fund.fundrichAppUrl) {
    return `<a class="buy-link secondary" href="${escapeHtml(fund.fundrichAppUrl)}">基富通</a>`;
  }
  return "";
}

function renderMetrics(list) {
  const total = list.length;
  const avgReturn = total ? list.reduce((sum, fund) => sum + fund.return3y, 0) / total : 0;

  els.metricTotal.textContent = total;
  els.metricReturn.textContent = `${avgReturn.toFixed(1)}%`;
}

function renderDataStatus() {
  if (!sourceMeta.updatedAt) {
    els.dataStatus.textContent = sourceMeta.source;
    return;
  }

  els.dataStatus.textContent = `${formatTaiwanDateTime(sourceMeta.updatedAt)} 台灣時間，市場非即時`;
}

function renderMarkets() {
  if (!els.marketList) {
    return;
  }
  const marketsById = new Map(marketMeta.markets.map((market) => [market.id, market]));
  const visibleMarkets = MARKET_DISPLAY_IDS.map((id) => marketsById.get(id)).filter(Boolean);
  if (!visibleMarkets.length) {
    els.marketList.innerHTML = '<div class="market-empty">市場資料暫無法更新</div>';
    return;
  }
  els.marketList.innerHTML = visibleMarkets
    .map((market) => {
      const displayLabel = MARKET_DISPLAY_LABELS[market.id] || market.label;
      const moveClass = market.changePercent >= 0 ? "up" : "down";
      const url = market.url || marketUrl(market);
      const label = url
        ? `<a class="quote-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(displayLabel)}</a>`
        : `<span>${escapeHtml(displayLabel)}</span>`;
      return `
        <div class="quote-row">
          <div>
            ${label}
          </div>
          <strong>${formatMarketPrice(market.price)}</strong>
          <em class="${moveClass}">${formatPercent(market.changePercent)}</em>
        </div>
      `;
    })
    .join("");
}

function marketUrl(market) {
  const fixedUrls = {
    txf: "https://tw.stock.yahoo.com/quote/WTX%26",
    twii: "https://tw.stock.yahoo.com/quote/%5ETWII",
    sp500: "https://tw.stock.yahoo.com/quote/%5EGSPC",
    nasdaq: "https://tw.stock.yahoo.com/quote/%5EIXIC",
    nasdaqFuture: "https://tw.stock.yahoo.com/quote/NQ%3DF",
    nikkei: "https://tw.stock.yahoo.com/quote/%5EN225",
    kospi: "https://tw.stock.yahoo.com/quote/%5EKS11"
  };
  if (fixedUrls[market.id]) {
    return fixedUrls[market.id];
  }
  if (market.symbol) {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(market.symbol)}`;
  }
  return "";
}

function renderFunds() {
  const list = filteredFunds();
  const visibleCount = Math.min(fundDisplayLimit, list.length);
  const visibleList = list.slice(0, visibleCount);
  els.count.textContent = list.length > visibleCount ? `${list.length} 檔符合，顯示前 ${visibleCount} 檔` : `${list.length} 檔符合`;
  renderMetrics(list);
  renderDataStatus();
  renderScoreExplain();

  if (!visibleList.length) {
    els.grid.innerHTML = '<div class="empty">沒有符合條件的基金，放寬風險或報酬門檻再試一次。</div>';
    return;
  }

  const cardsHtml = visibleList
    .map((fund) => {
      const twoWeek = compactBenchmarkStatus(fund, "2w");
      const oneMonth = compactBenchmarkStatus(fund, "1m");
      const benchmarkDate = twoWeek.date || oneMonth.date;
      return `
        <article class="fund-card fund-list-row">
          <div class="fund-head">
            <h3>${renderFundName(fund)}</h3>
            <div class="score compact-score" title="${scoreTitle()}">${fund.score}</div>
          </div>
          <div class="fund-action-row">
            <div class="fund-info-block">
              <div class="pill-row">
                ${navTag(fund)}
                ${performanceTag("3月", fund.return3m)}
                ${performanceTag("1年", fund.return1y)}
              </div>
              <div class="metric-strip">
                <div class="metric-line">
                  <span>3年年化</span><strong>${fund.return3y.toFixed(1)}%</strong>
                  <span>波動度</span><strong>${fund.volatility.toFixed(1)}%</strong>
                </div>
                <div class="metric-line">
                  <span class="${twoWeek.className}">${twoWeek.label}</span><strong class="${twoWeek.className}">${typeof twoWeek.valueNumber === "number" ? formatCompactPercent(twoWeek.valueNumber) : twoWeek.value}</strong>
                  <span class="${oneMonth.className}">${oneMonth.label}</span><strong class="${oneMonth.className}">${typeof oneMonth.valueNumber === "number" ? formatCompactPercent(oneMonth.valueNumber) : oneMonth.value}</strong>
                  ${benchmarkDate ? `<small>${escapeHtml(benchmarkDate)}</small>` : ""}
                </div>
              </div>
            </div>
            <div class="card-actions">
              ${renderCompactBuyLink(fund)}
              <button class="record-link" type="button" data-buy-fund="${escapeHtml(fundLookupKey(fund))}">記錄</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  const remainingCount = Math.max(0, list.length - visibleCount);
  els.grid.innerHTML = `${cardsHtml}${
    remainingCount
      ? `<button class="load-more-funds" type="button" data-load-more-funds>再顯示 ${Math.min(DISPLAY_LIMIT, remainingCount)} 檔<span>還有 ${remainingCount} 檔</span></button>`
      : ""
  }`;

  document.querySelectorAll("[data-buy-fund]").forEach((button) => {
    button.addEventListener("click", () => {
      const fund = funds.find((item) => fundLookupKey(item) === button.dataset.buyFund);
      if (fund) {
        setPurchaseFund(fund);
      }
    });
  });
  document.querySelector("[data-load-more-funds]")?.addEventListener("click", () => {
    fundDisplayLimit += DISPLAY_LIMIT;
    renderFunds();
  });

}

function syncLabels() {
  els.riskValue.textContent = els.risk.value;
  els.returnValue.textContent = Number(els.return.value).toLocaleString("zh-TW", { maximumFractionDigits: 1 });
}

function validateFund(item) {
  const required = ["name", "company", "type", "region", "risk", "return3y", "volatility", "sharpe", "aum", "dividend", "minRsp", "tags"];
  return required.every((key) => key in item) && Array.isArray(item.tags);
}

function isTaiwanDollarFund(fund) {
  const text = [fund.currency, fund.name, ...(fund.tags || [])].filter(Boolean).join(" ").toUpperCase();
  if (!text) {
    return false;
  }
  return ["台幣", "新台幣", "新臺幣", "TWD", "NTD"].some((keyword) => text.includes(keyword));
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) {
    return {
      funds: payload.filter(isTaiwanDollarFund),
      meta: {
        source: "匯入資料",
        updatedAt: null
      }
    };
  }

  if (payload && Array.isArray(payload.funds)) {
    return {
      funds: payload.funds.filter(isTaiwanDollarFund),
      meta: {
        source: payload.source || "自動更新資料",
        updatedAt: payload.updatedAt || null
      }
    };
  }

  throw new Error("資料格式不符合欄位需求。");
}

function resetFilters() {
  els.query.value = "";
  els.type.value = "non-etf";
  els.region.value = "all";
  els.risk.value = 5;
  els.return.value = 20;
  els.beatBenchmark.checked = false;
  els.sort.value = "score";
  document.querySelector("input[name='goal'][value='growth']").checked = true;
  fundDisplayLimit = DISPLAY_LIMIT;
  syncLabels();
  renderFunds();
}

[els.query, els.type, els.region, els.risk, els.return, els.beatBenchmark, els.sort].forEach((el) => {
  el.addEventListener("input", () => {
    fundDisplayLimit = DISPLAY_LIMIT;
    syncLabels();
    renderFunds();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hidePeriodDetailModal();
    hideSellModal();
  }
});

document.querySelectorAll("input[name='goal']").forEach((input) => input.addEventListener("change", () => {
  fundDisplayLimit = DISPLAY_LIMIT;
  renderFunds();
}));
els.reset.addEventListener("click", resetFilters);
els.signIn?.addEventListener("click", signIn);
els.signUp?.addEventListener("click", signUp);
els.signOut?.addEventListener("click", signOut);
els.purchaseForm?.addEventListener("submit", savePurchase);
els.purchaseFundName?.addEventListener("input", () => {
  els.purchaseFundId.value = "";
});
els.refreshPurchases?.addEventListener("click", refreshPurchaseValues);
if (els.purchaseDate) {
  els.purchaseDate.value = todayInputValue();
}
applyPendingPurchaseFund();

async function loadLatestData() {
  try {
    await fetchLatestFundValues();
  } catch (error) {
    sourceMeta = {
      source: "示範資料",
      updatedAt: null
    };
    fundDataLoaded = false;
  } finally {
    syncLabels();
    renderFunds();
    renderPurchases();
  }
}

async function loadMarketData() {
  try {
    const response = await fetch("data/markets.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("找不到市場資料。");
    }
    const payload = await response.json();
    marketMeta = {
      source: payload.source || "市場資料",
      updatedAt: payload.updatedAt || null,
      markets: Array.isArray(payload.markets) ? payload.markets : [],
      benchmarks: payload.benchmarks || {}
    };
  } catch (error) {
    marketMeta = {
      source: "市場資料未載入",
      updatedAt: null,
      markets: [],
      benchmarks: {}
    };
  } finally {
    renderMarkets();
    renderFunds();
  }
}

initAuth();
loadLatestData();
loadMonthlyNavData();
loadMarketData();
