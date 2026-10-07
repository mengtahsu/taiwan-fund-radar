const root = document.querySelector("#detailRoot");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function isTaiwanDollarFund(fund) {
  const text = [fund.currency, fund.name, ...(fund.tags || [])].filter(Boolean).join(" ").toUpperCase();
  if (!text) {
    return false;
  }
  return ["台幣", "新台幣", "新臺幣", "TWD", "NTD"].some((keyword) => text.includes(keyword));
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
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

function benchmarkForFund(fund, benchmarks) {
  return benchmarks.twii || null;
}

function forecastNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial = 1 - (
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  ) * Math.exp(-absolute * absolute);
  return 0.5 * (1 + sign * polynomial);
}

function oneMonthForecast(fund) {
  const nav = forecastNumber(fund.nav);
  const volatility = forecastNumber(fund.volatility);
  const periods = [
    { key: "return1m", months: 1, weight: 0.4, label: "近 1 月" },
    { key: "return3m", months: 3, weight: 0.3, label: "近 3 月" },
    { key: "return6m", months: 6, weight: 0.2, label: "近 6 月" },
    { key: "return1y", months: 12, weight: 0.1, label: "近 1 年" }
  ].filter((period) => {
    const value = forecastNumber(fund[period.key]);
    return value !== null && value > -100;
  });

  if (nav === null || nav <= 0 || volatility === null || volatility < 0 || periods.length < 2) {
    return null;
  }

  const weightTotal = periods.reduce((sum, period) => sum + period.weight, 0);
  const monthlyLogReturn = periods.reduce((sum, period) => {
    const returnRate = forecastNumber(fund[period.key]) / 100;
    return sum + (Math.log1p(returnRate) / period.months) * period.weight;
  }, 0) / weightTotal;
  const monthlyVolatility = (volatility / 100) / Math.sqrt(12);
  const interval = 1.2815515655446004; // 80% central interval under the scenario model.
  const medianNav = nav * Math.exp(monthlyLogReturn);
  const lowerNav = Math.max(0, nav * Math.exp(monthlyLogReturn - interval * monthlyVolatility));
  const upperNav = nav * Math.exp(monthlyLogReturn + interval * monthlyVolatility);
  const downProbability = monthlyVolatility > 0
    ? normalCdf(-monthlyLogReturn / monthlyVolatility) * 100
    : (monthlyLogReturn < 0 ? 100 : 0);

  return {
    nav,
    volatility,
    medianNav,
    lowerNav,
    upperNav,
    expectedReturn: (Math.exp(monthlyLogReturn) - 1) * 100,
    downProbability,
    periods,
    monthlyVolatility: monthlyVolatility * 100
  };
}

function renderForecast(fund) {
  const forecast = oneMonthForecast(fund);
  if (!forecast) {
    return `
      <section class="forecast-card muted-box" aria-label="一個月後估算">
        <h3>一個月後估算</h3>
        <p>目前資料不足，暫不估算。需要目前淨值、至少兩個期間績效與波動度。</p>
      </section>
    `;
  }

  const periodText = forecast.periods.map((period) => period.label).join("、");
  const navDate = fund.navDate ? `資料 ${escapeHtml(fund.navDate)}` : "資料日期未提供";
  return `
    <section class="forecast-card" aria-label="一個月後估算">
      <div class="forecast-heading">
        <div>
          <p class="eyebrow">Scenario estimate</p>
          <h3>一個月後估算</h3>
        </div>
        <span class="forecast-date">${navDate}</span>
      </div>
      <div class="forecast-grid">
        <div class="forecast-stat">
          <span>目前淨值</span>
          <strong>${formatNumber(forecast.nav)}</strong>
        </div>
        <div class="forecast-stat primary">
          <span>估算中位數</span>
          <strong>${formatNumber(forecast.medianNav)}</strong>
        </div>
        <div class="forecast-stat ${forecast.expectedReturn >= 0 ? "positive" : "negative"}">
          <span>估算漲跌幅</span>
          <strong>${forecast.expectedReturn >= 0 ? "+" : ""}${forecast.expectedReturn.toFixed(2)}%</strong>
        </div>
        <div class="forecast-stat">
          <span>80%情境區間</span>
          <strong>${formatNumber(forecast.lowerNav)}～${formatNumber(forecast.upperNav)}</strong>
        </div>
        <div class="forecast-stat">
          <span>跌低於目前機率</span>
          <strong>${forecast.downProbability.toFixed(0)}%</strong>
        </div>
      </div>
      <p class="forecast-note">模型月化報酬 ${forecast.expectedReturn >= 0 ? "+" : ""}${forecast.expectedReturn.toFixed(2)}%，月化波動約 ${forecast.monthlyVolatility.toFixed(2)}%。這是情境估算，不是買賣訊號。</p>
      <details class="forecast-method">
        <summary>查看算法</summary>
        <ol>
          <li>將${periodText}的期間報酬轉成月化對數報酬，再依 40%、30%、20%、10% 加權。</li>
          <li>以年化波動度 ÷ √12 估算一個月波動，使用中位數上下各 1.2816 個標準差建立 80% 情境區間。</li>
          <li>跌低於目前機率是假設月化報酬近似常態分布的結果，不代表實際機率。</li>
          <li>資料不足、淨值過舊或市場出現跳空時，估算可能失真；過去績效不保證未來結果。</li>
        </ol>
      </details>
    </section>
  `;
}

