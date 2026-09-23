import "../fund-box.js";

const { analyzeFundBox, buyDecision, holdingDecision } = globalThis.FundBox;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function rows(values, start = "2026-01-01") {
  const date = new Date(`${start}T00:00:00Z`);
  return values.map((nav, index) => {
    const next = new Date(date.valueOf());
    next.setUTCDate(next.getUTCDate() + index);
    return { date: next.toISOString().slice(0, 10), nav };
  });
}

const testOptions = {
  staleDays: 9999,
  now: "2026-03-01T00:00:00Z"
};

const rising = analyzeFundBox(rows([100, 110, 120]), testOptions);
assert(rising.status === "inside", `rising fund should remain inside its box, got ${rising.status}`);
assert(Math.abs(rising.top - 120) < 0.0001, "box top should follow the highest NAV");
assert(Math.abs(rising.bottom - 96) < 0.0001, "box bottom should remain exactly 20% below the top");
assert(rising.segments.length === 3, "each new high should raise the visible trailing box");

const pullback = analyzeFundBox(rows([100, 120, 115, 108, 105]), testOptions);
assert(Math.abs(pullback.top - 120) < 0.0001, "a pullback must not lower the box top");
assert(Math.abs(pullback.bottom - 96) < 0.0001, "a pullback must not lower the box bottom");
assert(holdingDecision(pullback).label === "尚未跌破箱底", "a value above the trailing floor should remain a hold");

const raisedAgain = analyzeFundBox(rows([100, 120, 110, 130, 125]), testOptions);
assert(Math.abs(raisedAgain.top - 130) < 0.0001, "a later all-time high should raise the box again");
assert(Math.abs(raisedAgain.bottom - 104) < 0.0001, "the raised box should keep a 20% width");

const breakdown = analyzeFundBox(rows([100, 120, 110, 95]), testOptions);
assert(breakdown.status === "trailing_breakdown", "the first NAV at or below the floor should be visible immediately");
assert(holdingDecision(breakdown).label === "跌破箱底", "a trailing-floor breach should display a clear warning");
assert(holdingDecision(breakdown).detail.includes("由你判斷"), "the site must leave the redemption decision to the user");

const restoredPeak = analyzeFundBox(rows([130, 125, 128], "2026-02-01"), {
  ...testOptions,
  trackingStartDate: "2025-06-01",
  peakSeeds: [{ date: "2025-10-10", nav: 150 }]
});
assert(Math.abs(restoredPeak.top - 150) < 0.0001, "a saved historical peak must survive a shortened chart history");
assert(Math.abs(restoredPeak.bottom - 120) < 0.0001, "a restored peak should restore the same trailing floor");

const purchaseSeed = analyzeFundBox(rows([96, 98, 97], "2026-02-01"), {
  ...testOptions,
  trackingStartDate: "2026-01-15",
  peakSeeds: [{ date: "2026-01-15", nav: 100 }]
});
assert(Math.abs(purchaseSeed.top - 100) < 0.0001, "the purchase NAV should seed a box before chart history begins");
assert(Math.abs(purchaseSeed.bottom - 80) < 0.0001, "the purchase-seeded box should use a 20% floor");

const sameFundRows = rows([100, 150, 120], "2026-01-01");
const earlierPurchase = analyzeFundBox(sameFundRows, {
  ...testOptions,
  trackingStartDate: "2026-01-01",
  peakSeeds: [{ date: "2026-01-01", nav: 100 }]
});
const laterPurchase = analyzeFundBox(sameFundRows, {
  ...testOptions,
  trackingStartDate: "2026-01-03",
  peakSeeds: [{ date: "2026-01-03", nav: 120 }]
});
assert(Math.abs(earlierPurchase.top - 150) < 0.0001, "the earlier purchase should retain the pre-second-purchase high");
assert(Math.abs(earlierPurchase.bottom - 120) < 0.0001, "the earlier purchase should trail its own high");
assert(Math.abs(laterPurchase.top - 120) < 0.0001, "the later purchase must not inherit a high from before its buy date");
assert(Math.abs(laterPurchase.bottom - 96) < 0.0001, "the later purchase should calculate its own 20% floor");

const distributionBlocked = analyzeFundBox(rows([100, 101, 80]), {
  ...testOptions,
  distributing: true,
  adjusted: false
});
assert(distributionBlocked.status === "distribution_unadjusted", "raw distributions must not create false box breaches");

const stale = analyzeFundBox(rows([100, 120, 115], "2025-01-01"), {
  now: "2026-03-01T00:00:00Z"
});
assert(stale.status === "stale", "stale NAV history must not produce a current sell warning");
assert(Math.abs(stale.bottom - 96) < 0.0001, "a stale box should remain visible even though its signal is paused");

const stableLowRows = rows([110, 108, 104, 100, 95, 90, 91, 92, 93]);
const stableLow = analyzeFundBox(stableLowRows, testOptions);
const freshLowRows = rows([110, 108, 104, 100, 95, 90]);
const freshLow = analyzeFundBox(freshLowRows, testOptions);
assert(buyDecision(stableLow).label === "低點區可分批", "a stabilized multi-month low should allow installments");
assert(buyDecision(freshLow).label === "低點尚未止穩", "a fresh low should wait for three stable trading days");
assert(buyDecision(breakdown).label === "暫緩加碼", "a broken trailing floor should warn against adding");
assert(buyDecision(distributionBlocked).label === "低點無法判斷", "blocked distribution data must not produce an entry signal");

