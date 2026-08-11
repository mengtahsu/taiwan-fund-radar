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
let marginMeta = {
  source: "籌碼資料未載入",
  updatedAt: null,
  items: [],
  activeWindow: 66
};
const TWII_TREND_MONTHS = [2, 6, 12];
let twiiTrendMeta = {
  source: "台股均線資料未載入",
  updatedAt: null,
  items: [],
  activeMonths: 2,
  endIndex: null,
  visibleCount: 44
};
let twiiTrendDrag = null;
let showTwiiCapital = true;
let monthlyNavMeta = {
  source: "月底淨值未載入",
  updatedAt: null,
  items: {}
};

const DISPLAY_LIMIT = 50;
const PERIOD_DISPLAY_LIMIT = 12;
const DAILY_PERIOD_DISPLAY_LIMIT = 10;
const MAX_FUND_NAV_AGE_DAYS = 14;
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
const LOCAL_NAV_OVERRIDES_KEY = "taiwanFundRadar.latestNavOverrides.v1";
const LOCAL_NAV_OVERRIDE_MAX_AGE_DAYS = 7;
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
let fundBoxStore = new Map();
let fundTrailingBoxes = new Map();
let fundTrailingBoxesSupported = true;
let fundDisplayLimit = DISPLAY_LIMIT;
let portfolioPeriodsLoading = false;

const SNAPSHOT_SELECT =
  "period_type,period_key,period_date,invested,value,profit,valued,missing,details,source_updated_at";
const DAILY_CAPITAL_SELECT = "period_key,period_date,invested,source_updated_at";
const DAILY_CAPITAL_CHART_LIMIT = 370;

let portfolioDailyCapital = {
  loaded: false,
  sourceUpdatedAt: null,
  rows: []
};

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
  marginChart: document.querySelector("#marginChart"),
  marginStatus: document.querySelector("#marginStatus"),
  twiiTrendChart: document.querySelector("#twiiTrendChart"),
  twiiTrendStatus: document.querySelector("#twiiTrendStatus"),
  twiiCapitalToggle: document.querySelector("#twiiCapitalToggle"),
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

function sourceDateForNavAge() {
  const date = new Date(sourceMeta.updatedAt || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function parseShortNavDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const sourceDate = sourceDateForNavAge();
  const year = sourceDate.getFullYear();
  const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
  if (date.getTime() - sourceDate.getTime() > 31 * 86400000) {
    date.setFullYear(year - 1);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

function navDateComparableValue(value) {
  const fullDate = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(fullDate)) {
    return new Date(`${fullDate}T00:00:00`).getTime();
  }
  const shortDate = parseShortNavDate(fullDate);
  return shortDate ? shortDate.getTime() : null;
}

function isOverrideFresh(record) {
  const fetchedAt = new Date(record?.fetchedAt || 0);
  if (Number.isNaN(fetchedAt.getTime())) {
    return false;
  }
  return Date.now() - fetchedAt.getTime() <= LOCAL_NAV_OVERRIDE_MAX_AGE_DAYS * 86400000;
}

function loadLocalNavOverrides() {
  try {
    const payload = JSON.parse(window.localStorage.getItem(LOCAL_NAV_OVERRIDES_KEY) || "{}");
    return payload && typeof payload === "object" ? payload : {};
  } catch (_error) {
    return {};
  }
}

function saveLocalNavOverrides(records) {
  try {
    const freshRecords = Object.fromEntries(
      Object.entries(records || {}).filter(([, record]) => isOverrideFresh(record))
    );
    window.localStorage.setItem(LOCAL_NAV_OVERRIDES_KEY, JSON.stringify(freshRecords));
  } catch (_error) {
    // Local persistence is an optimization; the page should keep working without it.
  }
}

function persistLatestNavItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return;
  }
  const records = loadLocalNavOverrides();
  items.forEach((item) => {
    const fundId = String(item?.fundId || "");
    const nav = Number(item?.nav);
    const navDate = String(item?.navDate || "");
    if (!fundId || !Number.isFinite(nav) || nav <= 0 || !navDate) {
      return;
    }
    records[fundId] = {
      fundId,
      nav,
      navDate,
      navFullDate: item.navFullDate || "",
      navSource: item.navSource || "MoneyDJ mobile",
      fetchedAt: new Date().toISOString()
    };
  });
  saveLocalNavOverrides(records);
}

function navAgeDays(fund) {
  const date = parseShortNavDate(fund.navDate);
  if (!date) {
    return Infinity;
  }
  return Math.floor((sourceDateForNavAge() - date) / 86400000);
}

function hasFreshNav(fund) {
  return navAgeDays(fund) <= MAX_FUND_NAV_AGE_DAYS;
}

function shouldApplyNavOverride(fund, record) {
  if (!isOverrideFresh(record)) {
    return false;
  }
  const recordDate = navDateComparableValue(record.navFullDate || record.navDate);
  const fundDate = navDateComparableValue(fund.navDate);
  if (recordDate === null) {
    return false;
  }
  return fundDate === null || recordDate >= fundDate;
}

function applyLocalNavOverridesToFunds() {
  const records = loadLocalNavOverrides();
  const fundById = new Map(funds.map((fund) => [String(fund.fundId || ""), fund]));
  let applied = 0;
  Object.entries(records).forEach(([fundId, record]) => {
    const fund = fundById.get(fundId);
    const nav = Number(record?.nav);
    if (!fund || !Number.isFinite(nav) || nav <= 0 || !record?.navDate || !shouldApplyNavOverride(fund, record)) {
      return;
    }
    fund.nav = nav;
    fund.navDate = String(record.navDate);
    fund.navSource = record.navSource || "MoneyDJ mobile";
    applyLatestNavToPeriodData(record, fund);
    applied += 1;
  });
  saveLocalNavOverrides(records);
  if (applied > 0) {
    markPortfolioSnapshotsDirty();
  }
  return applied;
}

function performanceScoreParts(fund) {
  return [
    { label: "近 1 月績效", detail: scorePercentValue(fund.return1m), score: Number(fund.return1m) || 0, factor: 2, factorLabel: "2" },
    { label: "近 3 月績效", detail: scorePercentValue(fund.return3m), score: Number(fund.return3m) || 0, factor: 2, factorLabel: "2" },
    { label: "近 6 月績效", detail: scorePercentValue(fund.return6m), score: Number(fund.return6m) || 0, factor: 0.5, factorLabel: "0.5" },
    { label: "近 1 年績效", detail: scorePercentValue(fund.return1y), score: Number(fund.return1y) || 0, factor: 0.2, factorLabel: "0.2" }
  ];
}

function scoreBreakdown(fund) {
  const currentGoal = goal();
  const riskFit = (1 - Math.max(0, fund.risk - Number(els.risk.value)) / 4) * 100;
  const stabilityScore = (1 - clamp(fund.volatility / 28, 0, 1)) * 100;
  const incomeScore = fund.dividend.includes("配") ? 100 : 35;
  const sharpeScore = clamp(fund.sharpe / 2, 0, 1) * 100;
  const performanceParts = performanceScoreParts(fund);

  const scoreParts = {
    growth: [
      ...performanceParts,
      { label: "Sharpe", detail: Number(fund.sharpe).toFixed(2), score: sharpeScore, factor: 0.2, factorLabel: "20%" },
      { label: "風險符合度", detail: `RR ${fund.risk} / 上限 RR ${els.risk.value}`, score: riskFit, factor: 0.1, factorLabel: "10%" }
    ],
    income: [
      ...performanceParts,
      { label: "配息型態", detail: fund.dividend, score: incomeScore, factor: 0.35, factorLabel: "35%" },
      { label: "低波動", detail: `波動度 ${fund.volatility.toFixed(1)}%`, score: stabilityScore, factor: 0.3, factorLabel: "30%" },
      { label: "風險符合度", detail: `RR ${fund.risk} / 上限 RR ${els.risk.value}`, score: riskFit, factor: 0.2, factorLabel: "20%" }
    ],
    stability: [
      ...performanceParts,
      { label: "低波動", detail: `波動度 ${fund.volatility.toFixed(1)}%`, score: stabilityScore, factor: 0.35, factorLabel: "35%" },
      { label: "風險符合度", detail: `RR ${fund.risk} / 上限 RR ${els.risk.value}`, score: riskFit, factor: 0.3, factorLabel: "30%" },
      { label: "Sharpe", detail: Number(fund.sharpe).toFixed(2), score: sharpeScore, factor: 0.2, factorLabel: "20%" }
    ]
  }[currentGoal];

  const total = scoreParts.reduce((sum, part) => sum + part.score * part.factor, 0);
  return {
    goal: currentGoal,
    goalLabel: { growth: "成長目標", income: "配息目標", stability: "穩健目標" }[currentGoal],
    parts: scoreParts,
    total,
    score: Math.round(total)
  };
}

function scoreFund(fund) {
  return scoreBreakdown(fund).score;
}

