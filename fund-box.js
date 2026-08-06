(function attachFundBox(globalScope) {
  "use strict";

  const VERSION = "1.0";
  const DEFAULTS = Object.freeze({
    confirmationDays: 3,
    historyPoints: 60,
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

  function buyDecision(analysis) {
    const status = String(analysis?.status || "");
    const position = Number(analysis?.position);
    if (status === "inside") {
      if (Number.isFinite(position) && position <= 0.3) {
        return {
          code: "evaluate",
          label: "可以評估",
          detail: "正式箱已完成，而且淨值位於箱體下方 30% 內；仍需確認基金風險與最新淨值。",
          tone: "positive"
        };
      }
      return {
        code: "wait",
        label: "先觀望",
        detail: "正式箱已完成，但目前不在箱體下方 30% 內，先不要追價。",
        tone: "warning"
      };
    }
    if (status === "provisional_inside" || status === "forming") {
      return {
        code: "wait",
        label: "先觀望",
        detail: status === "provisional_inside" ? "只有暫定箱底，自然箱底尚未確認。" : "新箱的頂與底尚未確認。",
        tone: "warning"
      };
    }
    if (status === "breakout_building") {
      return {
        code: "avoid",
        label: "先不要買",
        detail: "剛突破舊箱頂，但新箱尚未完成，先不要追價。",
        tone: "danger"
      };
    }
    if (["provisional_breakdown", "false_breakout", "breakdown_rebuilding", "wide_rebuilding"].includes(status)) {
      return {
        code: "avoid",
        label: "先不要買",
        detail: "目前出現跌破、突破失敗或箱體失效訊號。",
        tone: "danger"
      };
    }
    return {
      code: "unavailable",
      label: "無法判斷",
      detail: "資料不足、過舊，或配息尚未還原，不能產生買進判斷。",
      tone: "muted"
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
    normalizeRows
  });
})(globalThis);