const distributionOptions = {
  ...testOptions,
  fundId: "TESTB",
  distributing: true,
  trackingStartDate: "2026-01-01",
  distributions: {
    fundId: "TESTB", coverageStart: "2025-01-01", checkedThrough: "2026-03-01",
    events: [{ date: "2026-01-03", amount: 20, exNav: 90 }]
  }
};
const near = (a, b) => Math.abs(a - b) < 1e-8;
const exDividend = analyzeFundBox(rows([100, 110, 90, 86]), distributionOptions);
assert(exDividend.status === "inside", "cash distributions must enable a verified box");
assert(near(exDividend.top, 90) && near(exDividend.bottom, 72), "box must use latest raw NAV units after ex-dividend");
assert(near(exDividend.rawPeakNav, 110), "peak persistence must retain the original date's raw NAV");
assert(near(exDividend.latest.nav, 86), "latest NAV must stay comparable to bank NAV");
assert(near(exDividend.rows[1].nav, exDividend.rows[2].nav), "a pure distribution must not look like a price loss");
const realLoss = analyzeFundBox(rows([100, 110, 90, 71]), distributionOptions);
assert(realLoss.status === "trailing_breakdown", "a real loss after a distribution must still breach the floor");

const reloaded = analyzeFundBox(rows([86], "2026-01-04"), {
  ...distributionOptions,
  peakSeeds: [{ date: exDividend.peakDate, nav: exDividend.rawPeakNav }]
});
assert(near(reloaded.top, exDividend.top), "reload with truncated history must not double-adjust a saved peak");
const laterBuy = analyzeFundBox(rows([100, 110, 90, 86]), {
  ...distributionOptions, trackingStartDate: "2026-01-04",
  peakSeeds: [{ date: "2026-01-04", nav: 86 }]
});
assert(near(laterBuy.top, 86), "later purchase must have its own box, excluding earlier distributions/highs");
const exDateBuy = analyzeFundBox(rows([100, 110, 90, 86]), {
  ...distributionOptions, trackingStartDate: "2026-01-03",
  peakSeeds: [{ date: "2026-01-03", nav: 90 }]
});
assert(exDateBuy.adjustments.length === 0 && near(exDateBuy.top, 90), "ex-date buys must not receive that day's distribution");
const multipleOptions = { ...distributionOptions, distributions: { ...distributionOptions.distributions, events: [
  { date: "2026-01-02", amount: 10, exNav: 90 },
  { date: "2026-01-03", amount: 9, exNav: 81 },
  { date: "2026-04-01", amount: 5 }
] } };
const multiple = analyzeFundBox(rows([100, 90, 81]), multipleOptions);
assert(near(multiple.top, 81) && near(multiple.bottom, 64.8), "multiple distributions must compound, ignoring future events");
const laterNewHigh = analyzeFundBox(rows([100, 90, 81, 95]), multipleOptions);
assert(near(laterNewHigh.top, 95) && near(laterNewHigh.rawPeakNav, 95), "new post-distribution highs must raise and persist the box");
const duplicate = analyzeFundBox(rows([100, 110, 90, 86]), {
  ...distributionOptions, distributions: { ...distributionOptions.distributions, events: [
    ...distributionOptions.distributions.events, ...distributionOptions.distributions.events
  ] }
});
assert(near(duplicate.top, exDividend.top), "duplicate cash rows must not be applied twice");
for (const [label, patch] of [
  ["wrong share class", { fundId: "TESTA" }],
  ["missing older cash history", { coverageStart: "2026-01-02" }],
  ["NAV newer than verified cash data", { checkedThrough: "2026-01-03" }],
  ["bad cash amount", { events: [{ date: "2026-01-03", amount: -1 }] }],
  ["conflicting same-day cash", { events: [{ date: "2026-01-03", amount: 20 }, { date: "2026-01-03", amount: 21 }] }]
]) {
  const result = analyzeFundBox(rows([100, 110, 90, 86]), {
    ...distributionOptions, distributions: { ...distributionOptions.distributions, ...patch }
  });
  assert(result.status === "distribution_unadjusted", `${label} must fail closed`);
  assert(result.top === null, `${label} must not produce a peak to persist`);
}
const missingExNav = analyzeFundBox(rows([86], "2026-01-04"), {
  ...distributionOptions,
  distributions: { ...distributionOptions.distributions, events: [{ date: "2026-01-03", amount: 20 }] }
});
assert(missingExNav.status === "distribution_unadjusted", "missing ex-date NAV must never use a nearby date as a guess");
const correctedExNav = analyzeFundBox(rows([100, 110, 91, 86]), distributionOptions);
assert(near(correctedExNav.rows[1].nav, 110 * 91 / 111) && near(correctedExNav.top, 91), "corrected exact history must override old cached ex-date NAV");
const ordinary = analyzeFundBox(rows([100, 110, 90, 86]), { ...distributionOptions, distributing: false });
assert(near(ordinary.top, 110), "accumulating share classes must remain unadjusted");
const oldDistributionNav = analyzeFundBox(rows([100, 110, 90, 86]), { ...distributionOptions, staleDays: 7 });
assert(oldDistributionNav.status === "stale" && near(oldDistributionNav.top, 90), "old adjusted boxes remain visible but cannot issue current signals");

console.log("Fund box tests passed: trailing peaks, per-purchase isolation, cash adjustment, reload, and fail-closed scenarios");
