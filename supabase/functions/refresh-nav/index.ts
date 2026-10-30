const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NavItem = {
  fundId: string;
  nav: number;
  navDate: string;
  navFullDate: string;
  navSource: string;
  history?: { date: string; nav: number }[];
  historyError?: string;
};

function uniqueFundIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value
    .map((item) => String(item || "").trim().split("-", 1)[0])
    .filter((item) => /^[A-Z0-9]{4,12}$/.test(item));
  return [...new Set(ids)].slice(0, 30);
}

function parseMoneyDjMobileLatestNav(fundId: string, html: string): NavItem | null {
  const match = html.match(
    /<span class="netValue[^"]*">\s*<span class="[^"]*">(?<nav>[\d,]+(?:\.\d+)?)<\/span>\s*<\/span>\s*[^<(]*\((?<date>\d{4}\/\d{2}\/\d{2})\)/s,
  );
  if (!match?.groups) {
    return null;
  }
  const nav = Number(match.groups.nav.replaceAll(",", ""));
  if (!Number.isFinite(nav) || nav <= 0) {
    return null;
  }
  const navFullDate = match.groups.date.replaceAll("/", "-");
  const [, month, day] = navFullDate.split("-");
  return {
    fundId,
    nav,
    navDate: `${month}/${day}`,
    navFullDate,
    navSource: "MoneyDJ mobile",
  };
}

async function fetchLatestNav(fundId: string): Promise<NavItem> {
  const url = `https://m.moneydj.com/a1.aspx?a=${encodeURIComponent(fundId)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://m.moneydj.com/",
    },
  });
  if (!response.ok) {
    throw new Error(`MoneyDJ ${response.status}`);
  }
  const item = parseMoneyDjMobileLatestNav(fundId, await response.text());
  if (!item) {
    throw new Error("MoneyDJ latest NAV not found");
  }
  return item;
}

function parseNavHistory(text: string, limit = 190): { date: string; nav: number }[] {
  const [rawDates, rawNavs] = text.split("<!--", 1)[0].trim().split(/\s+/);
  if (!rawDates || !rawNavs) throw new Error("historical NAV series missing");
  const dates = rawDates.split(",");
  const navs = rawNavs.split(",");
  if (dates.length !== navs.length) throw new Error("historical NAV series length mismatch");
  const rows = new Map<string, { date: string; nav: number }>();
  dates.forEach((rawDate, index) => {
    if (!/^\d{8}$/.test(rawDate)) return;
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`;
    const nav = Number(navs[index]);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
        !Number.isFinite(nav) || nav <= 0) return;
    rows.set(date, { date, nav });
  });
  if (!rows.size) throw new Error("historical NAV series invalid");
  const sorted = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  return limit > 0 ? sorted.slice(-limit) : sorted;
}

const comparisonStartDate = "1985-01-01";
const comparisonCache = new Map<string, { expiresAt: number; history: { date: string; nav: number }[] }>();
const comparisonPending = new Map<string, Promise<{ date: string; nav: number }[]>>();

async function ownsComparisonFund(request: Request, fundId: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const apikey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !apikey) throw new Error("authentication configuration unavailable");
  const headers = { Authorization: authorization, apikey };
  const auth = await fetch(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) });
  if (!auth.ok) return false;
  const user = await auth.json();
  if (!user.id) return false;
  const query = new URLSearchParams({
    select: "fund_id", user_id: `eq.${user.id}`, sell_date: "is.null",
    or: `(fund_id.eq.${fundId},fund_id.like.${fundId}-*)`, limit: "1",
  });
  const response = await fetch(`${url}/rest/v1/fund_purchases?${query}`, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("held funds unavailable");
  const rows = await response.json();
  return Array.isArray(rows) && rows.some((row) => String(row.fund_id).split("-", 1)[0] === fundId);
}

async function fetchComparisonHistory(fundId: string): Promise<{ date: string; nav: number }[]> {
  const cached = comparisonCache.get(fundId);
  if (cached && cached.expiresAt > Date.now()) return cached.history;
  const pending = comparisonPending.get(fundId);
  if (pending) return pending;
  const task = (async () => {
    const query = new URLSearchParams({
      a: fundId, b: "0", c: comparisonStartDate,
      d: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    });
    const response = await fetch(`https://fund.megabank.com.tw/w/bcd/tBCDNavList.djbcd?${query}`, {
      signal: AbortSignal.timeout(25000),
      headers: {
        "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0", "Accept": "text/plain,*/*",
        "Referer": `https://fund.megabank.com.tw/w/wr/wr02_${fundId}.djhtm`,
      },
    });
    if (!response.ok) throw new Error(`historical NAV ${response.status}`);
    const history = parseNavHistory(await response.text(), 0).filter((row) => row.date >= comparisonStartDate);
    if (history.length < 2) throw new Error("insufficient comparison history");
    comparisonCache.delete(fundId);
    comparisonCache.set(fundId, { history, expiresAt: Date.now() + 8 * 3600000 });
    while (comparisonCache.size > 32) comparisonCache.delete(comparisonCache.keys().next().value!);
    return history;
  })();
  comparisonPending.set(fundId, task);
  try {
    return await task;
  } finally {
    comparisonPending.delete(fundId);
  }
}

async function fetchNavHistory(fundId: string): Promise<{ date: string; nav: number }[]> {
  const response = await fetch(
    `https://fund.megabank.com.tw/w/bcd/tBCDNavList.djbcd?a=${encodeURIComponent(fundId)}&b=1&c=0&d=0`,
    { headers: {
      "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
      "Accept": "text/plain,*/*",
      "Referer": `https://fund.megabank.com.tw/w/wr/wr02_${fundId}.djhtm`,
    } },
  );
  if (!response.ok) throw new Error(`historical NAV ${response.status}`);
  return parseNavHistory(await response.text());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body.mode === "comparison") {
      const fundId = String(body.fundId || "");
      if (!/^[A-Z0-9]{4,12}$/.test(fundId) || !(await ownsComparisonFund(request, fundId))) {
        return new Response(JSON.stringify({ error: "only currently held funds may be compared" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const history = await fetchComparisonHistory(fundId);
      return new Response(JSON.stringify({
        fundId, history, requestedStartDate: comparisonStartDate, startDate: history[0].date,
        endDate: history.at(-1)!.date, updatedAt: new Date().toISOString(), source: "MoneyDJ",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
    }
    const fundIds = uniqueFundIds(body.fundIds);
    const items: NavItem[] = [];
    const errors: { fundId: string; error: string }[] = [];

    for (const fundId of fundIds) {
      try {
        const item = await fetchLatestNav(fundId);
        if (body.includeHistory === true) {
          try {
            item.history = await fetchNavHistory(fundId);
          } catch (error) {
            item.historyError = error instanceof Error ? error.message : String(error);
          }
        }
        items.push(item);
      } catch (error) {
        errors.push({ fundId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return new Response(JSON.stringify({ items, errors, updatedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
