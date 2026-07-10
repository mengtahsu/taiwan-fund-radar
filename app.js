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
let selected = new Set();
let sourceMeta = {
  source: "示範資料",
  updatedAt: null
};
let marketMeta = {
  source: "市場資料未載入",
  updatedAt: null,
  markets: [],
  benchmarks: {}
};

const DISPLAY_LIMIT = 50;
const SUPABASE_URL = "https://yobdglsovihychcfszbi.supabase.co";
const SUPABASE_KEY = "sb_publishable_EeqYDx4CWa5l-DyPbz3I5g_PlSVCukK";
const SITE_URL = "https://mengtahsu.github.io/taiwan-fund-radar/";
const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let currentUser = null;
let purchases = [];

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
  compare: document.querySelector("#compareTable"),
  metricTotal: document.querySelector("#metricTotal"),
  metricReturn: document.querySelector("#metricReturn"),
  dataStatus: document.querySelector("#dataStatus"),
  marketList: document.querySelector("#marketList"),
  reset: document.querySelector("#resetBtn"),
  highReturn: document.querySelector("#highReturnBtn"),
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
  const name = escapeHtml(fund.name);
  const moneyDjId = String(fund.fundId || "").split("-", 1)[0].trim();
  if (!moneyDjId) {
    return name;
  }
  const url = `https://m.moneydj.com/a1.aspx?a=${encodeURIComponent(moneyDjId)}`;
  return `<a class="fund-name-link" href="${url}">${name}</a>`;
}

