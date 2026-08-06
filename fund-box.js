(function attachFundBox(globalScope) {
  "use strict";

  const VERSION = "1.1";
  const DEFAULTS = Object.freeze({
    confirmationDays: 3,
    historyPoints: 126,
    minimumPoints: 20,
    minimumWidth: 0.1,
    maximumWidth: 0.2,
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
    const spanDays = Math.max(0, Math.round((Date.parse(`${rows.at(-1).date}T00:00:00Z`) - Date.parse(`${rows[0].date}T00:00:00Z`)) / 86400000));
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
    if (["provisional_breakdown", "false_breakout", "breakdown_rebuilding", "wide_rebuilding"].includes(status)) {
      return {
        code: "avoid",
        label: "暫緩加碼",
        detail: "目前有跌破、突破失敗或箱體失效訊號，先等風險穩定。",
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
      return { label: "持有無法判斷", detail: "資料不足、過舊，或配息尚未還原。", tone: "muted" };
    }
    const activeBottom = Number(analysis?.bottom);
    const provisionalBottom = Number(analysis?.provisionalBottom);
    const referenceBottom = Number(analysis?.reference?.bottom);
    let bottom = 0;
    let bottomKind = "";
    if (activeBottom > 0) {
      bottom = activeBottom;
      bottomKind = "正式箱底";
    } else if (referenceBottom > 0) {
      bottom = referenceBottom;
      bottomKind = analysis.reference.kind === "confirmed" ? "舊正式箱底" : "舊暫定箱底";
    } else if (provisionalBottom > 0) {
      bottom = provisionalBottom;
      bottomKind = "暫定箱底";
    }
    if (bottom > 0 && Number(analysis?.latest?.nav) < bottom) {
      let consecutiveDays = 0;
      for (let index = analysis.rows.length - 1; index >= 0 && analysis.rows[index].nav < bottom; index -= 1) {
        consecutiveDays += 1;
      }
      if (consecutiveDays >= 3) {
        return {
          label: "停損訊號",
          detail: `已連續 ${consecutiveDays} 個交易日低於${bottomKind} ${bottom.toFixed(2)}。`,
          tone: "danger",
          bottom,
          bottomKind
        };
      }
      return {
        label: "停損警戒",
        detail: `跌破${bottomKind} ${bottom.toFixed(2)}，但尚未連續 3 個交易日。`,
        tone: "danger",
        bottom,
        bottomKind
      };
    }
    return {
      label: "續抱，不停利",
      detail: bottom > 0
        ? `目前停損線採用${bottomKind} ${bottom.toFixed(2)}；尚未跌破，不因上漲或突破箱頂停利。`
        : "目前還沒有可用箱底；先續抱觀察，不因上漲停利。",
      tone: "positive",
      bottom: bottom || null,
      bottomKind: bottomKind || null
    };
  }

  function analyzeFundBox(rawRows, options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const rows = normalizeRows(rawRows, settings.historyPoints);
    const latest = rows.at(-1) || null;
    const base = {
      version: VERSION,
      settings,
      rows,
      latest,
      segments: [],
      events: [],
      status: "forming",
      tone: "muted",
      phase: "seeking_top",
      top: null,
      bottom: null,
      provisionalBottom: null,
      naturalBottom: null,
      position: null,
      difference: null,
      reference: null,
      candidateTop: null,
      candidateBottom: null
    };

    if (options.distributing && !options.adjusted) {
      return { ...base, status: "distribution_unadjusted", phase: "blocked" };
    }
    if (rows.length < settings.minimumPoints) {
      return { ...base, status: "insufficient", phase: "blocked" };
    }
    const ageDays = latest ? dateAgeDays(latest.date, options.now) : null;
    if (ageDays !== null && ageDays > settings.staleDays) {
      return { ...base, status: "stale", phase: "blocked", ageDays };
    }

    const segments = [];
    const events = [];
    let phase = "seeking_top";
    let candidateTop = null;
    let candidateBottom = null;
    let top = null;
    let provisionalBottom = null;
    let naturalBottom = null;
    let bottom = null;
    let currentSegment = null;
    let transition = { type: "initial", reference: null };

    const closeSegment = (index) => {
      if (currentSegment && currentSegment.endIndex === null) {
        currentSegment.endIndex = index;
        currentSegment.endDate = rows[index]?.date || currentSegment.startDate;
      }
      currentSegment = null;
    };

    const beginSeekingTop = (row, index, type, reference) => {
      phase = "seeking_top";
      candidateTop = { value: row.nav, date: row.date, index, stableDays: 0 };
      candidateBottom = null;
      top = null;
      provisionalBottom = null;
      naturalBottom = null;
      bottom = null;
      transition = { type, reference: reference || null };
    };

    rows.forEach((row, index) => {
      if (phase === "seeking_top") {
        if (!candidateTop || row.nav > candidateTop.value) {
          candidateTop = { value: row.nav, date: row.date, index, stableDays: 0 };
        } else if (index !== candidateTop.index) {
          candidateTop.stableDays += 1;
        }

        if (
          transition.type === "breakout" &&
          transition.reference?.top &&
          row.nav < transition.reference.top
        ) {
          transition = { ...transition, type: "false_breakout" };
          events.push({ index, date: row.date, nav: row.nav, type: "false_breakout" });
        }

        if (candidateTop.stableDays >= settings.confirmationDays) {
          top = {
            value: candidateTop.value,
            date: candidateTop.date,
            confirmedDate: row.date,
            confirmedIndex: index
          };
          provisionalBottom = top.value * (1 - settings.minimumWidth);
          currentSegment = {
            kind: "provisional",
            startIndex: index,
            startDate: row.date,
            endIndex: null,
            endDate: null,
            top: top.value,
            bottom: provisionalBottom,
            topDate: top.date,
            topConfirmedDate: top.confirmedDate,
            bottomConfirmedDate: null
          };
          segments.push(currentSegment);
          events.push({ index, date: row.date, nav: top.value, type: "top_confirmed" });
          candidateBottom = null;
          phase = "seeking_bottom";
        }
        return;
      }

      if (phase === "seeking_bottom") {
        if (row.nav > top.value) {
          closeSegment(index);
          events.push({ index, date: row.date, nav: row.nav, type: "breakout" });
          beginSeekingTop(row, index, "breakout", {
            top: top.value,
            bottom: provisionalBottom,
            kind: "provisional"
          });
          return;
        }

        if (!candidateBottom || row.nav < candidateBottom.value) {
          candidateBottom = { value: row.nav, date: row.date, index, stableDays: 0 };
        } else if (index !== candidateBottom.index) {
          candidateBottom.stableDays += 1;
        }

        if (row.nav < provisionalBottom && !currentSegment.provisionalBreachDate) {
          currentSegment.provisionalBreachDate = row.date;
          events.push({ index, date: row.date, nav: row.nav, type: "provisional_breakdown" });
        }

        if (candidateBottom.stableDays >= settings.confirmationDays) {
          naturalBottom = {
            value: candidateBottom.value,
            date: candidateBottom.date,
            confirmedDate: row.date,
            confirmedIndex: index
          };
          const naturalWidth = (top.value - naturalBottom.value) / top.value;
          closeSegment(index);
          events.push({ index, date: row.date, nav: naturalBottom.value, type: "bottom_confirmed" });

          if (naturalWidth > settings.maximumWidth) {
            events.push({ index, date: row.date, nav: row.nav, type: "wide_breakdown" });
            beginSeekingTop(row, index, "wide_breakdown", {
              top: top.value,
              bottom: provisionalBottom,
              naturalBottom: naturalBottom.value,
              kind: "provisional"
            });
            return;
          }

          bottom = Math.min(naturalBottom.value, provisionalBottom);
          currentSegment = {
            kind: "confirmed",
            startIndex: index,
            startDate: row.date,
            endIndex: null,
            endDate: null,
            top: top.value,
            bottom,
            naturalBottom: naturalBottom.value,
            width: (top.value - bottom) / top.value,
            topDate: top.date,
            topConfirmedDate: top.confirmedDate,
            bottomDate: naturalBottom.date,
            bottomConfirmedDate: naturalBottom.confirmedDate
          };
          segments.push(currentSegment);
          transition = { type: "active", reference: null };
          phase = "active";
        }
        return;
      }

      if (phase === "active") {
        if (row.nav > top.value) {
          closeSegment(index);
          events.push({ index, date: row.date, nav: row.nav, type: "breakout" });
          beginSeekingTop(row, index, "breakout", {
            top: top.value,
            bottom,
            kind: "confirmed"
          });
          return;
        }
        if (row.nav < bottom) {
          closeSegment(index);
          events.push({ index, date: row.date, nav: row.nav, type: "breakdown" });
          beginSeekingTop(row, index, "breakdown", {
            top: top.value,
            bottom,
            kind: "confirmed"
          });
        }
      }
    });

    if (currentSegment && currentSegment.endIndex === null) {
      currentSegment.endIndex = rows.length - 1;
      currentSegment.endDate = latest.date;
      currentSegment.current = true;
    }

    let status = "forming";
    let tone = "muted";
    let position = null;
    let difference = null;
    let reference = transition.reference;

    if (phase === "active") {
      status = "inside";
      tone = "normal";
      position = boxPosition(latest.nav, bottom, top.value);
    } else if (phase === "seeking_bottom") {
      if (latest.nav < provisionalBottom) {
        status = "provisional_breakdown";
        tone = "danger";
        difference = relativeChange(latest.nav, provisionalBottom);
      } else {
        status = "provisional_inside";
        tone = "normal";
        position = boxPosition(latest.nav, provisionalBottom, top.value);
      }
    } else if (transition.type === "false_breakout") {
      status = "false_breakout";
      tone = "danger";
      difference = relativeChange(latest.nav, reference.top);
    } else if (transition.type === "breakout") {
      status = "breakout_building";
      tone = "positive";
      difference = relativeChange(latest.nav, reference.top);
    } else if (transition.type === "breakdown") {
      status = "breakdown_rebuilding";
      tone = "danger";
      difference = relativeChange(latest.nav, reference.bottom);
    } else if (transition.type === "wide_breakdown") {
      status = "wide_rebuilding";
      tone = "danger";
      difference = relativeChange(latest.nav, reference.bottom);
    }

    return {
      ...base,
      segments,
      events,
      status,
      tone,
      phase,
      top: top?.value || null,
      bottom,
      provisionalBottom,
      naturalBottom: naturalBottom?.value || candidateBottom?.value || null,
      position,
      difference,
      reference,
      candidateTop,
      candidateBottom,
      topDetail: top,
      naturalBottomDetail: naturalBottom,
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
