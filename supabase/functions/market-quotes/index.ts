const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;

type MarketDefinition = {
  id: string;
  label: string;
  symbol: string;
  urlSymbol: string;
};

type MarketQuote = {
  id: string;
  label: string;
  symbol: string;
  url: string;
  price: number;
  change: number;
  changePercent: number;
  quoteTime: string;
};

type MarketPayload = {
  source: string;
  updatedAt: string;
  markets: MarketQuote[];
  warnings?: string[];
};

const marketDefinitions: MarketDefinition[] = [
  { id: "twii", label: "台股大盤", symbol: "^TWII", urlSymbol: "%5ETWII" },
  { id: "txf", label: "台指期", symbol: "WTX&", urlSymbol: "WTX%26" },
  { id: "sp500", label: "S&P 500", symbol: "^GSPC", urlSymbol: "%5EGSPC" },
  { id: "sox", label: "費城半導體", symbol: "^SOX", urlSymbol: "%5ESOX" },
  { id: "nasdaq", label: "Nasdaq", symbol: "^IXIC", urlSymbol: "%5EIXIC" },
  { id: "nasdaqFuture", label: "Nasdaq 期貨", symbol: "NQ=F", urlSymbol: "NQ%3DF" },
  { id: "nikkei", label: "日股 Nikkei", symbol: "^N225", urlSymbol: "%5EN225" },
  { id: "kospi", label: "韓股 KOSPI", symbol: "^KS11", urlSymbol: "%5EKS11" },
];

let cachedPayload: MarketPayload | null = null;
let cacheExpiresAt = 0;
let refreshInFlight: Promise<MarketPayload> | null = null;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function databaseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function readDatabaseCache(): Promise<{ payload: MarketPayload; expiresAt: number } | null> {
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  const response = await fetch(
    `${supabaseUrl}/rest/v1/market_quote_cache?cache_key=eq.markets&select=payload,expires_at&limit=1`,
    { headers: databaseHeaders() },
  );
  if (!response.ok) {
    throw new Error(`market cache read ${response.status}`);
  }
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  const expiresAt = Date.parse(String(row?.expires_at || ""));
  if (!row?.payload || !Number.isFinite(expiresAt)) {
    return null;
  }
  return { payload: row.payload as MarketPayload, expiresAt };
}

async function writeDatabaseCache(payload: MarketPayload, expiresAt: number): Promise<void> {
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/market_quote_cache?on_conflict=cache_key`, {
    method: "POST",
    headers: databaseHeaders({
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      cache_key: "markets",
      payload,
      expires_at: new Date(expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`market cache write ${response.status}`);
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", "").replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractJsonObject(source: string, start: number): string | null {
  const objectStart = source.indexOf("{", start);
  if (objectStart < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }
  return null;
}

function parseYahooTaiwanQuote(definition: MarketDefinition, html: string): MarketQuote {
  const marker = '"quote":{"data":';
  const markerIndex = html.indexOf(marker);
  const jsonText = markerIndex >= 0 ? extractJsonObject(html, markerIndex + marker.length) : null;
  if (!jsonText) {
    throw new Error("quote data not found");
  }
  const quote = JSON.parse(jsonText);
  const price = finiteNumber(quote?.price?.raw);
  const change = finiteNumber(quote?.change?.raw);
  const changePercent = finiteNumber(quote?.changePercent);
  if (price === null || price <= 0 || change === null || changePercent === null) {
    throw new Error("quote fields incomplete");
  }
  return {
    id: definition.id,
    label: definition.label,
    symbol: definition.symbol,
    url: `https://tw.stock.yahoo.com/quote/${definition.urlSymbol}`,
    price: Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    quoteTime: String(quote?.regularMarketTime || ""),
  };
}

async function fetchMarketQuote(definition: MarketDefinition): Promise<MarketQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://tw.stock.yahoo.com/quote/${definition.urlSymbol}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://tw.stock.yahoo.com/",
      },
    });
    if (!response.ok) {
      throw new Error(`Yahoo Taiwan ${response.status}`);
    }
    return parseYahooTaiwanQuote(definition, await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshMarketPayload(): Promise<MarketPayload> {
  const results = await Promise.allSettled(marketDefinitions.map(fetchMarketQuote));
  const markets: MarketQuote[] = [];
  const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      markets.push(result.value);
    } else {
      warnings.push(`${marketDefinitions[index].id}: ${String(result.reason)}`);
    }
  });
  if (!markets.length) {
    throw new Error("no market quote source returned usable data");
  }
  const payload: MarketPayload = {
    source: "Yahoo Taiwan market data, 1 minute cache",
    updatedAt: new Date().toISOString(),
    markets,
  };
  if (warnings.length) {
    payload.warnings = warnings;
  }
  cachedPayload = payload;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  await writeDatabaseCache(payload, cacheExpiresAt);
  return payload;
}

async function marketPayload(): Promise<{ payload: MarketPayload; cache: "memory" | "database" | "miss" | "stale" }> {
  if (cachedPayload && Date.now() < cacheExpiresAt) {
    return { payload: cachedPayload, cache: "memory" };
  }
  let persistedCache: { payload: MarketPayload; expiresAt: number } | null = null;
  try {
    persistedCache = await readDatabaseCache();
    if (persistedCache && Date.now() < persistedCache.expiresAt) {
      cachedPayload = persistedCache.payload;
      cacheExpiresAt = persistedCache.expiresAt;
      return { payload: persistedCache.payload, cache: "database" };
    }
    refreshInFlight ||= refreshMarketPayload();
    return { payload: await refreshInFlight, cache: "miss" };
  } catch (error) {
    const stalePayload = persistedCache?.payload || cachedPayload;
    if (stalePayload) {
      return {
        payload: {
          ...stalePayload,
          warnings: [...(stalePayload.warnings || []), `refresh failed: ${String(error)}`],
        },
        cache: "stale",
      };
    }
    throw error;
  } finally {
    refreshInFlight = null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: responseHeaders,
    });
  }
  try {
    const result = await marketPayload();
    return new Response(JSON.stringify(result.payload), {
      headers: { ...responseHeaders, "X-Market-Cache": result.cache },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: responseHeaders,
    });
  }
});
