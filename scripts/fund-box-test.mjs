import "../fund-box.js";

const { analyzeFundBox, buyDecision } = globalThis.FundBox;

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
  minimumPoints: 1,
  staleDays: 9999,
  now: "2026-03-01T00:00:00Z"
};

const narrow = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 106, 103, 104, 105, 104, 106.81]),
  testOptions
);
assert(narrow.status === "inside", `narrow box should be active, got ${narrow.status}`);
assert(Math.abs(narrow.top - 110) < 0.0001, "narrow box top should be 110");
assert(Math.abs(narrow.bottom - 99) < 0.0001, "narrow box should expand to the 10% floor");
assert(Math.abs(narrow.position - 0.71) < 0.002, "narrow box position should be about 71%");
assert(narrow.segments[0].startIndex === 5, "provisional box must start on top confirmation day");
assert(narrow.segments[1].startIndex === 10, "confirmed box must start on bottom confirmation day without repainting history");

const natural = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 102, 95, 96, 97, 98, 100]),
  testOptions
);
assert(natural.status === "inside", `natural box should be active, got ${natural.status}`);
assert(Math.abs(natural.bottom - 95) < 0.0001, "13.6% natural bottom should be retained");

const provisional = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 106, 104]),
  testOptions
);
assert(provisional.status === "provisional_inside", "unconfirmed natural bottom should use a provisional box");
assert(Math.abs(provisional.provisionalBottom - 99) < 0.0001, "provisional bottom should be 10% below top");

const provisionalBreakdown = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 98]),
  testOptions
);
assert(provisionalBreakdown.status === "provisional_breakdown", "provisional floor breach should be visible");
assert(provisionalBreakdown.difference < 0, "provisional breach difference should be negative");

const wide = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 90, 80, 82, 83, 84, 85]),
  testOptions
);
assert(wide.status === "wide_rebuilding", `box wider than 20% should rebuild, got ${wide.status}`);

const breakout = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 102, 95, 96, 97, 98, 111, 113]),
  testOptions
);
assert(breakout.status === "breakout_building", `upward breach should build a new box, got ${breakout.status}`);

const falseBreakout = analyzeFundBox(
  rows([100, 105, 110, 109, 108, 109, 102, 95, 96, 97, 98, 111, 109]),
  testOptions
);
assert(falseBreakout.status === "false_breakout", `return below old top should be a false breakout, got ${falseBreakout.status}`);

const distributionBlocked = analyzeFundBox(rows([100, 101, 102]), {
  ...testOptions,
  distributing: true,
  adjusted: false
});
assert(distributionBlocked.status === "distribution_unadjusted", "raw distribution NAV must not produce box signals");

const stale = analyzeFundBox(rows(Array.from({ length: 20 }, (_, index) => 100 + index), "2025-01-01"), {
  now: "2026-03-01T00:00:00Z"
});
assert(stale.status === "stale", "stale NAV history must not produce current signals");

assert(buyDecision(breakout).label === "先不要買", "an unfinished breakout must not look like a buy signal");
assert(buyDecision({ ...narrow, position: 0.2 }).label === "可以評估", "a confirmed lower-box position may be evaluated");
assert(buyDecision(narrow).label === "先觀望", "a confirmed upper-box position should not be chased");
assert(buyDecision(distributionBlocked).label === "無法判斷", "blocked distribution data must not produce a buy judgment");

console.log("Fund box tests passed: 9 scenarios and 4 buy decisions");
