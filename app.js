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
  highReturn: document.querySelector("#highReturnBtn")
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
  if (fund.region === "台灣" || fund.type === "台股") {
    return marketMeta.benchmarks.twii || null;
  }
  const text = [fund.name, fund.type, fund.region, ...(fund.tags || [])].join(" ");
  if (fund.region === "美國" || /科技|Nasdaq|NASDAQ|那斯達克|5G|AI|半導體/.test(text)) {
    return marketMeta.benchmarks.nasdaq || marketMeta.benchmarks.sp500 || null;
  }
  return marketMeta.benchmarks.sp500 || null;
}

function excessReturn2w(fund) {
  if (typeof fund.return2w !== "number") {
    return null;
  }
  const benchmark = benchmarkForFund(fund);
  if (!benchmark || typeof benchmark.return2w !== "number") {
    return null;
  }
  return fund.return2w - benchmark.return2w;
}

function recentMomentumScore(fund) {
  const return3mScore = clamp((fund.return3m ?? 0) / 60, 0, 1);
  const excess2w = excessReturn2w(fund);
  const excess2wScore = excess2w === null ? 0.45 : clamp((excess2w + 10) / 25, 0, 1);
  return return3mScore * 0.55 + excess2wScore * 0.45;
}

function scoreFund(fund) {
  const currentGoal = goal();
  const riskFit = 1 - Math.max(0, fund.risk - Number(els.risk.value)) / 4;
  const returnScore = clamp(fund.return3y / 80, 0, 1);
  const stabilityScore = 1 - clamp(fund.volatility / 28, 0, 1);
  const incomeScore = fund.dividend.includes("配") ? 1 : 0.35;
  const sharpeScore = clamp(fund.sharpe / 2, 0, 1);
  const momentumScore = recentMomentumScore(fund);

  const weights = {
    growth: [returnScore, momentumScore, sharpeScore, riskFit],
    income: [incomeScore, stabilityScore, riskFit, momentumScore],
    stability: [stabilityScore, riskFit, sharpeScore, momentumScore]
  }[currentGoal];

  return Math.round((weights[0] * 0.35 + weights[1] * 0.3 + weights[2] * 0.2 + weights[3] * 0.15) * 100);
}

function scoreTitle() {
  return {
    growth: "自訂綜合分數：三年年化 35%、近期動能 30%、Sharpe 20%、風險符合度 15%。近期動能含近 3 月報酬與近 2 週超額報酬",
    income: "自訂綜合分數：配息型態 35%、低波動 30%、風險符合度 20%、近期動能 15%。近期動能含近 3 月報酬與近 2 週超額報酬",
    stability: "自訂綜合分數：低波動 35%、風險符合度 30%、Sharpe 20%、近期動能 15%。近期動能含近 3 月報酬與近 2 週超額報酬"
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
  els.scoreExplain.textContent = `${label}的綜合分數算法：${scoreTitle().replace("自訂綜合分數：", "")}。分數只用來排序，不代表買賣建議。`;
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
      const typeMatched = typeValue === "all" || (typeValue === "fubon-buyable" ? Boolean(fund.fubonBuyUrl) : fund.type === typeValue);
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

function benchmarkStatus(fund) {
  if (typeof fund.return2w !== "number") {
    return "";
  }
  const benchmark = benchmarkForFund(fund);
  if (!benchmark || typeof benchmark.return2w !== "number") {
    return "";
  }
  const excess = fund.return2w - benchmark.return2w;
  const statusClass = excess >= 0 ? "beat" : "lag";
  const label = excess >= 0 ? "近 2 週贏" : "近 2 週輸";
  return `
    <div class="benchmark ${statusClass}">
      <span>${label}</span>
      <strong>${formatPercent(excess)} <small>對 ${escapeHtml(benchmark.label)}</small></strong>
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
  const detailKey = encodeURIComponent(fund.fundId || fund.name);
  return `<a class="fund-name-link" href="detail.html?id=${detailKey}">${name}</a>`;
}

function renderBuyLink(fund) {
  if (fund.fubonBuyUrl) {
    return `<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}">富邦 App 申購</a>`;
  }
  if (fund.fundrichAppUrl) {
    return `<a class="buy-link secondary" href="${escapeHtml(fund.fundrichAppUrl)}">基富通 App 申購</a>`;
  }
  return "";
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

  const updated = new Date(sourceMeta.updatedAt);
  const label = Number.isNaN(updated.getTime())
    ? sourceMeta.updatedAt
    : updated.toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
  els.dataStatus.textContent = `${sourceMeta.source} ${label}`;
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
      const time = market.quoteTime ? `<small>${escapeHtml(market.quoteTime)}</small>` : "";
      return `
        <div class="quote-row">
          <div>
            <span>${escapeHtml(market.label)}</span>
            ${time}
          </div>
          <strong>${formatMarketPrice(market.price)}</strong>
          <em class="${moveClass}">${formatPercent(market.changePercent)}</em>
        </div>
      `;
    })
    .join("");
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
            <div class="stat"><span>${fund.nav ? "最新淨值" : fund.price ? "最新價格" : "基金規模"}</span><strong>${formatPrice(fund)}</strong></div>
            ${benchmarkStatus(fund)}
          </div>
          <div class="card-actions">
            ${renderBuyLink(fund)}
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

function normalizePayload(payload) {
  if (Array.isArray(payload)) {
    return {
      funds: payload,
      meta: {
        source: "匯入資料",
        updatedAt: null
      }
    };
  }

  if (payload && Array.isArray(payload.funds)) {
    return {
      funds: payload.funds,
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
  els.type.value = "all";
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
  els.type.value = "all";
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

Promise.all([loadLatestData(), loadMarketData()]);