function scoreTitle() {
  return {
    growth: "自訂綜合分數：近 1 月績效 × 2、近 3 月績效 × 2、近 6 月績效 × 0.5、近 1 年績效 × 0.2，再加 Sharpe 20% 與風險符合度 10%。各期績效直接作為分數，沒有上限，缺資料為 0 分",
    income: "自訂綜合分數：近 1 月績效 × 2、近 3 月績效 × 2、近 6 月績效 × 0.5、近 1 年績效 × 0.2，再加配息型態 35%、低波動 30% 與風險符合度 20%。各期績效直接作為分數，沒有上限，缺資料為 0 分",
    stability: "自訂綜合分數：近 1 月績效 × 2、近 3 月績效 × 2、近 6 月績效 × 0.5、近 1 年績效 × 0.2，再加低波動 35%、風險符合度 30% 與 Sharpe 20%。各期績效直接作為分數，沒有上限，缺資料為 0 分"
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

function scorePercentValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "無資料";
}

function renderScoreDetail(fund) {
  const breakdown = scoreBreakdown(fund);
  const partRows = breakdown.parts
    .map((part) => {
      const points = part.score * part.factor;
      return `
        <div class="score-detail-row">
          <div><strong>${escapeHtml(part.label)}</strong><small>${escapeHtml(part.detail)}</small></div>
          <span>${part.score.toFixed(1)} × ${part.factorLabel}</span>
          <strong>${points.toFixed(1)}</strong>
        </div>
      `;
    })
    .join("");
  const sumText = breakdown.parts.map((part) => (part.score * part.factor).toFixed(1)).join(" + ");
  return `
    <div class="score-modal-summary">
      <div><span>綜合分數</span><strong>${breakdown.score}</strong></div>
      <small>${breakdown.goalLabel}</small>
    </div>
    <div class="score-detail-head"><span>項目</span><span>分數 × 倍率</span><span>得分</span></div>
    <div class="score-detail-list">${partRows}</div>
    <p class="score-total">${sumText} = ${breakdown.total.toFixed(1)} → ${breakdown.score}</p>
    <p class="score-modal-note">近 1 月與近 3 月績效各乘 2；近 6 月乘 0.5；近 1 年乘 0.2。漲幾 % 就是幾分，跌幾 % 就是負幾分，缺資料為 0 分，不另作換算或限制。Sharpe = 報酬 / 波動。分數只用來排序，不代表買賣建議。</p>
  `;
}

function ensureScoreModal() {
  let modal = document.querySelector("#scoreDetailModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "scoreDetailModal";
  modal.className = "period-modal score-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="period-modal-panel score-modal-panel" role="dialog" aria-modal="true" aria-labelledby="scoreDetailTitle">
      <button class="period-modal-close" type="button" aria-label="關閉">×</button>
      <h3 id="scoreDetailTitle"></h3>
      <div class="period-modal-body score-modal-body"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".period-modal-close")) {
      modal.hidden = true;
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function showScoreModal(fundKey) {
  const fund = funds.find((item) => fundLookupKey(item) === fundKey);
  if (!fund) {
    return;
  }
  const modal = ensureScoreModal();
  modal.querySelector("#scoreDetailTitle").textContent = displayFundName(fund.name);
  modal.querySelector(".score-modal-body").innerHTML = renderScoreDetail(fund);
  modal.hidden = false;
  modal.querySelector(".period-modal-close").focus();
}

function hideScoreModal() {
  const modal = document.querySelector("#scoreDetailModal");
  if (modal) {
    modal.hidden = true;
  }
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
        hasFreshNav(fund) &&
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
  return `<span class="purchase-score" role="button" tabindex="0" data-score-fund="${escapeHtml(fundLookupKey(matchedFund))}" title="查看綜合分數算法">${scoreFund(matchedFund)}</span>`;
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

function fundBoxKeyForPurchase(item) {
  const purchaseId = String(item?.id || "").trim();
  if (purchaseId) {
    return `purchase:${purchaseId}`;
  }
  return `purchase:${moneyDjFundId(item?.fund_id) || String(item?.fund_id || "manual")}:${item?.buy_date || "undated"}:${item?.created_at || ""}`;
}

function exactMonthlyNavForPurchase(item) {
  const items = monthlyNavMeta.items || {};
  const fundId = moneyDjFundId(item.fund_id);
  if (fundId && items[fundId]) {
    return items[fundId];
  }
  return items[item.fund_id] || null;
}

function isDistributingFund(fund, item) {
  const name = displayFundName(item?.fund_name || fund?.name || "");
  if (/(不配息|累積型|累積)/.test(name)) {
    return false;
  }
  if (/(月配息?|季配息?|年配息?|配息)/.test(name)) {
    return true;
  }
  const dividend = String(fund?.dividend || "").trim();
  if (dividend) {
    return dividend.includes("配") && !dividend.includes("不配") && !dividend.includes("累積");
  }
  return false;
}

function fundBoxPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  const percent = Math.abs(number) < 0.0005 ? 0 : number * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(digits)}%`;
}

function fundBoxWidthText(topValue, bottomValue) {
  const top = Number(topValue);
  const bottom = Number(bottomValue);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom >= top) {
    return "-";
  }
  return `${(((top - bottom) / top) * 100).toFixed(1)}%`;
}

function fundBoxStatusText(analysis) {
  const position = Number.isFinite(analysis.position) ? `${Math.round(analysis.position * 100)}%` : "-";
  switch (analysis.status) {
    case "inside":
      return `箱內${position}｜寬${fundBoxWidthText(analysis.top, analysis.bottom)}｜頂${moneyNumber(analysis.top)}｜底${moneyNumber(analysis.bottom)}`;
    case "trailing_breakdown":
      return `跌破箱底${fundBoxPercent(analysis.difference)}｜寬20.0%｜頂${moneyNumber(analysis.top)}｜底${moneyNumber(analysis.bottom)}`;
    case "distribution_unadjusted":
      return "配息未還原｜暫不判斷";
    case "stale":
      return `箱型待更新｜資料${compactDate(analysis.latest?.date)}`;
    case "insufficient":
      return "箱型資料不足";
    default:
      return "新箱形成中";
  }
}

function fundBoxToneClass(analysis) {
  if (analysis.tone === "danger") {
    return "danger";
  }
  if (analysis.tone === "positive") {
    return "positive";
  }
  if (["distribution_unadjusted", "stale", "insufficient"].includes(analysis.status)) {
    return "muted";
  }
  return "normal";
}

async function loadFundTrailingBoxes() {
  if (!db || !currentUser || !fundTrailingBoxesSupported) {
    fundTrailingBoxes = new Map();
    return;
  }
  const { data, error } = await db
    .from("fund_trailing_boxes")
    .select("fund_id,tracking_start_date,peak_nav,peak_date,updated_at")
    .eq("user_id", currentUser.id);
  if (error) {
    fundTrailingBoxesSupported = false;
    fundTrailingBoxes = new Map();
    return;
  }
  fundTrailingBoxes = new Map((data || []).map((row) => [String(row.fund_id), row]));
}

function persistFundTrailingBox(entry) {
  if (!currentUser || !entry?.key || !Number.isFinite(Number(entry.analysis?.top))) {
    return;
  }
  const existing = fundTrailingBoxes.get(entry.key);
  const trackingStartDate = entry.trackingStartDate;
  const peakNav = Number(entry.analysis.top);
  const peakDate = String(entry.analysis.peakDate || entry.analysis.latest?.date || trackingStartDate);
  const unchanged =
    existing &&
    Number(existing.peak_nav) === peakNav &&
    String(existing.peak_date) === peakDate &&
    String(existing.tracking_start_date) === trackingStartDate;
  if (unchanged) {
    return;
  }
  const row = {
    user_id: currentUser.id,
    fund_id: entry.key,
    tracking_start_date: trackingStartDate,
    peak_nav: peakNav,
    peak_date: peakDate,
    updated_at: new Date().toISOString()
  };
  fundTrailingBoxes.set(entry.key, row);
  if (!db || !fundTrailingBoxesSupported) {
    return;
  }
  void db
    .from("fund_trailing_boxes")
    .upsert(row, { onConflict: "user_id,fund_id" })
    .then(({ error }) => {
      if (error) {
        fundTrailingBoxesSupported = false;
      }
    });
}

function cleanupInactiveFundTrailingBoxes(activePurchases) {
  const activeIds = new Set(activePurchases.map(fundBoxKeyForPurchase));
  [...fundTrailingBoxes.keys()].forEach((fundId) => {
    if (activeIds.has(fundId)) {
      return;
    }
    fundTrailingBoxes.delete(fundId);
    if (db && currentUser && fundTrailingBoxesSupported) {
      void db
        .from("fund_trailing_boxes")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("fund_id", fundId);
    }
  });
}

function isoDateFromShortNavDate(value) {
  const date = parseShortNavDate(value);
  if (!date) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildFundBoxStore(activePurchases) {
  const nextStore = new Map();
  activePurchases.forEach((item) => {
    const key = fundBoxKeyForPurchase(item);
    const fund = currentFundForPurchase(item);
    const navItem = exactMonthlyNavForPurchase(item);
    const distributing = isDistributingFund(fund, item);
    const adjusted = navItem?.adjusted === true || navItem?.navType === "adjusted";
    const trackingStartDate = String(item.buy_date || "");
    const savedBox = fundTrailingBoxes.get(key);
    const persisted = savedBox?.tracking_start_date === trackingStartDate ? savedBox : null;
    // Daily rows are exact for the trailing high. Older weekly/monthly rows give
    // existing holdings a conservative bootstrap until future highs are saved.
    const navRows = [
      ...(navItem?.months || []),
      ...(navItem?.weeks || []),
      ...(navItem?.days || [])
    ];
    const exactHistoryStartDate = [...(navItem?.days || [])]
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")) && Number(row?.nav) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]?.date || "";
    const latestFundDate = isoDateFromShortNavDate(fund?.navDate);
    if (latestFundDate && Number.isFinite(Number(fund?.nav)) && Number(fund.nav) > 0) {
      navRows.push({ date: latestFundDate, nav: Number(fund.nav) });
    }
    const peakSeeds = [{ date: item.buy_date, nav: item.nav }];
    if (persisted?.peak_nav && persisted?.peak_date) {
      peakSeeds.push({ date: persisted.peak_date, nav: persisted.peak_nav });
    }
    const analysis = window.FundBox
      ? window.FundBox.analyzeFundBox(navRows, {
          distributing,
          adjusted,
          trackingStartDate,
          peakSeeds
        })
      : {
          version: "-",
          rows: [],
          segments: [],
          events: [],
          status: "insufficient",
          tone: "muted",
          latest: null
        };
    const entry = {
      key,
      fund,
      fundId: moneyDjFundId(item.fund_id),
      name: item.fund_name || fund?.name || key,
      navItem,
      distributing,
      adjusted,
      trackingStartDate,
      exactHistoryStartDate,
      bootstrapLimited: Boolean(
        trackingStartDate && exactHistoryStartDate && trackingStartDate < exactHistoryStartDate
      ),
      analysis,
      purchases: [item]
    };
    nextStore.set(key, entry);
    persistFundTrailingBox(entry);
  });
  fundBoxStore = nextStore;
}

function renderFundBoxTrigger(item) {
  const key = fundBoxKeyForPurchase(item);
  const entry = fundBoxStore.get(key);
  if (!entry) {
    return "";
  }
  const text = fundBoxStatusText(entry.analysis);
  return `
    <button class="fund-box-trigger ${fundBoxToneClass(entry.analysis)}" type="button" data-fund-box="${escapeHtml(key)}" aria-label="查看${escapeHtml(item.fund_name || "基金")}箱型詳細資料">
      ${escapeHtml(text)}
    </button>
  `;
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
  portfolioDailyCapital = {
    loaded: false,
    sourceUpdatedAt: null,
    rows: []
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

function recentPeriodMapFromSummaryMap(map, limit) {
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, limit));
}

async function fetchPortfolioSnapshotRows(periodType, limit) {
  let query = db
    .from("portfolio_period_snapshots")
    .select(SNAPSHOT_SELECT)
    .eq("user_id", currentUser.id)
    .eq("period_type", periodType)
    .order("period_key", { ascending: false });
  if (limit) {
    query = query.limit(limit);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

async function fetchPortfolioDailyCapitalRows() {
  const { data, error } = await db
    .from("portfolio_period_snapshots")
    .select(DAILY_CAPITAL_SELECT)
    .eq("user_id", currentUser.id)
    .eq("period_type", "day")
    .order("period_key", { ascending: false })
    .limit(DAILY_CAPITAL_CHART_LIMIT);
  if (error) {
    throw error;
  }
  return data || [];
}

function setPortfolioDailyCapital(rows, sourceUpdatedAt) {
  const normalizedRows = rows
    .map((row) => ({
      date: String(row.period_date || row.date || row.period_key || row.key || "").slice(0, 10),
      invested: Number(row.invested) || 0
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  portfolioDailyCapital = {
    loaded: normalizedRows.length > 0,
    sourceUpdatedAt: sourceUpdatedAt || null,
    rows: normalizedRows
  };
}

async function loadPortfolioPeriodSnapshots() {
  if (!db || !currentUser) {
    resetPortfolioSnapshots();
    return;
  }
  try {
    const [monthRows, weekRows, dayRows, dailyCapitalRows] = await Promise.all([
      fetchPortfolioSnapshotRows("month", PERIOD_DISPLAY_LIMIT),
      fetchPortfolioSnapshotRows("week", PERIOD_DISPLAY_LIMIT),
      fetchPortfolioSnapshotRows("day", DAILY_PERIOD_DISPLAY_LIMIT),
      fetchPortfolioDailyCapitalRows()
    ]);
    const rows = [...monthRows, ...weekRows, ...dayRows];
    portfolioPeriodSnapshots = {
      loaded: true,
      supported: true,
      sourceUpdatedAt: rows[0]?.source_updated_at || null,
      months: periodMapFromSnapshotRows(monthRows, "month"),
      weeks: periodMapFromSnapshotRows(weekRows, "week"),
      days: periodMapFromSnapshotRows(dayRows, "day")
    };
    setPortfolioDailyCapital(dailyCapitalRows, dailyCapitalRows[0]?.source_updated_at || null);
  } catch (_error) {
    portfolioPeriodSnapshots = {
      loaded: false,
      supported: false,
      sourceUpdatedAt: null,
      months: new Map(),
      weeks: new Map(),
      days: new Map()
    };
    portfolioDailyCapital = {
      loaded: false,
      sourceUpdatedAt: null,
      rows: []
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
      months: recentPeriodMapFromSummaryMap(summary.months, PERIOD_DISPLAY_LIMIT),
      weeks: recentPeriodMapFromSummaryMap(summary.weeks, PERIOD_DISPLAY_LIMIT),
      days: recentPeriodMapFromSummaryMap(summary.days, DAILY_PERIOD_DISPLAY_LIMIT)
    };
    portfolioSnapshotsDirty = false;
    renderTwiiTrendChart();
  } catch (_error) {
    portfolioPeriodSnapshots.supported = false;
  } finally {
    portfolioSnapshotsSaving = false;
  }
}

function markPortfolioSnapshotsDirty() {
  portfolioSnapshotsDirty = true;
  portfolioDailyCapital = {
    loaded: false,
    sourceUpdatedAt: null,
    rows: []
  };
  renderTwiiTrendChart();
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

function periodHistoryTitle(periodType) {
  if (periodType === "day") {
    return "每天歷史";
  }
  return periodType === "month" ? "每月歷史" : "每週歷史";
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

async function loadPortfolioPeriodHistory(periodType) {
  if (!db || !currentUser) {
    return null;
  }
  try {
    const sourceUpdatedAt = portfolioSnapshotSource();
    const rows = await fetchPortfolioSnapshotRows(periodType);
    const currentRows = rows.filter((row) => row.source_updated_at === sourceUpdatedAt);
    const periodRows = [...periodMapFromSnapshotRows(currentRows, periodType).values()].sort((a, b) =>
      b.key.localeCompare(a.key)
    );
    const data = {
      loaded: true,
      title: periodHistoryTitle(periodType),
      html: periodRows.length ? renderPeriodHistoryContent(periodRows, periodType) : "<p>目前沒有可用的歷史明細。</p>",
      count: periodRows.length
    };
    periodHistoryStore.set(periodType, data);
    return data;
  } catch (_error) {
    return {
      loaded: true,
      title: periodHistoryTitle(periodType),
      html: "<p>讀取歷史明細失敗，請稍後再試。</p>",
      count: 0
    };
  }
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

async function showPeriodHistoryModal(key) {
  let data = periodHistoryStore.get(key);
  if (!data || !data.loaded) {
    const title = periodHistoryTitle(key);
    const modal = ensurePeriodDetailModal();
    modal.querySelector("#periodDetailTitle").textContent = title;
    modal.querySelector(".period-modal-body").innerHTML = "<p>讀取歷史明細中...</p>";
    modal.hidden = false;
    data = await loadPortfolioPeriodHistory(key);
  }
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

function fundBoxEventLabel(type) {
  const labels = {
    trailing_breakdown: "跌破"
  };
  return labels[type] || "";
}

function fundBoxVisibleWindow(rows, months, requestedEndIndex) {
  const endIndex = Math.min(rows.length - 1, Math.max(0, Number.isFinite(requestedEndIndex) ? requestedEndIndex : rows.length - 1));
  const endDate = new Date(`${rows[endIndex]?.date || ""}T00:00:00Z`);
  const cutoff = new Date(endDate);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const cutoffValue = cutoff.toISOString().slice(0, 10);
  let startIndex = 0;
  for (let index = endIndex; index >= 0; index -= 1) {
    if (rows[index].date < cutoffValue) {
      startIndex = index + 1;
      break;
    }
  }
  return {
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex + 1)
  };
}

function fundBoxChart(entry, options = {}) {
  const { analysis } = entry;
  const holdingDecision = window.FundBox?.holdingDecision?.(analysis);
  const rows = analysis.rows || [];
  if (!rows.length) {
    return '<div class="fund-box-chart-empty">每日淨值資料不足，暫時無法繪圖。</div>';
  }
  const months = Number(options.months) === 4 ? 4 : 2;
  const windowData = fundBoxVisibleWindow(rows, months, options.endIndex);
  const visibleRows = windowData.rows;
  const atStart = windowData.startIndex === 0;
  const atEnd = windowData.endIndex === rows.length - 1;
  const width = Math.max(290, Math.floor(Number(options.width) || 360));
  const height = width < 440 ? 268 : 300;
  const padding = { top: 28, right: 14, bottom: 38, left: width < 440 ? 56 : 58 };
  const intersectingSegments = (analysis.segments || []).filter(
    (segment) => segment.endIndex >= windowData.startIndex && segment.startIndex <= windowData.endIndex
  );
  const values = visibleRows.map((row) => row.nav);
  intersectingSegments.forEach((segment) => values.push(segment.top, segment.bottom));
  if (atEnd && Number(holdingDecision?.bottom) > 0) {
    values.push(Number(holdingDecision.bottom));
  }
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const domainPadding = Math.max((maximumValue - minimumValue) * 0.08, maximumValue * 0.01);
  const minimum = Math.max(0, minimumValue - domainPadding);
  const maximum = maximumValue + domainPadding;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + ((index - windowData.startIndex) / Math.max(1, visibleRows.length - 1)) * plotWidth;
  const y = (value) => padding.top + (1 - (value - minimum) / Math.max(0.0001, maximum - minimum)) * plotHeight;
  const navPath = visibleRows
    .map((row, index) => `${index ? "L" : "M"}${x(windowData.startIndex + index).toFixed(1)} ${y(row.nav).toFixed(1)}`)
    .join(" ");
  const trailingPoints = visibleRows.map((_row, localIndex) => {
    const rowIndex = windowData.startIndex + localIndex;
    const segment = [...(analysis.segments || [])]
      .reverse()
      .find((item) => item.startIndex <= rowIndex && item.endIndex >= rowIndex);
    return segment
      ? { x: x(rowIndex), top: y(segment.top), bottom: y(segment.bottom) }
      : null;
  }).filter(Boolean);
  const trailingTopPath = trailingPoints
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.top.toFixed(1)}`)
    .join(" ");
  const trailingBottomPath = trailingPoints
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.bottom.toFixed(1)}`)
    .join(" ");
  const trailingBandPath = trailingPoints.length
    ? `${trailingTopPath} ${[...trailingPoints]
        .reverse()
        .map((point) => `L${point.x.toFixed(1)} ${point.bottom.toFixed(1)}`)
        .join(" ")} Z`
    : "";
  const segments = intersectingSegments
    .map((segment) => {
      const visibleStart = Math.max(segment.startIndex, windowData.startIndex);
      const visibleEnd = Math.min(Math.max(segment.startIndex, segment.endIndex), windowData.endIndex);
      const left = x(visibleStart);
      const right = visibleRows.length === 1 ? width - padding.right : x(visibleEnd);
      const top = y(segment.top);
      const bottom = y(segment.bottom);
      const segmentKey = `${segment.startIndex}-${segment.kind}`;
      const selected = options.selectedSegmentKey === segmentKey;
      const className = `fund-box-rect ${segment.kind}${segment.current ? " current" : " historical"}${selected ? " selected" : ""}`;
      const kindLabel = `${segment.current ? "目前" : "先前"}20%移動箱`;
      const detailLabel = `${kindLabel}，箱頂 ${moneyNumber(segment.top)}，箱底 ${moneyNumber(segment.bottom)}，箱寬 ${fundBoxWidthText(segment.top, segment.bottom)}`;
      return `
        <rect class="${className}" data-fund-box-segment="${escapeHtml(segmentKey)}" tabindex="0" role="button" aria-label="${escapeHtml(detailLabel)}" x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(3, right - left).toFixed(1)}" height="${Math.max(2, bottom - top).toFixed(1)}"></rect>
      `;
    })
    .join("");
  const selectedSegment = intersectingSegments.find(
    (segment) => `${segment.startIndex}-${segment.kind}` === options.selectedSegmentKey
  );
  const selectedSegmentPopover = selectedSegment
    ? `
      <div class="fund-box-segment-popover" role="status">
        <button type="button" data-fund-box-segment-close aria-label="關閉箱子資料" title="關閉">×</button>
        <strong>${selectedSegment.current ? "目前" : "先前"}20%移動箱</strong>
        <span>箱頂 ${escapeHtml(moneyNumber(selectedSegment.top))}</span>
        <span>箱底 ${escapeHtml(moneyNumber(selectedSegment.bottom))}</span>
        <span>箱寬 ${escapeHtml(fundBoxWidthText(selectedSegment.top, selectedSegment.bottom))}</span>
      </div>
    `
    : "";
  const visibleEventTypes = new Set(["trailing_breakdown"]);
  const events = (analysis.events || [])
    .filter(
      (event) => visibleEventTypes.has(event.type) && event.index >= windowData.startIndex && event.index <= windowData.endIndex
    )
    .map((event) => {
      const label = fundBoxEventLabel(event.type);
      const eventX = x(event.index);
      const eventY = y(event.nav);
      return `
        <circle class="fund-box-event ${escapeHtml(event.type)}" cx="${eventX.toFixed(1)}" cy="${eventY.toFixed(1)}" r="4"></circle>
        <text class="fund-box-event-label" x="${eventX.toFixed(1)}" y="${Math.max(12, eventY - 8).toFixed(1)}" text-anchor="middle">${escapeHtml(label)}</text>
      `;
    })
    .join("");
  const purchaseMarkers = entry.purchases
    .map((purchase, markerIndex) => {
      const index = rows.findIndex((row) => row.date >= purchase.buy_date);
      if (index < windowData.startIndex || index > windowData.endIndex) {
        return "";
      }
      const markerX = x(index);
      return `
        <line class="fund-box-buy-line" x1="${markerX.toFixed(1)}" y1="${padding.top}" x2="${markerX.toFixed(1)}" y2="${height - padding.bottom}"></line>
        <text class="fund-box-buy-label" x="${markerX.toFixed(1)}" y="${height - padding.bottom + 14 + (markerIndex % 2) * 12}" text-anchor="middle">買</text>
      `;
    })
    .join("");
  const stopBottom = atEnd ? Number(holdingDecision?.bottom) : 0;
  const currentTrailingSegment = (analysis.segments || []).find((segment) => segment.current);
  const stopStartIndex = currentTrailingSegment
    ? Math.max(windowData.startIndex, currentTrailingSegment.startIndex)
    : windowData.startIndex;
  const stopLine = stopBottom > 0
    ? `
      <line class="fund-box-stop-line" x1="${x(stopStartIndex).toFixed(1)}" y1="${y(stopBottom).toFixed(1)}" x2="${width - padding.right}" y2="${y(stopBottom).toFixed(1)}"></line>
      <text class="fund-box-stop-label" x="${width - padding.right}" y="${Math.max(14, y(stopBottom) - 6).toFixed(1)}" text-anchor="end">20%箱底 ${escapeHtml(moneyNumber(stopBottom))}</text>
    `
    : "";
  const dateLabel = (value) => String(value || "").slice(5).replace("-", "/");
  return `
    <div class="fund-box-chart-toolbar">
      <div class="fund-box-range-tabs" aria-label="圖表顯示期間">
        <button type="button" data-fund-box-months="2" class="${months === 2 ? "active" : ""}">2月</button>
        <button type="button" data-fund-box-months="4" class="${months === 4 ? "active" : ""}">4月</button>
      </div>
      <div class="fund-box-chart-nav">
        <button type="button" data-fund-box-shift="older" aria-label="查看更早區間" title="查看更早區間" ${atStart ? "disabled" : ""}>‹</button>
        <button type="button" data-fund-box-shift="newer" aria-label="查看較新區間" title="查看較新區間" ${atEnd ? "disabled" : ""}>›</button>
      </div>
    </div>
    <div class="fund-box-chart-wrap" data-visible-count="${visibleRows.length}">
      <svg class="fund-box-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(entry.name)} ${escapeHtml(visibleRows[0].date)} 至 ${escapeHtml(visibleRows.at(-1).date)}淨值與箱型">
        <line class="fund-box-grid" x1="${padding.left}" y1="${y(maximumValue).toFixed(1)}" x2="${width - padding.right}" y2="${y(maximumValue).toFixed(1)}"></line>
        <line class="fund-box-grid" x1="${padding.left}" y1="${y(minimumValue).toFixed(1)}" x2="${width - padding.right}" y2="${y(minimumValue).toFixed(1)}"></line>
        ${trailingBandPath ? `<path class="fund-box-trailing-band" d="${trailingBandPath}"></path>` : ""}
        ${trailingTopPath ? `<path class="fund-box-trailing-bound" d="${trailingTopPath}"></path>` : ""}
        ${trailingBottomPath ? `<path class="fund-box-trailing-bound bottom" d="${trailingBottomPath}"></path>` : ""}
        ${segments}
        ${stopLine}
        ${purchaseMarkers}
        <path class="fund-box-nav-line" d="${navPath}"></path>
        ${events}
        <text class="fund-box-axis-label" x="${padding.left}" y="${height - 8}" text-anchor="start">${escapeHtml(dateLabel(visibleRows[0].date))}</text>
        <text class="fund-box-axis-label" x="${width - padding.right}" y="${height - 8}" text-anchor="end">${escapeHtml(dateLabel(visibleRows.at(-1).date))}</text>
        <text class="fund-box-axis-label" x="${padding.left - 6}" y="${y(maximumValue).toFixed(1)}" text-anchor="end">${escapeHtml(moneyNumber(maximumValue))}</text>
        <text class="fund-box-axis-label" x="${padding.left - 6}" y="${y(minimumValue).toFixed(1)}" text-anchor="end">${escapeHtml(moneyNumber(minimumValue))}</text>
      </svg>
      ${selectedSegmentPopover}
    </div>
    <div class="fund-box-legend" aria-label="箱型圖例">
      <span><i class="nav"></i>淨值</span>
      <span><i class="trailing"></i>20%移動箱</span>
      ${stopBottom > 0 ? '<span><i class="stop"></i>目前箱底</span>' : ""}
    </div>
  `;
}

function renderFundBoxChartSection(section, entry, state) {
  const width = Math.max(290, Math.floor(section.clientWidth || 360));
  section.innerHTML = fundBoxChart(entry, { ...state, width });
}

function setupFundBoxChart(section, entry) {
  const rows = entry.analysis.rows || [];
  const state = { months: 2, endIndex: Math.max(0, rows.length - 1), selectedSegmentKey: null };
  let pointerDrag = null;
  let renderFrame = 0;
  let suppressSegmentClickUntil = 0;
  const render = () => {
    renderFundBoxChartSection(section, entry, state);
    if (pointerDrag) {
      section.querySelector(".fund-box-chart-wrap")?.classList.add("dragging");
    }
  };
  const scheduleRender = () => {
    if (renderFrame) {
      return;
    }
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  };
  const shiftWindow = (direction, amount = null) => {
    const windowData = fundBoxVisibleWindow(rows, state.months, state.endIndex);
    const pageSize = amount || Math.max(5, windowData.rows.length - 5);
    state.endIndex = Math.min(rows.length - 1, Math.max(0, state.endIndex + direction * pageSize));
    render();
  };

  section.addEventListener("click", (event) => {
    const closeSegmentButton = event.target.closest("[data-fund-box-segment-close]");
    if (closeSegmentButton) {
      state.selectedSegmentKey = null;
      render();
      return;
    }
    const rangeButton = event.target.closest("[data-fund-box-months]");
    if (rangeButton) {
      state.months = Number(rangeButton.dataset.fundBoxMonths) === 4 ? 4 : 2;
      render();
      return;
    }
    const shiftButton = event.target.closest("[data-fund-box-shift]");
    if (shiftButton && !shiftButton.disabled) {
      shiftWindow(shiftButton.dataset.fundBoxShift === "older" ? -1 : 1);
      return;
    }
    const segment = event.target.closest("[data-fund-box-segment]");
    if (segment && Date.now() >= suppressSegmentClickUntil) {
      state.selectedSegmentKey = segment.dataset.fundBoxSegment;
      render();
    }
  });

  section.addEventListener("keydown", (event) => {
    const segment = event.target.closest("[data-fund-box-segment]");
    if (segment && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      state.selectedSegmentKey = segment.dataset.fundBoxSegment;
      render();
    }
  });

  section.addEventListener("pointerdown", (event) => {
    const wrap = event.target.closest(".fund-box-chart-wrap");
    if (!wrap || event.target.closest(".fund-box-segment-popover") || event.button > 0) {
      return;
    }
    pointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      width: Math.max(1, wrap.clientWidth),
      visibleCount: Math.max(2, Number(wrap.dataset.visibleCount) || 20),
      endIndex: state.endIndex,
      moved: false
    };
    section.setPointerCapture(event.pointerId);
    wrap.classList.add("dragging");
  });

  section.addEventListener("pointermove", (event) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
      return;
    }
    const dayWidth = pointerDrag.width / Math.max(1, pointerDrag.visibleCount - 1);
    if (Math.abs(event.clientX - pointerDrag.startX) > 6) {
      pointerDrag.moved = true;
    }
    const dayDelta = Math.round((event.clientX - pointerDrag.startX) / dayWidth);
    const nextEndIndex = Math.min(rows.length - 1, Math.max(0, pointerDrag.endIndex - dayDelta));
    if (nextEndIndex !== state.endIndex) {
      event.preventDefault();
      state.endIndex = nextEndIndex;
      scheduleRender();
    }
  });

  const endPointer = (event) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
      return;
    }
    if (section.hasPointerCapture(event.pointerId)) {
      section.releasePointerCapture(event.pointerId);
    }
    if (pointerDrag.moved) {
      suppressSegmentClickUntil = Date.now() + 400;
    }
    const needsFinalRender = Boolean(renderFrame);
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }
    pointerDrag = null;
    if (needsFinalRender) {
      render();
    } else {
      section.querySelector(".fund-box-chart-wrap")?.classList.remove("dragging");
    }
  };
  section.addEventListener("pointerup", endPointer);
  section.addEventListener("pointercancel", endPointer);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => scheduleRender());
    resizeObserver.observe(section);
    section._fundBoxResizeObserver = resizeObserver;
  }
  render();
}

function fundBoxCurrentCalculation(entry) {
  const { analysis } = entry;
  const lines = [];
  if (analysis.top && analysis.bottom) {
    lines.push(`追蹤起點：${analysis.trackingStartDate || entry.trackingStartDate || "-"}；這筆買入紀錄使用自己的箱子。`);
    lines.push(`箱頂採持有期間最高淨值 ${moneyNumber(analysis.top)}（${analysis.peakDate || "-"}）。`);
    lines.push(`20%箱底：${moneyNumber(analysis.top)} × 80% = ${moneyNumber(analysis.bottom)}。`);
    if (analysis.liveStatus === "trailing_breakdown") {
      lines.push(`最新淨值相對箱底：${moneyNumber(analysis.latest.nav)} ÷ ${moneyNumber(analysis.bottom)} - 1 = ${fundBoxPercent(analysis.difference)}；網站只提醒，由你判斷是否贖回。`);
    } else {
      lines.push(`最新淨值仍高於箱底 ${fundBoxPercent(analysis.difference)}；箱子不因下跌而往下移。`);
    }
  }
  return lines.length
    ? `<ol class="fund-box-calculation">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`
    : '<p class="fund-box-muted">目前沒有可用的持有淨值，暫時無法建立20%移動箱。</p>';
}

function renderFundBoxDetail(entry) {
  const { analysis } = entry;
  const entryDecision = window.FundBox?.buyDecision?.(analysis) || {
    label: "低點無法判斷",
    detail: "箱型判斷尚未載入。",
    tone: "muted"
  };
  const holdingDecision = window.FundBox?.holdingDecision?.(analysis) || {
    label: "持有無法判斷",
    detail: "箱型判斷尚未載入。",
    tone: "muted"
  };
  const latestDate = analysis.latest?.date || "-";
  const latestNav = analysis.latest ? moneyNumber(analysis.latest.nav) : "-";
  const statusText = fundBoxStatusText(analysis);
  const dividendStatus = entry.distributing ? (entry.adjusted ? "已使用還原淨值" : "配息未還原") : "不配息／累積型";
  const persistenceStatus = currentUser && fundTrailingBoxesSupported
    ? "最高淨值會保存至你的帳號"
    : "最高淨值目前未寫入帳號；請勿把本頁當成持久紀錄";
  const blockedNotice =
    analysis.status === "distribution_unadjusted"
      ? '<p class="fund-box-notice danger">這是配息型基金，目前歷史資料沒有可靠的配息還原值。圖表只顯示原始淨值，不提供箱型判斷，以免把除息誤判成跌破。</p>'
      : analysis.status === "stale"
        ? `<p class="fund-box-notice danger">最新歷史淨值停在 ${escapeHtml(latestDate)}，已超過 7 天，因此暫停產生新訊號。</p>`
        : analysis.status === "insufficient"
          ? `<p class="fund-box-notice">目前沒有足夠的有效淨值，暫時無法建立20%移動箱。</p>`
          : "";
  const bootstrapNotice = entry.bootstrapLimited
    ? `<p class="fund-box-notice">完整每日淨值從 ${escapeHtml(entry.exactHistoryStartDate)} 起可取得；更早區間以買入淨值、週底與月底淨值補足，可能漏掉週中高點。從現在起抓到的新高會保存在你的帳號。</p>`
    : "";
  return `
    <div class="fund-box-current">
      <div class="fund-box-action ${escapeHtml(entryDecision.tone)}">
        <span>買點判斷</span>
        <strong>${escapeHtml(entryDecision.label)}</strong>
        <small>${escapeHtml(entryDecision.detail)}</small>
      </div>
      <div class="fund-box-action ${escapeHtml(holdingDecision.tone)}">
        <span>賣點判斷</span>
        <strong>${escapeHtml(holdingDecision.label)}</strong>
        <small>${escapeHtml(holdingDecision.detail)}</small>
      </div>
      <small class="fund-box-technical-status">技術狀態：${escapeHtml(statusText)}</small>
      <small>最新淨值 ${escapeHtml(latestNav)}｜${escapeHtml(latestDate)}</small>
    </div>
    ${blockedNotice}
    ${bootstrapNotice}
    <section class="fund-box-chart-section" aria-label="箱型圖"></section>
    <section class="fund-box-method">
      <h4>這檔基金怎麼算</h4>
      ${fundBoxCurrentCalculation(entry)}
    </section>
    <section class="fund-box-method">
      <h4>完整邏輯與算法</h4>
      <ol>
        <li>進場仍採「幾個月低點」參考：使用現有每日淨值尋找區間最低點。</li>
        <li>目前淨值回到期間低點上方 5% 內，而且低點後連續 3 個交易日不再破底，才顯示「低點區可分批」。</li>
        <li>每筆買入紀錄各自使用一套20%移動箱；即使基金相同，也從各自的買入日期與買入淨值開始計算。</li>
        <li>箱頂是這次持有週期開始後曾出現的最高淨值；淨值創新高時，箱頂立即上移，不等待三日確認。</li>
        <li>箱底永遠等於箱頂 × 80%，因此箱寬固定20%；箱頂與箱底只能上升，回檔時不會下降。</li>
        <li>基金上漲時不顯示停利，也不自動賣出再買回，讓資金持續留在原基金。</li>
        <li>最新淨值第一次等於或低於箱底就顯示「跌破箱底」；這只是醒目提醒，不會自動贖回或新增賣出紀錄。</li>
        <li>最高淨值與日期保存在你的帳號資料庫；重新整理或圖表只載入近期資料時，既有箱頂不會因此消失。</li>
        <li>某筆紀錄賣出後只清除該筆箱子，不影響同基金的其他持有紀錄；日後新增買入會建立新箱子。</li>
        <li>資料超過7天未更新時暫停新的跌破判斷，但保留最後箱頂與箱底供查看。</li>
        <li>圖表可選2個月或4個月並左右移動；這些操作只改變畫面，不會重設最高淨值。</li>
        <li>配息型基金必須使用可靠的還原淨值，否則配息造成的淨值下降可能被誤判，因此暫停箱型訊號。</li>
        <li>所有箱型與跌破狀態只供你判斷，不構成買賣建議，也不會代替你操作交易。</li>
      </ol>
    </section>
    <section class="fund-box-data">
      <h4>資料說明</h4>
      <p>算法：基金箱型 v${escapeHtml(analysis.version || window.FundBox?.VERSION || "-")}</p>
      <p>資料：${escapeHtml(monthlyNavMeta.source || "MoneyDJ 每日淨值")}</p>
      <p>區間：${escapeHtml(analysis.rows[0]?.date || "-")} 至 ${escapeHtml(latestDate)}｜${analysis.rows.length} 筆</p>
      <p>每日淨值精確涵蓋：${escapeHtml(entry.exactHistoryStartDate || "尚未取得")}起；更早資料僅作補足</p>
      <p>追蹤起點：${escapeHtml(analysis.trackingStartDate || entry.trackingStartDate || "-")}｜${escapeHtml(persistenceStatus)}</p>
      <p>配息處理：${escapeHtml(dividendStatus)}</p>
    </section>
  `;
}

function ensureFundBoxModal() {
  let modal = document.querySelector("#fundBoxModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "fundBoxModal";
  modal.className = "period-modal fund-box-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="period-modal-panel fund-box-modal-panel" role="dialog" aria-modal="true" aria-labelledby="fundBoxTitle">
      <button class="period-modal-close" type="button" aria-label="關閉">×</button>
      <h3 id="fundBoxTitle"></h3>
      <div class="period-modal-body fund-box-modal-body"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".period-modal-close")) {
      hideFundBoxModal();
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function showFundBoxModal(key) {
  const entry = fundBoxStore.get(key);
  if (!entry) {
    return;
  }
  const modal = ensureFundBoxModal();
  modal.querySelector("#fundBoxTitle").textContent = displayFundName(entry.name) || entry.name;
  modal.querySelector(".fund-box-chart-section")?._fundBoxResizeObserver?.disconnect();
  modal.querySelector(".fund-box-modal-body").innerHTML = renderFundBoxDetail(entry);
  modal.hidden = false;
  const chartSection = modal.querySelector(".fund-box-chart-section");
  if (chartSection) {
    setupFundBoxChart(chartSection, entry);
  }
  modal.querySelector(".period-modal-close").focus();
}

function hideFundBoxModal() {
  const modal = document.querySelector("#fundBoxModal");
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

function renderPortfolioPeriodSections(summary, canUseSnapshots) {
  const monthlyAllRows = [...summary.months.values()].sort((a, b) => b.key.localeCompare(a.key));
  const weeklyAllRows = [...summary.weeks.values()].sort((a, b) => b.key.localeCompare(a.key));
  const dailyAllRows = [...summary.days.values()].sort((a, b) => b.key.localeCompare(a.key));
  const monthlyRows = monthlyAllRows.slice(0, PERIOD_DISPLAY_LIMIT);
  const weeklyRows = weeklyAllRows.slice(0, PERIOD_DISPLAY_LIMIT);
  const dailyRows = dailyAllRows.slice(0, DAILY_PERIOD_DISPLAY_LIMIT);
  const monthlyHasHistory = canUseSnapshots
    ? monthlyRows.length >= PERIOD_DISPLAY_LIMIT
    : monthlyAllRows.length > PERIOD_DISPLAY_LIMIT;
  const weeklyHasHistory = canUseSnapshots
    ? weeklyRows.length >= PERIOD_DISPLAY_LIMIT
    : weeklyAllRows.length > PERIOD_DISPLAY_LIMIT;
  const dailyHasHistory = canUseSnapshots
    ? dailyRows.length >= DAILY_PERIOD_DISPLAY_LIMIT
    : dailyAllRows.length > DAILY_PERIOD_DISPLAY_LIMIT;
  periodDetailStore = new Map();
  periodHistoryStore = new Map();
  if (monthlyHasHistory) {
    periodHistoryStore.set("month", {
      loaded: !canUseSnapshots,
      title: periodHistoryTitle("month"),
      html: canUseSnapshots ? "" : renderPeriodHistoryContent(monthlyAllRows, "month")
    });
  }
  if (weeklyHasHistory) {
    periodHistoryStore.set("week", {
      loaded: !canUseSnapshots,
      title: periodHistoryTitle("week"),
      html: canUseSnapshots ? "" : renderPeriodHistoryContent(weeklyAllRows, "week")
    });
  }
  if (dailyHasHistory) {
    periodHistoryStore.set("day", {
      loaded: !canUseSnapshots,
      title: periodHistoryTitle("day"),
      html: canUseSnapshots ? "" : renderPeriodHistoryContent(dailyAllRows, "day")
    });
  }
  return `
    <div class="monthly-breakdown">
      <h4>每月賺賠</h4>
      ${
        monthlyRows.length
          ? monthlyRows.map((item) => renderPeriodRow(item, "month")).join("")
          : "<p>尚無資料</p>"
      }
      ${monthlyHasHistory ? `<button class="period-history-button" type="button" data-period-history="month">看全部每月歷史</button>` : ""}
    </div>
    <div class="weekly-breakdown">
      <h4>每週賺賠</h4>
      ${
        weeklyRows.length
          ? weeklyRows.map((item) => renderPeriodRow(item, "week")).join("")
          : "<p>尚無資料</p>"
      }
      ${weeklyHasHistory ? `<button class="period-history-button" type="button" data-period-history="week">看全部每週歷史</button>` : ""}
    </div>
    <div class="daily-breakdown">
      <h4>每天賺賠</h4>
      ${
        dailyRows.length
          ? dailyRows.map((item) => renderPeriodRow(item, "day")).join("")
          : "<p>尚無資料</p>"
      }
      ${dailyHasHistory ? `<button class="period-history-button" type="button" data-period-history="day">看全部每天歷史</button>` : ""}
    </div>
  `;
}

function bindPortfolioPeriodButtons() {
  document.querySelectorAll("[data-period-detail]").forEach((button) => {
    button.addEventListener("click", () => showPeriodDetailModal(button.dataset.periodDetail));
  });
  document.querySelectorAll("[data-period-history]").forEach((button) => {
    button.addEventListener("click", () => {
      void showPeriodHistoryModal(button.dataset.periodHistory);
    });
  });
}

function renderPortfolioPeriodPlaceholder() {
  return `
    <div class="monthly-breakdown period-loading">
      <h4>每月賺賠</h4>
      <p>讀取中...</p>
    </div>
    <div class="weekly-breakdown period-loading">
      <h4>每週賺賠</h4>
      <p>讀取中...</p>
    </div>
    <div class="daily-breakdown period-loading">
      <h4>每天賺賠</h4>
      <p>讀取中...</p>
    </div>
  `;
}

function renderPortfolioStats(options = {}) {
  if (!els.portfolioStats) {
    return;
  }
  if (!currentUser || !purchases.length) {
    els.portfolioStats.innerHTML = "";
    return;
  }
  const includePeriods = options.includePeriods !== false;
  const currentSnapshotSource = portfolioSnapshotSource();
  const canUseSnapshots =
    portfolioPeriodSnapshots.loaded &&
    portfolioPeriodSnapshots.sourceUpdatedAt === currentSnapshotSource &&
    !portfolioSnapshotsDirty &&
    (portfolioPeriodSnapshots.months.size > 0 || portfolioPeriodSnapshots.weeks.size > 0 || portfolioPeriodSnapshots.days.size > 0);
  const summary = portfolioSummary({ includePeriods: includePeriods && !canUseSnapshots });
  if (includePeriods) {
    if (canUseSnapshots) {
      summary.months = new Map(portfolioPeriodSnapshots.months);
      summary.weeks = new Map(portfolioPeriodSnapshots.weeks);
      summary.days = new Map(portfolioPeriodSnapshots.days);
      if (!portfolioDailyCapital.loaded || portfolioDailyCapital.sourceUpdatedAt !== currentSnapshotSource) {
        setPortfolioDailyCapital([...summary.days.values()], currentSnapshotSource);
      }
    } else {
      setPortfolioDailyCapital([...summary.days.values()], currentSnapshotSource);
      void savePortfolioPeriodSnapshots(summary);
    }
    renderTwiiTrendChart();
  }
  const profit = summary.realizedProfit + summary.unrealizedProfit;
  const profitPercent =
    summary.valuedCostBasis > 0 && summary.valuedCount > 0 ? (profit / summary.valuedCostBasis) * 100 : null;
  const profitClass = profit >= 0 ? "up" : "down";
  const topHoldings = [...summary.holdings.values()]
    .sort((a, b) => b.invested - a.invested)
    .slice(0, 3);
  const periodHtml = includePeriods ? renderPortfolioPeriodSections(summary, canUseSnapshots) : renderPortfolioPeriodPlaceholder();
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
    ${periodHtml}
  `;
  if (includePeriods) {
    bindPortfolioPeriodButtons();
  }
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

