import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const sourcePath = path.join(root, "data/monthly_nav.json");
const outputDir = path.join(root, "data/nav_history");
const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const items = payload.items;
if (!payload.updatedAt || !items || typeof items !== "object" || Array.isArray(items)) {
  throw new Error("monthly_nav.json is missing updatedAt or items");
}

const ids = Object.keys(items).sort();
if (ids.some((id) => !/^[A-Z0-9_-]+$/i.test(id))) {
  throw new Error("monthly_nav.json contains an unsafe fund ID");
}

function weekKeyFromDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const calendar = {};
for (const [periodType, sourceKey] of [["month", "months"], ["week", "weeks"], ["day", "days"]]) {
  const byPeriod = new Map();
  for (const item of Object.values(items)) {
    for (const row of item?.[sourceKey] || []) {
      const date = String(row?.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue;
      }
      const period = periodType === "month" ? date.slice(0, 7) : periodType === "week" ? weekKeyFromDate(date) : date;
      if (!byPeriod.has(period) || date > byPeriod.get(period).date) {
        byPeriod.set(period, { period, date });
      }
    }
  }
  calendar[periodType] = [...byPeriod.values()].sort((a, b) => a.date.localeCompare(b.date));
}

fs.mkdirSync(outputDir, { recursive: true });
for (const id of ids) {
  fs.writeFileSync(path.join(outputDir, `${id}.json`), `${JSON.stringify(items[id])}\n`);
}
const expected = new Set(ids.map((id) => `${id}.json`));
for (const file of fs.readdirSync(outputDir)) {
  if (file.endsWith(".json") && file !== "index.json" && !expected.has(file)) {
    fs.unlinkSync(path.join(outputDir, file));
  }
}
fs.writeFileSync(
  path.join(outputDir, "index.json"),
  `${JSON.stringify({ source: payload.source, updatedAt: payload.updatedAt, ids, calendar })}\n`
);
const sourceBytes = fs.statSync(sourcePath).size;
console.log(`Published NAV history index and ${ids.length} fund files from ${(sourceBytes / 1048576).toFixed(1)} MiB cache`);
if (sourceBytes > 25 * 1048576) {
  console.warn("NAV history cache exceeds 25 MiB; review fund coverage and retention before it grows further");
}
