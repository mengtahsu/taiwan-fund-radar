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

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function benchmarkForFund(fund, benchmarks) {
  return benchmarks.twii || null;
}

function renderBuyActions(fund) {
  const actions = [];
  if (fund.fubonBuyUrl) {
    actions.push(`<a class="buy-link" href="${escapeHtml(fund.fubonBuyUrl)}">富邦 App 申購</a>`);
  } else if (fund.fundrichAppUrl) {
    actions.push(`<a class="buy-link secondary" href="${escapeHtml(fund.fundrichAppUrl)}">基富通 App 申購</a>`);
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

function renderBenchmark(fund, benchmarks) {
  const benchmark = benchmarkForFund(fund, benchmarks);
  if (typeof fund.return2w !== "number" || !benchmark || typeof benchmark.return2w !== "number") {
    return '<div class="detail-benchmark muted-box">近 2 週對決資料暫無法顯示。</div>';
  }
  const excess = fund.return2w - benchmark.return2w;
  const statusClass = excess >= 0 ? "beat" : "lag";
  const statusText = excess >= 0 ? "近 2 週打敗基準" : "近 2 週落後基準";
  const range = fund.return2wStartDate && fund.return2wEndDate ? `${fund.return2wStartDate} - ${fund.return2wEndDate}` : "";
  return `
    <div class="detail-benchmark ${statusClass}">
      <span>${statusText}</span>
      <strong>${formatPercent(excess)}</strong>
      <small>${formatPercent(fund.return2w)} vs ${escapeHtml(benchmark.label)} ${formatPercent(benchmark.return2w)} ${escapeHtml(range)}</small>
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

    ${renderBenchmark(fund, markets.benchmarks || {})}

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
    const funds = fundPayload.funds || [];
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
