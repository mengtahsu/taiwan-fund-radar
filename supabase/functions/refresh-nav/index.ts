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

function parseNavHistory(text: string): { date: string; nav: number }[] {
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
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-190);
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