function renderBuyActions(fund) {
  const actions = [];
  if (fund.fubonBuyUrl) {
    actions.push(`<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}">富邦 App 申購</a>`);
  } else if (fund.fundrichAppUrl) {
    const label = fund.fundrichSource === "MoneyDJ 申購清單" ? "基富通申購" : "基富通 App 申購";
    actions.push(`<a class="buy-link secondary" href="${escapeHtml(fund.fundrichAppUrl)}">${label}</a>`);
  }
  if (fund.moneyDjUrl) {
    actions.push(`<a class="source-link" href="${escapeHtml(fund.moneyDjUrl)}" target="_blank" rel="noreferrer">MoneyDJ 原始資料</a>`);
  }
  return actions.join("");
}

function visibleTags(tags) {
  return (tags || []).filter((tag) => {
    const text = String(tag).trim();
    return text && !/^RR\s*\d+$/i.test(text) && !["富邦銀行可買", "基富通可買"].includes(text);
  });
}

function renderBenchmark(fund, benchmarks, period) {
  const benchmark = benchmarkForFund(fund, benchmarks);
  const returnKey = `return${period}`;
  const periodLabel = period === "1m" ? "近 1 月" : "近 2 週";
  if (typeof fund[returnKey] !== "number" || !benchmark || typeof benchmark[returnKey] !== "number") {
    return `<div class="detail-benchmark muted-box">${periodLabel}對決資料暫無法顯示。</div>`;
  }
  const excess = fund[returnKey] - benchmark[returnKey];
  const statusClass = excess >= 0 ? "beat" : "lag";
  const statusText = excess >= 0 ? `${periodLabel}贏台股` : `${periodLabel}輸台股`;
  const dataDate = fundReturnDate(fund, period);
  return `
    <div class="detail-benchmark ${statusClass}">
      <span>${statusText}</span>
      <strong>${formatPercent(excess)}</strong>
      <small>${formatPercent(fund[returnKey])} vs 台股 ${formatPercent(benchmark[returnKey])}${dataDate ? `｜資料 ${escapeHtml(dataDate)}` : ""}</small>
    </div>
  `;
}

function renderDetail(fund, markets) {
  const tags = visibleTags(fund.tags).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("");
  root.innerHTML = `
    <div class="detail-hero">
      <p class="kicker">${escapeHtml(fund.company)} / ${escapeHtml(fund.type)} / ${escapeHtml(fund.region)}</p>
      <h2>${escapeHtml(fund.name)}</h2>
      <div class="detail-actions">${renderBuyActions(fund)}</div>
    </div>

    ${renderBenchmark(fund, markets.benchmarks || {}, "2w")}
    ${renderBenchmark(fund, markets.benchmarks || {}, "1m")}

    ${renderForecast(fund)}

    <div class="detail-grid">
      <div class="stat"><span>三年年化</span><strong>${formatPercent(fund.return3y)}</strong></div>
      <div class="stat"><span>近 3 月</span><strong>${formatPercent(fund.return3m)}</strong></div>
      <div class="stat"><span>一年報酬</span><strong>${formatPercent(fund.return1y)}</strong></div>
      <div class="stat"><span>波動度</span><strong>${formatPercent(fund.volatility)}</strong></div>
      <div class="stat"><span>Sharpe</span><strong>${formatNumber(fund.sharpe)}</strong></div>
      <div class="stat"><span>基金規模</span><strong>${formatNumber(fund.aum)} 億</strong></div>
      <div class="stat"><span>風險等級</span><strong>RR ${escapeHtml(fund.risk)}</strong></div>
      <div class="stat"><span>通路</span><strong>${escapeHtml(fund.channel || "未確認")}</strong></div>
    </div>

    <div class="detail-section">
      <h3>標籤</h3>
      <div class="pill-row">${tags || '<span class="pill">無標籤</span>'}</div>
    </div>
  `;
}

async function loadDetail() {
  try {
    const params = new URLSearchParams(location.search);
    const id = params.get("id") || "";
    const [fundResponse, marketResponse] = await Promise.all([
      fetch("data/funds.json", { cache: "no-store" }),
      fetch("data/markets.json", { cache: "no-store" })
    ]);
    const fundPayload = await fundResponse.json();
    const marketPayload = marketResponse.ok ? await marketResponse.json() : { benchmarks: {} };
    const funds = (fundPayload.funds || []).filter(isTaiwanDollarFund);
    const fund = funds.find((item) => item.fundId === id || item.name === id);
    if (!fund) {
      throw new Error("找不到這檔基金。");
    }
    renderDetail(fund, marketPayload);
  } catch (error) {
    root.innerHTML = `<div class="empty">${escapeHtml(error.message || "無法讀取基金資料。")}</div>`;
  }
}

loadDetail();
