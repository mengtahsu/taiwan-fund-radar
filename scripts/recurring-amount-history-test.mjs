import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase-recurring-amount-history.sql", "utf8");
const app = fs.readFileSync("app.js", "utf8");

assert.match(sql, /create table if not exists public\.recurring_plan_amount_history/i);
assert.match(sql, /alter table public\.recurring_plan_amount_history enable row level security/i);
assert.match(sql, /revoke all on public\.recurring_plan_amount_history from anon, authenticated/i);
assert.match(sql, /effective_day := greatest\(new\.start_date, \(now\(\) at time zone 'Asia\/Taipei'\)::date \+ 1\)/i);
assert.match(sql, /on conflict \(plan_id, effective_date\) do update set amount = excluded\.amount/i);
assert.match(sql, /before insert on public\.fund_purchases/i);
assert.match(sql, /effective_date <= new\.scheduled_date/i);
assert.match(sql, /if debit_amount is null then\s+raise exception/i);
assert.match(sql, /new\.amount := debit_amount/i);
assert.match(app, /新金額適用於台灣時間明天起的扣款，過去扣款金額不變/);

console.log("Recurring amount history guards passed");
