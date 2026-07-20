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
        items.push(await fetchLatestNav(fundId));
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