function renderBuyLink(fund) {
  if (fund.fubonBuyUrl) {
    return `<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}">富邦 App 申購</a>`;
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

function currentFundForPurchase(item) {
  return funds.find((fund) => fundLookupKey(fund) === item.fund_id) || null;
}

function purchaseValuation(item) {
  const amount = Number(item.amount) || 0;
  const buyNav = Number(item.nav) || 0;
  const fund = currentFundForPurchase(item);
  const currentNav = Number(fund?.nav) || 0;
  const units = amount > 0 && buyNav > 0 ? amount / buyNav : 0;
  if (units <= 0 || currentNav <= 0) {
    return {
      fund,
      currentNav,
      units,
      currentValue: null,
      profit: null,
      profitPercent: null
    };
  }
  const currentValue = units * currentNav;
  const profit = currentValue - amount;
  return {
    fund,
    currentNav,
    units,
    currentValue,
    profit,
    profitPercent: amount > 0 ? (profit / amount) * 100 : null
  };
}

function portfolioSummary() {
  const summary = {
    invested: 0,
    currentValue: 0,
    valuedCount: 0,
    holdings: new Map()
  };
  purchases.forEach((item) => {
    const amount = Number(item.amount) || 0;
    const valuation = purchaseValuation(item);
    summary.invested += amount;
    if (valuation.currentValue !== null) {
      summary.currentValue += valuation.currentValue;
      summary.valuedCount += 1;
    }
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
  });
  return summary;
}

function renderPortfolioStats() {
  if (!els.portfolioStats) {
    return;
  }
  if (!currentUser || !purchases.length) {
    els.portfolioStats.innerHTML = "";
    return;
  }
  const summary = portfolioSummary();
  const profit = summary.currentValue - summary.invested;
  const profitPercent = summary.invested > 0 && summary.valuedCount > 0 ? (profit / summary.invested) * 100 : null;
  const profitClass = profit >= 0 ? "up" : "down";
  const topHoldings = [...summary.holdings.values()]
    .sort((a, b) => b.invested - a.invested)
    .slice(0, 3);
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
      <span>未實現損益</span>
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
  `;
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
  els.purchaseFundId.value = fundLookupKey(fund);
  els.purchaseFundName.value = fund.name;
  els.purchaseDate.value = els.purchaseDate.value || todayInputValue();
  if (typeof fund.nav === "number" && fund.nav > 0) {
    els.purchaseNav.value = fund.nav;
  }
  setMessage(els.purchaseMessage, "");
  document.querySelector("#portfolio")?.scrollIntoView({ behavior: "smooth", block: "start" });
  els.purchaseAmount.focus();
}

function renderPurchases() {
  if (!els.purchaseList) {
    return;
  }
  renderPortfolioStats();
  if (!currentUser) {
    els.purchaseList.innerHTML = '<div class="empty">登入後會顯示你的買入紀錄。</div>';
    return;
  }
  if (!purchases.length) {
    els.purchaseList.innerHTML = '<div class="empty">還沒有買入紀錄。</div>';
    return;
  }
  const sortedPurchases = [...purchases].sort((a, b) => {
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
  els.purchaseList.innerHTML = sortedPurchases
    .map(
      (item) => {
        const valuation = purchaseValuation(item);
        const profitClass = (valuation.profit || 0) >= 0 ? "up" : "down";
        const matchedFund = valuation.fund;
        const currentNavText = `${valuation.currentNav ? moneyNumber(valuation.currentNav) : "-"}${matchedFund?.navDate ? ` / ${escapeHtml(matchedFund.navDate)}` : ""}`;
        return `
          <article class="purchase-item">
            <div>
              <h4>${escapeHtml(item.fund_name)}</h4>
              <p>購買 ${escapeHtml(item.buy_date)} / 金額 ${moneyNumber(item.amount)} / 買入淨值 ${moneyNumber(item.nav)}</p>
              <p>現在淨值 ${currentNavText} / 現值 ${valuation.currentValue === null ? "-" : twd(valuation.currentValue)} / 損益 <strong class="${profitClass}">${valuation.profitPercent === null ? "-" : formatPercent(valuation.profitPercent)}</strong></p>
              ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
            </div>
            <button class="delete-purchase" type="button" data-delete-purchase="${escapeHtml(item.id)}">刪除</button>
          </article>
        `;
      }
    )
    .join("");
  document.querySelectorAll("[data-delete-purchase]").forEach((button) => {
    button.addEventListener("click", () => deletePurchase(button.dataset.deletePurchase));
  });
}

async function loadPurchases() {
  if (!db || !currentUser) {
    purchases = [];
    renderPurchases();
    return;
  }
  let { data, error } = await db
    .from("fund_purchases")
    .select("id,fund_id,fund_name,buy_date,amount,nav,note,created_at")
    .order("buy_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    purchases = [];
    renderPurchases();
    setMessage(els.purchaseMessage, `讀取失敗：${error.message}`, true);
    return;
  }
  purchases = data || [];
  renderPurchases();
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
      emailRedirectTo: `${SITE_URL}#portfolio`
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

  els.dataStatus.textContent = `${formatTaiwanDateTime(sourceMeta.updatedAt)} 台灣時間`;
}

function renderMarkets() {
  if (!els.marketList) {
    return;
  }
  if (!marketMeta.markets.length) {
    els.marketList.innerHTML = '<div class="market-empty">市場資料暫無法更新</div>';
    return;
  }
  els.marketList.innerHTML = marketMeta.markets
    .map((market) => {
      const moveClass = market.changePercent >= 0 ? "up" : "down";
      const url = market.url || marketUrl(market);
      const label = url
        ? `<a class="quote-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(market.label)}</a>`
        : `<span>${escapeHtml(market.label)}</span>`;
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
    nasdaqFuture: "https://tw.stock.yahoo.com/quote/NQ%3DF"
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
  const visibleList = list.slice(0, DISPLAY_LIMIT);
  els.count.textContent = list.length > DISPLAY_LIMIT ? `${list.length} 檔符合，顯示前 ${DISPLAY_LIMIT} 檔` : `${list.length} 檔符合`;
  renderMetrics(list);
  renderDataStatus();
  renderScoreExplain();

  if (!visibleList.length) {
    els.grid.innerHTML = '<div class="empty">沒有符合條件的基金，放寬風險或報酬門檻再試一次。</div>';
    renderCompare();
    return;
  }

  els.grid.innerHTML = visibleList
    .map((fund) => {
      const checked = selected.has(fund.name) ? "checked" : "";
      const selectedClass = selected.has(fund.name) ? " selected" : "";
      return `
        <article class="fund-card${selectedClass}">
          <div class="fund-head">
            <div>
              <h3>${renderFundName(fund)}</h3>
              <p>${escapeHtml(fund.ticker || fund.company)} / ${escapeHtml(fund.type)} / ${escapeHtml(fund.region)}</p>
            </div>
            <div class="score" title="${scoreTitle()}">${fund.score}</div>
          </div>
          <div class="pill-row">
            <span class="pill ${riskClass(fund.risk)}">RR ${fund.risk}</span>
            <span class="pill">${escapeHtml(fund.dividend)}</span>
            ${visibleTags(fund.tags).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="stats">
            <div class="stat"><span>三年年化</span><strong>${fund.return3y.toFixed(1)}%</strong></div>
            <div class="stat"><span>波動度</span><strong>${fund.volatility.toFixed(1)}%</strong></div>
            ${benchmarkStatus(fund, "2w")}
            ${benchmarkStatus(fund, "1m")}
          </div>
          <div class="card-actions">
            ${renderBuyLink(fund)}
            <button class="record-link" type="button" data-buy-fund="${escapeHtml(fundLookupKey(fund))}">記錄買入</button>
            <label class="choice">
              <input type="checkbox" data-fund="${escapeHtml(fund.name)}" ${checked}>
              比較
            </label>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-fund]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked && selected.size >= 3) {
        input.checked = false;
        return;
      }
      input.checked ? selected.add(input.dataset.fund) : selected.delete(input.dataset.fund);
      renderFunds();
      renderCompare();
    });
  });
  document.querySelectorAll("[data-buy-fund]").forEach((button) => {
    button.addEventListener("click", () => {
      const fund = funds.find((item) => fundLookupKey(item) === button.dataset.buyFund);
      if (fund) {
        setPurchaseFund(fund);
      }
    });
  });

  renderCompare();
}

function renderCompare() {
  const list = funds.filter((fund) => selected.has(fund.name)).map((fund) => ({ ...fund, score: scoreFund(fund) }));
  if (!list.length) {
    els.compare.innerHTML = '<div class="empty">尚未選擇基金。</div>';
    return;
  }

  els.compare.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>基金</th>
          <th>分數</th>
          <th>RR</th>
          <th>三年年化</th>
          <th>波動度</th>
          <th>Sharpe</th>
          <th>淨值/日期</th>
          <th>配息</th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map(
            (fund) => `
              <tr>
                <td>${escapeHtml(fund.name)}</td>
                <td>${fund.score}</td>
                <td>RR ${fund.risk}</td>
                <td>${fund.return3y.toFixed(1)}%</td>
                <td>${fund.volatility.toFixed(1)}%</td>
                <td>${fund.sharpe.toFixed(2)}</td>
                <td>${fund.nav || fund.price ? `${formatPrice(fund)} / ${liquidityLabel(fund)}` : formatMoney(fund.aum)}</td>
                <td>${escapeHtml(fund.dividend)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
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
  els.return.value = 50;
  els.beatBenchmark.checked = false;
  els.sort.value = "score";
  document.querySelector("input[name='goal'][value='growth']").checked = true;
  syncLabels();
  renderFunds();
}

function applyHighReturnPreset() {
  els.query.value = "";
  els.type.value = "non-etf";
  els.region.value = "all";
  els.risk.value = 5;
  els.return.value = 8;
  els.beatBenchmark.checked = true;
  els.sort.value = "excess2w";
  document.querySelector("input[name='goal'][value='growth']").checked = true;
  syncLabels();
  renderFunds();
}

[els.query, els.type, els.region, els.risk, els.return, els.beatBenchmark, els.sort].forEach((el) => {
  el.addEventListener("input", () => {
    syncLabels();
    renderFunds();
  });
});

document.querySelectorAll("input[name='goal']").forEach((input) => input.addEventListener("change", renderFunds));
els.reset.addEventListener("click", resetFilters);
els.highReturn.addEventListener("click", applyHighReturnPreset);
els.signIn?.addEventListener("click", signIn);
els.signUp?.addEventListener("click", signUp);
els.signOut?.addEventListener("click", signOut);
els.purchaseForm?.addEventListener("submit", savePurchase);
els.purchaseFundName?.addEventListener("input", () => {
  els.purchaseFundId.value = "";
});
els.refreshPurchases?.addEventListener("click", loadPurchases);
if (els.purchaseDate) {
  els.purchaseDate.value = todayInputValue();
}

async function loadLatestData() {
  try {
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
  } catch (error) {
    sourceMeta = {
      source: "示範資料",
      updatedAt: null
    };
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
Promise.all([loadLatestData(), loadMarketData()]);