function portfolioPeriodsReady() {
  return Boolean(monthlyNavMeta.updatedAt) && !portfolioPeriodsLoading;
}

async function loadPortfolioPeriodsInBackground(options = {}) {
  if (!db || !currentUser) {
    resetPortfolioSnapshots();
    return;
  }
  portfolioPeriodsLoading = true;
  try {
    await loadPortfolioPeriodSnapshots();
  } finally {
    portfolioPeriodsLoading = false;
  }
  if (options.render !== false) {
    renderPurchases({ includePeriods: portfolioPeriodsReady() });
  }
}

function renderPurchases(options = {}) {
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
  const includePeriods = options.includePeriods ?? portfolioPeriodsReady();
  renderPortfolioStats({ includePeriods });
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
          ${valuation.isSold ? "" : renderFundBoxTrigger(item)}
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
  buildFundBoxStore(activePurchases);
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
  document.querySelectorAll("[data-fund-box]").forEach((button) => {
    button.addEventListener("click", () => showFundBoxModal(button.dataset.fundBox));
  });
}

async function loadPurchases(options = {}) {
  if (!db || !currentUser) {
    purchases = [];
    fundTrailingBoxes = new Map();
    resetPortfolioSnapshots();
    renderTwiiTrendChart();
    if (options.render !== false) {
      renderPurchases();
    }
    return;
  }
  const trailingBoxesPromise = loadFundTrailingBoxes();
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
    await trailingBoxesPromise;
    purchases = [];
    renderTwiiTrendChart();
    if (options.render !== false) {
      renderPurchases();
    }
    setMessage(els.purchaseMessage, `讀取失敗：${error.message}`, true);
    return;
  }
  await trailingBoxesPromise;
  purchases = data || [];
  cleanupInactiveFundTrailingBoxes(purchases.filter((item) => !item.sell_date));
  renderTwiiTrendChart();
  portfolioPeriodsLoading = true;
  if (options.requestNavHistory !== false) {
    requestOwnedFundNavHistory();
  }
  if (options.render !== false) {
    renderPurchases({ includePeriods: false });
  }
  void loadPortfolioPeriodsInBackground({ render: options.render });
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
  sourceMeta = parsed.meta;
  funds = parsed.funds;
  applyLocalNavOverridesToFunds();
  fundDataLoaded = true;
}

function applyLatestNavItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return 0;
  }
  persistLatestNavItems(items);
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
    if (fundDataLoaded) {
      applyLocalNavOverridesToFunds();
    }
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
  fundTrailingBoxesSupported = true;
  renderAuthState();
  await loadPurchases();
  db.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    fundTrailingBoxesSupported = true;
    fundTrailingBoxes = new Map();
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

function performanceMetric(label, value, options = {}) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const colorize = options.colorize !== false;
  const signed = options.signed !== false;
  const valueClass = !hasValue || !colorize ? "" : value >= 0 ? "up" : "down";
  const valueText = !hasValue
    ? "—"
    : signed
      ? formatCompactPercent(value)
      : `${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
  return `<span><small>${escapeHtml(label)}</small><strong class="${valueClass}">${valueText}</strong></span>`;
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

function relativeChangeSeries(points, getValue) {
  const first = Number(getValue(points[0]));
  if (!Number.isFinite(first) || first === 0) {
    return [];
  }
  return points.map((point) => ((Number(getValue(point)) / first) - 1) * 100);
}

function chartY(value, height, padding, minimum, maximum) {
  const span = maximum - minimum || 1;
  return padding + (1 - (value - minimum) / span) * (height - padding * 2);
}

function chartPath(values, width, height, padding, minimum, maximum) {
  if (values.length < 2) {
    return "";
  }
  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
      const y = chartY(value, height, padding, minimum, maximum);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function marginWindowChange(items, key) {
  if (items.length < 2) {
    return null;
  }
  const first = Number(items[0][key]);
  const last = Number(items.at(-1)[key]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null;
  }
  return ((last / first) - 1) * 100;
}

function marginValueText(value) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }
  return `${(Number(value) / 100).toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 億`;
}

function marginToTwiiRatio(item) {
  const marginBalanceMillion = Number(item?.marginBalanceMillion);
  const twiiClose = Number(item?.twiiClose);
  if (!Number.isFinite(marginBalanceMillion) || !Number.isFinite(twiiClose) || twiiClose <= 0) {
    return null;
  }
  return (marginBalanceMillion / 100) / twiiClose;
}

function marginRatioText(item) {
  const ratio = marginToTwiiRatio(item);
  if (!Number.isFinite(ratio)) {
    return "-";
  }
  return `${ratio.toLocaleString("zh-TW", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} 億/點`;
}

function renderMarginChart() {
  if (!els.marginChart) {
    return;
  }
  const rows = (marginMeta.items || [])
    .filter((item) => Number(item.marginBalanceMillion) > 0 && Number(item.twiiClose) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const activeWindow = Number(marginMeta.activeWindow) || 66;
  const visibleRows = rows.slice(-activeWindow);
  if (visibleRows.length < 2) {
    els.marginChart.innerHTML = '<div class="market-empty">融資餘額資料不足</div>';
    if (els.marginStatus) {
      els.marginStatus.textContent = marginMeta.source;
    }
    return;
  }
  document.querySelectorAll("[data-margin-window]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.marginWindow) === activeWindow);
  });
  const width = 680;
  const height = 220;
  const padding = 22;
  const twiiSeries = relativeChangeSeries(visibleRows, (item) => item.twiiClose);
  const marginSeries = relativeChangeSeries(visibleRows, (item) => item.marginBalanceMillion);
  const ratioSeries = relativeChangeSeries(visibleRows, marginToTwiiRatio);
  const combinedSeries = [...twiiSeries, ...marginSeries, ...ratioSeries, 0];
  const seriesMinimum = Math.min(...combinedSeries);
  const seriesMaximum = Math.max(...combinedSeries);
  const seriesSpan = seriesMaximum - seriesMinimum || 1;
  const domainPadding = Math.max(seriesSpan * 0.08, 1);
  const chartMinimum = seriesMinimum - domainPadding;
  const chartMaximum = seriesMaximum + domainPadding;
  const zeroY = chartY(0, height, padding, chartMinimum, chartMaximum);
  const twiiPath = chartPath(twiiSeries, width, height, padding, chartMinimum, chartMaximum);
  const marginPath = chartPath(marginSeries, width, height, padding, chartMinimum, chartMaximum);
  const ratioPath = chartPath(ratioSeries, width, height, padding, chartMinimum, chartMaximum);
  const latest = visibleRows.at(-1);
  const marginChange = marginWindowChange(visibleRows, "marginBalanceMillion");
  const twiiChange = marginWindowChange(visibleRows, "twiiClose");
  const ratioChange = Number.isFinite(ratioSeries.at(-1)) ? ratioSeries.at(-1) : null;
  const marginClass = (marginChange || 0) >= 0 ? "up" : "down";
  const twiiClass = (twiiChange || 0) >= 0 ? "up" : "down";
  const ratioClass = (ratioChange || 0) >= 0 ? "up" : "down";
  els.marginChart.innerHTML = `
    <svg class="margin-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="台股指數、融資餘額與融資相對台股趨勢">
      <path class="grid-line" d="M${padding} ${zeroY.toFixed(1)} H${width - padding}"></path>
      <path class="margin-line twii-line" d="${twiiPath}"></path>
      <path class="margin-line balance-line" d="${marginPath}"></path>
      <path class="margin-line ratio-line" d="${ratioPath}"></path>
    </svg>
    <div class="margin-legend">
      <span><i class="twii-dot"></i>台股 ${formatMarketPrice(latest.twiiClose)} <strong class="${twiiClass}">${twiiChange === null ? "" : formatPercent(twiiChange)}</strong></span>
      <span><i class="balance-dot"></i>融資 ${marginValueText(latest.marginBalanceMillion)} <strong class="${marginClass}">${marginChange === null ? "" : formatPercent(marginChange)}</strong></span>
      <span><i class="ratio-dot"></i>融資／台股 ${marginRatioText(latest)} <strong class="${ratioClass}">${ratioChange === null ? "" : formatPercent(ratioChange)}</strong></span>
    </div>
  `;
  if (els.marginStatus) {
    const first = visibleRows[0];
    const marginWindowLabels = {
      22: "1個月",
      66: "3個月",
      126: "半年"
    };
    const windowLabel = marginWindowLabels[activeWindow] || `${activeWindow}日`;
    els.marginStatus.textContent = `資料 ${first.date} 到 ${latest.date}，${windowLabel}視窗；融資／台股＝融資餘額÷台股指數，三者皆以起點 0% 比較`;
  }
}

function twiiTrendPath(rows, key, width, height, padding, minimum, maximum) {
  let drawing = false;
  return rows
    .map((row, index) => {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) {
        drawing = false;
        return "";
      }
      const x = padding.left + (index / Math.max(1, rows.length - 1)) * (width - padding.left - padding.right);
      const plotHeight = height - padding.top - padding.bottom;
      const y = padding.top + (1 - (value - minimum) / (maximum - minimum || 1)) * plotHeight;
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function dailyCapitalValuesForRows(rows) {
  const sourceMatches = portfolioDailyCapital.sourceUpdatedAt === portfolioSnapshotSource();
  if (!currentUser || !portfolioDailyCapital.loaded || !sourceMatches) {
    return [];
  }
  const capitalRows = portfolioDailyCapital.rows || [];
  let capitalIndex = -1;
  return rows.map((row) => {
    while (capitalIndex + 1 < capitalRows.length && capitalRows[capitalIndex + 1].date <= row.date) {
      capitalIndex += 1;
    }
    return capitalIndex >= 0 ? Number(capitalRows[capitalIndex].invested) || 0 : null;
  });
}

function twiiCapitalPath(rows, values, width, height, padding, maximum) {
  if (rows.length < 2 || values.length !== rows.length || maximum <= 0) {
    return "";
  }
  let drawing = false;
  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) {
        drawing = false;
        return "";
      }
      const x = padding.left + (index / Math.max(1, rows.length - 1)) * (width - padding.left - padding.right);
      const plotHeight = height - padding.top - padding.bottom;
      const y = padding.top + (1 - value / maximum) * plotHeight;
      if (!drawing) {
        drawing = true;
        return `M${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return `H${x.toFixed(1)} V${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function shiftIsoDateMonths(dateValue, monthsBack) {
  const [year, month, day] = String(dateValue || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) {
    return "";
  }
  const targetMonthIndex = year * 12 + month - 1 - monthsBack;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function twiiMonthLabels(rows, width, height, padding) {
  const labels = [];
  rows.forEach((row, index) => {
    const [year, month] = String(row.date || "").split("-");
    const previousParts = index > 0 ? String(rows[index - 1].date || "").split("-") : [];
    if (index > 0 && year === previousParts[0] && month === previousParts[1]) {
      return;
    }
    const x = padding.left + (index / Math.max(1, rows.length - 1)) * (width - padding.left - padding.right);
    const label = index > 0 && year !== previousParts[0] ? `${year}年` : `${Number(month)}月`;
    labels.push(`
      <path class="twii-month-line" d="M${x.toFixed(1)} ${padding.top} V${height - padding.bottom}"></path>
      <text class="twii-axis-label" x="${x.toFixed(1)}" y="${height - 11}" text-anchor="${index === 0 ? "start" : "middle"}">${label}</text>
    `);
  });
  return labels.join("");
}

function renderTwiiTrendChart() {
  if (!els.twiiTrendChart) {
    return;
  }
  const rows = (twiiTrendMeta.items || [])
    .filter((item) => item.date && Number(item.close) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (rows.length < 2) {
    els.twiiTrendChart.innerHTML = '<div class="market-empty">台股均線資料不足</div>';
    if (els.twiiTrendStatus) {
      els.twiiTrendStatus.textContent = twiiTrendMeta.source;
    }
    return;
  }

  document.querySelectorAll("[data-twii-range]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.twiiRange) === twiiTrendMeta.activeMonths);
  });
  if (!Number.isInteger(twiiTrendMeta.endIndex)) {
    twiiTrendMeta.endIndex = rows.length;
  }
  twiiTrendMeta.endIndex = Math.max(2, Math.min(rows.length, twiiTrendMeta.endIndex));
  const endRow = rows[twiiTrendMeta.endIndex - 1];
  const startDate = shiftIsoDateMonths(endRow.date, twiiTrendMeta.activeMonths);
  const startIndex = Math.max(0, rows.findIndex((row, index) => index < twiiTrendMeta.endIndex && row.date >= startDate));
  const visibleRows = rows.slice(startIndex, twiiTrendMeta.endIndex);
  twiiTrendMeta.visibleCount = visibleRows.length;
  const values = visibleRows.flatMap((row) => [row.close, row.ma20, row.ma60].map(Number).filter(Number.isFinite));
  const seriesMinimum = Math.min(...values);
  const seriesMaximum = Math.max(...values);
  const domainPadding = Math.max((seriesMaximum - seriesMinimum) * 0.08, 100);
  const chartMinimum = seriesMinimum - domainPadding;
  const chartMaximum = seriesMaximum + domainPadding;
  const width = 680;
  const height = 250;
  const padding = { top: 18, right: 18, bottom: 42, left: 18 };
  const closePath = twiiTrendPath(visibleRows, "close", width, height, padding, chartMinimum, chartMaximum);
  const ma20Path = twiiTrendPath(visibleRows, "ma20", width, height, padding, chartMinimum, chartMaximum);
  const ma60Path = twiiTrendPath(visibleRows, "ma60", width, height, padding, chartMinimum, chartMaximum);
  const capitalValues = showTwiiCapital ? dailyCapitalValuesForRows(visibleRows) : [];
  const numericCapitalValues = capitalValues.filter(Number.isFinite);
  const capitalMaximum = numericCapitalValues.length ? Math.max(...numericCapitalValues) : 0;
  const capitalScaleMaximum = capitalMaximum > 0 ? capitalMaximum * 1.08 : 0;
  const capitalPath = twiiCapitalPath(visibleRows, capitalValues, width, height, padding, capitalScaleMaximum);
  const latest = visibleRows.at(-1);
  const latestCapital = capitalValues.length && Number.isFinite(capitalValues.at(-1)) ? capitalValues.at(-1) : null;
  const capitalVisible = showTwiiCapital && latestCapital !== null;

  els.twiiTrendChart.innerHTML = `
    <svg class="twii-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${visibleRows[0].date} 到 ${latest.date} 的台股指數、20日月線、60日季線${capitalVisible ? "與每日在場本金" : ""}">
      ${twiiMonthLabels(visibleRows, width, height, padding)}
      <path class="twii-trend-line twii-ma60-line" d="${ma60Path}"></path>
      <path class="twii-trend-line twii-ma20-line" d="${ma20Path}"></path>
      <path class="twii-trend-line twii-close-line" d="${closePath}"></path>
      ${capitalPath ? `<path class="twii-trend-line twii-capital-line" d="${capitalPath}"></path>` : ""}
      ${capitalPath ? `<text class="twii-capital-scale" x="${width - padding.right}" y="${padding.top + 15}" text-anchor="end">本${compactTwdWan(capitalMaximum)}</text>` : ""}
    </svg>
    <div class="twii-trend-legend">
      <span><i class="twii-close-dot"></i>指數 ${formatMarketPrice(latest.close)}</span>
      <span><i class="twii-ma20-dot"></i>月線 ${formatMarketPrice(latest.ma20)}</span>
      <span><i class="twii-ma60-dot"></i>季線 ${formatMarketPrice(latest.ma60)}</span>
      ${capitalVisible ? `<span><i class="twii-capital-dot"></i>本金 ${compactTwdWan(latestCapital)}</span>` : ""}
    </div>
  `;
  if (els.twiiTrendStatus) {
    const capitalNote = capitalVisible ? "；本金使用獨立比例" : "";
    els.twiiTrendStatus.textContent = `${visibleRows[0].date.replaceAll("-", "/")} 到 ${latest.date.replaceAll("-", "/")}，左右滑動查看歷史${capitalNote}`;
  }
}

function moveTwiiTrendWindow(nextEnd) {
  const maximum = (twiiTrendMeta.items || []).length;
  const minimum = Math.min(maximum, Math.max(2, Number(twiiTrendMeta.visibleCount) || 2));
  const clamped = Math.max(minimum, Math.min(maximum, Math.round(nextEnd)));
  if (clamped === twiiTrendMeta.endIndex) {
    return;
  }
  twiiTrendMeta.endIndex = clamped;
  renderTwiiTrendChart();
}

function initTwiiTrendInteraction() {
  if (!els.twiiTrendChart) {
    return;
  }
  els.twiiTrendChart.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    twiiTrendDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      endIndex: Number(twiiTrendMeta.endIndex) || (twiiTrendMeta.items || []).length
    };
    els.twiiTrendChart.setPointerCapture(event.pointerId);
  });
  els.twiiTrendChart.addEventListener("pointermove", (event) => {
    if (!twiiTrendDrag || event.pointerId !== twiiTrendDrag.pointerId) {
      return;
    }
    const width = Math.max(1, els.twiiTrendChart.clientWidth);
    const dayWidth = width / Math.max(1, (Number(twiiTrendMeta.visibleCount) || 2) - 1);
    const dayDelta = Math.round((event.clientX - twiiTrendDrag.startX) / dayWidth);
    if (dayDelta !== 0) {
      event.preventDefault();
      moveTwiiTrendWindow(twiiTrendDrag.endIndex - dayDelta);
    }
  });
  const endDrag = (event) => {
    if (twiiTrendDrag && event.pointerId === twiiTrendDrag.pointerId) {
      twiiTrendDrag = null;
    }
  };
  els.twiiTrendChart.addEventListener("pointerup", endDrag);
  els.twiiTrendChart.addEventListener("pointercancel", endDrag);
  els.twiiTrendChart.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -5, ArrowRight: 5, PageUp: -22, PageDown: 22 };
    if (event.key === "Home") {
      event.preventDefault();
      moveTwiiTrendWindow(Number(twiiTrendMeta.visibleCount) || 2);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTwiiTrendWindow((twiiTrendMeta.items || []).length);
    } else if (moves[event.key]) {
      event.preventDefault();
      moveTwiiTrendWindow((Number(twiiTrendMeta.endIndex) || 0) + moves[event.key]);
    }
  });
  document.querySelectorAll("[data-twii-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextMonths = Number(button.dataset.twiiRange) || 2;
      twiiTrendMeta.activeMonths = TWII_TREND_MONTHS.includes(nextMonths) ? nextMonths : 2;
      renderTwiiTrendChart();
    });
  });
  els.twiiCapitalToggle?.addEventListener("change", () => {
    showTwiiCapital = els.twiiCapitalToggle.checked;
    renderTwiiTrendChart();
  });
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
      return `
        <article class="fund-card fund-list-row">
          <div class="fund-head">
            <h3>${renderFundName(fund)}</h3>
            <div class="score compact-score" role="button" tabindex="0" data-score-fund="${escapeHtml(fundLookupKey(fund))}" title="查看綜合分數算法">${fund.score}</div>
          </div>
          <div class="fund-action-row">
            <div class="fund-info-block">
              <div class="pill-row">
                ${navTag(fund)}
                ${performanceTag("1年", fund.return1y)}
                ${performanceTag("3年年化", fund.return3y)}
              </div>
              <div class="period-performance-row">
                ${performanceMetric("1月", fund.return1m)}
                ${performanceMetric("3月", fund.return3m)}
                ${performanceMetric("6月", fund.return6m)}
                ${performanceMetric("波動度", fund.volatility, { colorize: false, signed: false })}
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
    hideScoreModal();
    return;
  }
  const scoreTrigger = event.target.closest?.("[data-score-fund]");
  if (scoreTrigger && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    showScoreModal(scoreTrigger.dataset.scoreFund);
  }
});

