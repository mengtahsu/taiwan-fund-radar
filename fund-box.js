(function attachFundBox(globalScope) {
  "use strict";

  const VERSION = "2.0";
  const DEFAULTS = Object.freeze({
    historyPoints: 400,
    minimumPoints: 1,
    width: 0.2,
    staleDays: 7
  });

  function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeRows(rawRows, historyPoints = DEFAULTS.historyPoints) {
    const byDate = new Map();
    (Array.isArray(rawRows) ? rawRows : []).forEach((row) => {
      const date = String(row?.date || row?.day || "").slice(0, 10);
      const nav = finitePositive(row?.nav);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && nav !== null) {
        byDate.set(date, { date, nav });
      }
    });
    return [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-Math.max(1, historyPoints));
  }

  function normalizePeakSeeds(rawSeeds, trackingStartDate) {
    return (Array.isArray(rawSeeds) ? rawSeeds : [])
      .map((seed) => ({
        date: String(seed?.date || "").slice(0, 10),
        nav: finitePositive(seed?.nav)
      }))
      .filter(
        (seed) =>
          seed.nav !== null &&
          /^\d{4}-\d{2}-\d{2}$/.test(seed.date) &&
          (!trackingStartDate || seed.date >= trackingStartDate)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function dateAgeDays(date, nowValue) {
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    if (!Number.isFinite(timestamp) || Number.isNaN(now.getTime())) {
      return null;
    }
    return Math.floor((now.getTime() - timestamp) / 86400000);
  }

  function relativeChange(value, reference) {
    return reference > 0 ? value / reference - 1 : null;
  }

  function boxPosition(value, bottom, top) {
    if (!(top > bottom)) {
      return null;
    }
    return Math.max(0, Math.min(1, (value - bottom) / (top - bottom)));
  }

  function lowZoneMetrics(analysis) {
    const rows = Array.isArray(analysis?.rows) ? analysis.rows : [];
    if (!rows.length || !analysis?.latest) {
      return null;
    }
    const minimum = Math.min(...rows.map((row) => row.nav));
    let lowIndex = -1;
    rows.forEach((row, index) => {
      if (row.nav === minimum) {
        lowIndex = index;
      }
    });
    const spanDays = Math.max(
      0,
      Math.round(
        (Date.parse(`${rows.at(-1).date}T00:00:00Z`) - Date.parse(`${rows[0].date}T00:00:00Z`)) / 86400000
      )
    );
    const periodLabel = spanDays >= 150 ? "近半年" : spanDays >= 75 ? "近3個月" : "目前區間";
    return {
      minimum,
      lowDate: rows[lowIndex]?.date || "",
      stableDays: Math.max(0, rows.length - 1 - lowIndex),
      distance: relativeChange(analysis.latest.nav, minimum),
      periodLabel,
      spanDays
    };
  }

  function buyDecision(analysis) {
    const status = String(analysis?.status || "");
    if (["distribution_unadjusted", "stale", "insufficient"].includes(status)) {
      return {
        code: "unavailable",
        label: "低點無法判斷",
        detail: "資料不足、過舊，或配息尚未還原，不能判斷幾個月低點。",
        tone: "muted"
      };
    }
    if (status === "trailing_breakdown") {
      return {
        code: "avoid",
        label: "暫緩加碼",
        detail: "目前已跌破20%移動箱底，先由你判斷是否退出或等待。",
        tone: "danger"
      };
    }
    const low = lowZoneMetrics(analysis);
    if (!low || !Number.isFinite(low.distance)) {
      return {
        code: "unavailable",
        label: "低點無法判斷",
        detail: "目前沒有足夠的歷史淨值。",
        tone: "muted"
      };
    }
    if (low.distance <= 0.05 && low.stableDays >= 3) {
      return {
        code: "evaluate",
        label: "低點區可分批",
        detail: `${low.periodLabel}最低淨值 ${low.minimum.toFixed(2)}，目前高於低點 ${(low.distance * 100).toFixed(1)}%，而且低點已止穩 3 個交易日。`,
        tone: "positive",
        low
      };
    }
    if (low.distance <= 0.05) {
      return {
        code: "wait_stable",
        label: "低點尚未止穩",
        detail: `${low.periodLabel}最低淨值 ${low.minimum.toFixed(2)} 剛出現，先等 3 個交易日不再破底。`,
        tone: "warning",
        low
      };
    }
    return {
      code: "wait_low",
      label: "先等低點區",
      detail: `${low.periodLabel}最低淨值 ${low.minimum.toFixed(2)}，目前高出 ${(low.distance * 100).toFixed(1)}%；等回到低點 5% 內再分批評估。`,
      tone: "warning",
      low
    };
  }

  function holdingDecision(analysis) {
    const status = String(analysis?.status || "");
    if (["distribution_unadjusted", "stale", "insufficient"].includes(status)) {
      return {
        label: "持有無法判斷",
        detail: "資料不足、過舊，或配息尚未還原。",
        tone: "muted",
        bottom: finitePositive(analysis?.bottom)
      };
    }
    const top = finitePositive(analysis?.top);
    const bottom = finitePositive(analysis?.bottom);
    const latest = finitePositive(analysis?.latest?.nav);
    if (!top || !bottom || !latest) {
      return { label: "持有無法判斷", detail: "目前沒有可用的最高淨值或箱底。", tone: "muted" };
    }
    if (latest <= bottom) {
      return {
        label: "跌破箱底",
        detail: `最新淨值 ${latest.toFixed(2)} 已低於20%移動箱底 ${bottom.toFixed(2)}，低於箱底 ${Math.abs(relativeChange(latest, bottom) * 100).toFixed(1)}%；是否贖回由你判斷。`,
        tone: "danger",
        bottom,
        bottomKind: "20%移動箱底"
      };
    }
    return {
      label: "尚未跌破箱底",
      detail: `持有期間最高淨值 ${top.toFixed(2)}，20%移動箱底 ${bottom.toFixed(2)}；目前仍高於箱底 ${(relativeChange(latest, bottom) * 100).toFixed(1)}%。`,
      tone: "positive",
      bottom,
      bottomKind: "20%移動箱底"
    };
  }

  function analyzeFundBox(rawRows, options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const trackingStartDate = /^\d{4}-\d{2}-\d{2}$/.test(String(options.trackingStartDate || ""))
      ? String(options.trackingStartDate)
      : "";
    const normalizedRows = normalizeRows(rawRows, settings.historyPoints);
    const rows = trackingStartDate
      ? normalizedRows.filter((row) => row.date >= trackingStartDate)
      : normalizedRows;
    const latest = rows.at(-1) || null;
    const base = {
      version: VERSION,
      settings,
      trackingStartDate: trackingStartDate || rows[0]?.date || null,
      rows,
      latest,
      segments: [],
      events: [],
      status: "insufficient",
      tone: "muted",
      top: null,
      bottom: null,
      position: null,
      difference: null,
      peakDate: null,
      topDetail: null
    };

    if (options.distributing && !options.adjusted) {
      return { ...base, status: "distribution_unadjusted" };
    }
    if (rows.length < settings.minimumPoints || !latest) {
      return base;
    }

    const seeds = normalizePeakSeeds(options.peakSeeds, trackingStartDate);
    let seedIndex = 0;
    let peak = null;
    let peakDate = null;
    let currentSegment = null;
    const segments = [];
    const events = [];

    const beginSegment = (index, date, value) => {
      peak = value;
      peakDate = date;
      currentSegment = {
        kind: "trailing",
        startIndex: index,
        startDate: date,
        endIndex: null,
        endDate: null,
        top: value,
        bottom: value * (1 - settings.width),
        width: settings.width,
        topDate: date
      };
      segments.push(currentSegment);
    };

    rows.forEach((row, index) => {
      let candidateValue = row.nav;
      let candidateDate = row.date;
      while (seedIndex < seeds.length && seeds[seedIndex].date <= row.date) {
        if (seeds[seedIndex].nav > candidateValue) {
          candidateValue = seeds[seedIndex].nav;
          candidateDate = seeds[seedIndex].date;
        }
        seedIndex += 1;
      }
      if (peak === null) {
        beginSegment(index, candidateDate, candidateValue);
        return;
      }
      if (candidateValue > peak) {
        currentSegment.endIndex = index;
        currentSegment.endDate = row.date;
        events.push({ index, date: candidateDate, nav: candidateValue, type: "box_raised" });
        beginSegment(index, candidateDate, candidateValue);
      }
    });

    while (seedIndex < seeds.length && seeds[seedIndex].date <= latest.date) {
      const seed = seeds[seedIndex];
      if (seed.nav > peak) {
        currentSegment.endIndex = rows.length - 1;
        currentSegment.endDate = latest.date;
        events.push({ index: rows.length - 1, date: seed.date, nav: seed.nav, type: "box_raised" });
        beginSegment(rows.length - 1, seed.date, seed.nav);
      }
      seedIndex += 1;
    }

    currentSegment.endIndex = rows.length - 1;
    currentSegment.endDate = latest.date;
    currentSegment.current = true;

    const bottom = peak * (1 - settings.width);
    const breached = latest.nav <= bottom;
    const liveStatus = breached ? "trailing_breakdown" : "inside";
    const ageDays = dateAgeDays(latest.date, options.now);
    const stale = ageDays !== null && ageDays > settings.staleDays;

    if (breached) {
      events.push({
        index: rows.length - 1,
        date: latest.date,
        nav: latest.nav,
        type: "trailing_breakdown"
      });
    }

    return {
      ...base,
      segments,
      events,
      status: stale ? "stale" : liveStatus,
      liveStatus,
      tone: stale ? "muted" : breached ? "danger" : "normal",
      top: peak,
      bottom,
      position: boxPosition(latest.nav, bottom, peak),
      difference: relativeChange(latest.nav, bottom),
      peakDate,
      topDetail: { value: peak, date: peakDate },
      ageDays
    };
  }

  globalScope.FundBox = Object.freeze({
    VERSION,
    DEFAULTS,
    analyzeFundBox,
    buyDecision,
    holdingDecision,
    lowZoneMetrics,
    normalizeRows
  });
})(globalThis);
