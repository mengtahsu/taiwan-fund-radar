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

console.log("Fund box tests passed: 10 trailing-box scenarios and 4 entry decisions");