document.addEventListener("click", (event) => {
  const scoreTrigger = event.target.closest?.("[data-score-fund]");
  if (scoreTrigger) {
    showScoreModal(scoreTrigger.dataset.scoreFund);
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

async function loadMarginData() {
  try {
    const response = await fetch("data/margin.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("找不到籌碼資料。");
    }
    const payload = await response.json();
    marginMeta = {
      source: payload.source || "TWSE 融資餘額",
      updatedAt: payload.updatedAt || null,
      items: Array.isArray(payload.items) ? payload.items : [],
      activeWindow: marginMeta.activeWindow || 66
    };
  } catch (_error) {
    marginMeta = {
      source: "籌碼資料未載入",
      updatedAt: null,
      items: [],
      activeWindow: marginMeta.activeWindow || 66
    };
  } finally {
    renderMarginChart();
  }
}

async function loadTwiiTrendData() {
  try {
    const response = await fetch("data/twii_history.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("找不到台股均線資料。");
    }
    const payload = await response.json();
    twiiTrendMeta = {
      source: payload.source || "台股日收盤資料",
      updatedAt: payload.updatedAt || null,
      items: Array.isArray(payload.items) ? payload.items : [],
      activeMonths: twiiTrendMeta.activeMonths || 2,
      endIndex: null,
      visibleCount: twiiTrendMeta.visibleCount || 44
    };
  } catch (_error) {
    twiiTrendMeta = {
      source: "台股均線資料未載入",
      updatedAt: null,
      items: [],
      activeMonths: twiiTrendMeta.activeMonths || 2,
      endIndex: null,
      visibleCount: twiiTrendMeta.visibleCount || 44
    };
  } finally {
    renderTwiiTrendChart();
  }
}

document.querySelectorAll("[data-margin-window]").forEach((button) => {
  button.addEventListener("click", () => {
    marginMeta.activeWindow = Number(button.dataset.marginWindow) || 66;
    renderMarginChart();
  });
});

initAuth();
initTwiiTrendInteraction();
loadLatestData();
loadMonthlyNavData();
loadMarketData();
loadMarginData();
loadTwiiTrendData();
