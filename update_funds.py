#!/usr/bin/env python3
"""Fetch fund data and write the website data file.

Expected source format:

1. A JSON array of fund objects.
2. Or an object with a "funds" array plus optional "source" and "updatedAt".

Run once:
  python3 update_funds.py --config config/source.json --once

Run continuously with the interval configured in config/source.json:
  python3 update_funds.py --config config/source.json --watch
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import os
import re
import statistics
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REQUIRED_FIELDS = {
    "name",
    "company",
    "type",
    "region",
    "risk",
    "return3y",
    "fee",
    "volatility",
    "sharpe",
    "aum",
    "dividend",
    "minRsp",
    "tags",
}

DEFAULT_INTERVAL_SECONDS = 3 * 60 * 60
RECENT_RETURN_DAYS = 14
MONTH_RETURN_DAYS = 30
RECENT_NAV_WORKERS = 10
RECENT_NAV_TOP_LIMIT = 120
RECENT_NAV_REFRESH_LIMIT = 30
RECENT_NAV_ALWAYS_REFRESH_TOP = 20
RECENT_NAV_MAX_AGE_HOURS = 72
MONTHLY_NAV_REFRESH_LIMIT = 20
MONTHLY_NAV_MONTHS = 24
WEEKLY_NAV_WEEKS = 52
FUNDRICH_CACHE_MAX_AGE_HOURS = 24 * 7
FUNDRICH_REFRESH_PAGES = 20

TAIWAN_ETFS = [
    {
        "symbol": "0050.TW",
        "name": "元大台灣50 ETF",
        "company": "元大投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.43,
        "dividend": "配息",
        "tags": ["台灣50", "大型股", "市值型"],
    },
    {
        "symbol": "006208.TW",
        "name": "富邦台50 ETF",
        "company": "富邦投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.34,
        "dividend": "配息",
        "tags": ["台灣50", "大型股", "市值型"],
    },
    {
        "symbol": "0056.TW",
        "name": "元大高股息 ETF",
        "company": "元大投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.43,
        "dividend": "配息",
        "tags": ["高股息", "收益", "台股"],
    },
    {
        "symbol": "00878.TW",
        "name": "國泰永續高股息 ETF",
        "company": "國泰投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.40,
        "dividend": "配息",
        "tags": ["高股息", "ESG", "收益"],
    },
    {
        "symbol": "00919.TW",
        "name": "群益台灣精選高息 ETF",
        "company": "群益投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.40,
        "dividend": "配息",
        "tags": ["高股息", "收益", "台股"],
    },
    {
        "symbol": "00713.TW",
        "name": "元大台灣高息低波 ETF",
        "company": "元大投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.45,
        "dividend": "配息",
        "tags": ["高股息", "低波動", "收益"],
    },
    {
        "symbol": "00881.TW",
        "name": "國泰台灣5G+ ETF",
        "company": "國泰投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.40,
        "dividend": "配息",
        "tags": ["科技", "5G", "成長"],
    },
    {
        "symbol": "00692.TW",
        "name": "富邦公司治理 ETF",
        "company": "富邦投信",
        "type": "ETF",
        "region": "台灣",
        "fee": 0.35,
        "dividend": "配息",
        "tags": ["公司治理", "市值型", "台股"],
    },
    {
        "symbol": "00757.TW",
        "name": "統一FANG+ ETF",
        "company": "統一投信",
        "type": "ETF",
        "region": "美國",
        "fee": 0.75,
        "dividend": "累積型",
        "tags": ["科技", "美股", "成長"],
    },
    {
        "symbol": "00646.TW",
        "name": "元大S&P500 ETF",
        "company": "元大投信",
        "type": "ETF",
        "region": "美國",
        "fee": 0.50,
        "dividend": "配息",
        "tags": ["S&P500", "美股", "指數"],
    },
]

MEGABANK_BASE_URL = "https://fund.megabank.com.tw"
FUBON_FUND_SEARCH_URL = "https://www.fubon.com/Fubon_Portal/banking/Personal/fund_trust/fund_search/fund_search.jsp"
FUBON_FUND_SEARCH_REFERER = "https://www.fubon.com/banking/personal/fund_trust/fund_search/fund_search.htm"
FUBON_PLUS_BUY_URL = "https://ebankcld.taipeifubon.com.tw/start/FubonPlus?taskId=NMFTX001&fundCode={fund_code}"
FUNDRICH_FUND_TABLE_URL = "https://apis.fundrich.com.tw/FRSDataCenter/FundTableInfo"
FUNDRICH_DETAIL_URL = "https://www.fundrich.com.tw/fundCenter/fundOverview/fundContent/{fund_id}"
FUNDRICH_APP_BUY_URL = "fundrich://checkoutAppCart?funds=[{fund_id}]"
MONEYDJ_MOBILE_PLATFORM_URL = "https://m.moneydj.com/jsondata/selectordermobile.aspx"
MONEYDJ_FUND_BUY_URL = "https://m.moneydj.com/jsondata/funddj/fundjsondata.xdjjson?x=yp76008"
MONEYDJ_FUNDRICH_PLATFORM_ID = "FundRich"
SUPABASE_URL = "https://yobdglsovihychcfszbi.supabase.co"
SUPABASE_KEY = "sb_publishable_EeqYDx4CWa5l-DyPbz3I5g_PlSVCukK"
MONEYDJ_DOMESTIC_RETURN_URL = (
    "https://www.moneydj.com/funddj/ys/yp305002.djhtm?"
    "a=0&b=0&c=0~0&d=0&e=0~0&f=0~0&g=0~0&h=0~0&i=0~0&j=0~0&k=0~0"
    "&u=2000&v=&nn=&aa=&mm=&d1=&w1=&m1=&ytd=&rr=&rr2=&l=H&m=1"
)
MONEYDJ_DOMESTIC_RISK_URL = (
    "https://www.moneydj.com/funddj/ys/yp305002.djhtm?"
    "a=0&b=0&c=0~0&d=0&e=0~0&f=0~0&g=0~0&h=0~0&i=0~0&j=0~0&k=0~0"
    "&u=2000&v=&nn=&aa=&mm=&d1=&w1=&m1=&ytd=&rr=&rr2=&l=H&m=2"
)
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YAHOO_TW_QUOTE_URL = "https://tw.stock.yahoo.com/quote/{symbol}"

TXF_QUOTE_ITEM = {"id": "txf", "label": "台指期", "symbol": "WTX&", "urlSymbol": "WTX%26"}

MARKET_SYMBOLS = [
    {"id": "twii", "label": "台股大盤", "symbol": "^TWII", "benchmark": True, "urlSymbol": "%5ETWII"},
    {"id": "sp500", "label": "S&P 500", "symbol": "^GSPC", "benchmark": True, "urlSymbol": "%5EGSPC"},
    {"id": "nasdaq", "label": "Nasdaq", "symbol": "^IXIC", "benchmark": True, "urlSymbol": "%5EIXIC"},
    {"id": "nasdaqFuture", "label": "Nasdaq 期貨", "symbol": "NQ=F", "benchmark": False, "urlSymbol": "NQ%3DF"},
]


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"找不到設定檔: {path}")
    with path.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not config.get("sourceUrl"):
        raise ValueError("設定檔需要 sourceUrl")
    return config


def fetch_json(url: str) -> Any:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        raw = response.read().decode(charset)
    return json.loads(raw)


def fetch_text(url: str, encoding: str = "utf-8") -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": f"{MEGABANK_BASE_URL}/w/fund.htm",
        },
    )
    with urlopen(request, timeout=30) as response:
        raw = response.read()
    return raw.decode(encoding, "replace")


def post_fubon_fund_search() -> str:
    fields = {
        "pageSwitch": "2",
        "radioButtonSelect": "0",
        "sortSelectOption": "3",
        "searchKeyword": "",
    }
    for name in [
        "checkbox2",
        "checkbox1",
        "checkbox3",
        "checkbox4",
        "checkbox5",
        "checkbox2_mo",
        "checkbox1_mo",
        "checkbox3_mo",
        "checkbox4_mo",
        "checkbox5_mo",
    ]:
        fields[name] = "false"
    for index in range(11):
        fields[f"selectBox{index}"] = "0"

    body = urlencode(fields).encode("utf-8")
    request = Request(
        FUBON_FUND_SEARCH_URL,
        data=body,
        headers={
            "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
            "Accept": "application/xml,text/xml,*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Referer": FUBON_FUND_SEARCH_REFERER,
            "Origin": "https://www.fubon.com",
        },
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, "replace")


def post_json(url: str, payload: dict[str, Any], referer: str) -> Any:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
            "Accept": "application/json,text/plain,*/*",
            "Content-Type": "application/json",
            "Origin": "https://www.fundrich.com.tw",
            "Referer": referer,
        },
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset, "replace"))


def post_json_with_headers(url: str, payload: dict[str, Any], headers: dict[str, str]) -> Any:
    body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset, "replace"))


def fetch_yahoo_chart(symbol: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=365 * 3 + 14)
    query = urlencode(
        {
            "period1": int(start.timestamp()),
            "period2": int(now.timestamp()),
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{query}"
    return fetch_json(url)


def fetch_yahoo_chart_range(symbol: str, days: int = 120) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    query = urlencode(
        {
            "period1": int(start.timestamp()),
            "period2": int(now.timestamp()),
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        }
    )
    url = YAHOO_CHART_URL.format(symbol=symbol) + f"?{query}"
    return fetch_json(url)


def fetch_moneydj_bcd_nav(fund_id: str) -> list[tuple[datetime, float]]:
    fund_key = fund_id.split("-", 1)[0]
    query = urlencode(
        {
            "a": fund_key,
            "b": 1,
            "c": "0",
            "d": "0",
        }
    )
    url = f"{MEGABANK_BASE_URL}/w/bcd/tBCDNavList.djbcd?{query}"
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 TaiwanFundRadar/1.0",
            "Accept": "text/plain,*/*",
            "Referer": f"{MEGABANK_BASE_URL}/w/wr/wr02_{fund_id}.djhtm",
        },
    )
    with urlopen(request, timeout=20) as response:
        text = response.read().decode("big5", "replace")
    text = text.split("<!--", 1)[0].strip()
    parts = text.split()
    if len(parts) < 2:
        return []

    dates = parts[0].split(",")
    prices = parts[1].split(",")
    series: list[tuple[datetime, float]] = []
    for raw_date, raw_price in zip(dates, prices):
        try:
            date = datetime.strptime(raw_date, "%Y%m%d")
            price = float(raw_price)
        except ValueError:
            continue
        if price > 0:
            series.append((date, price))
    return series


def period_return_from_series(series: list[tuple[datetime, float]], days: int) -> tuple[float, str, str] | None:
    if len(series) < 2:
        return None
    series = sorted(series, key=lambda item: item[0])
    end_date, end_price = series[-1]
    target_date = end_date - timedelta(days=days)
    start_date, start_price = series[0]
    for date, price in series:
        if date <= target_date:
            start_date, start_price = date, price
        else:
            break
    if start_price <= 0 or start_date == end_date:
        return None
    period_return = ((end_price / start_price) - 1) * 100
    return round(period_return, 2), start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d")


def month_end_navs_from_series(series: list[tuple[datetime, float]], months: int) -> list[dict[str, Any]]:
    if not series:
        return []
    cutoff = datetime.now() - timedelta(days=max(1, months) * 31)
    month_rows: dict[str, tuple[datetime, float]] = {}
    for date, nav in sorted(series, key=lambda item: item[0]):
        if date < cutoff:
            continue
        month_key = date.strftime("%Y-%m")
        current = month_rows.get(month_key)
        if current is None or date >= current[0]:
            month_rows[month_key] = (date, nav)
    return [
        {
            "month": month,
            "date": date.strftime("%Y-%m-%d"),
            "nav": round(nav, 4),
        }
        for month, (date, nav) in sorted(month_rows.items())
    ]


def week_end_navs_from_series(series: list[tuple[datetime, float]], weeks: int) -> list[dict[str, Any]]:
    if not series:
        return []
    cutoff = datetime.now() - timedelta(days=max(1, weeks) * 7)
    week_rows: dict[str, tuple[datetime, float]] = {}
    for date, nav in sorted(series, key=lambda item: item[0]):
        if date < cutoff:
            continue
        year, week, _weekday = date.isocalendar()
        week_key = f"{year}-W{week:02d}"
        current = week_rows.get(week_key)
        if current is None or date >= current[0]:
            week_rows[week_key] = (date, nav)
    return [
        {
            "week": week,
            "date": date.strftime("%Y-%m-%d"),
            "nav": round(nav, 4),
        }
        for week, (date, nav) in sorted(week_rows.items())
    ]


def chart_prices(data: dict[str, Any]) -> list[float]:
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        return []
    quote = ((result[0].get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    return clean_series(closes)


def total_return(prices: list[float]) -> float | None:
    if len(prices) < 2:
        return None
    return ((prices[-1] / prices[0]) - 1) * 100


def quote_from_chart(item: dict[str, Any], data: dict[str, Any]) -> dict[str, Any] | None:
    result = (data.get("chart") or {}).get("result") or []
    meta = result[0].get("meta") if result else {}
    prices = chart_prices(data)
    if len(prices) < 2:
        return None
    latest = optional_number((meta or {}).get("regularMarketPrice")) or prices[-1]
    previous = (
        optional_number((meta or {}).get("chartPreviousClose"))
        or optional_number((meta or {}).get("previousClose"))
        or prices[-2]
    )
    change = latest - previous
    change_percent = (change / previous) * 100 if previous else 0.0
    return {
        "id": item["id"],
        "label": item["label"],
        "symbol": item["symbol"],
        "url": YAHOO_TW_QUOTE_URL.format(symbol=item["urlSymbol"]),
        "price": round(latest, 2),
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "return2w": round(total_return(prices[-11:]) or 0.0, 2),
        "return1m": round(total_return(prices[-23:]) or 0.0, 2),
        "return3m": round(total_return(prices) or 0.0, 2),
    }


def fetch_yahoo_direct_quote(item: dict[str, Any]) -> dict[str, Any]:
    page = fetch_text(YAHOO_TW_QUOTE_URL.format(symbol=item["urlSymbol"]))
    marker = '"quote":{"data":'
    start = page.find(marker)
    if start < 0:
        raise RuntimeError("Yahoo Taiwan quote data not found")
    quote, _ = json.JSONDecoder().raw_decode(page[start + len(marker):])
    price = optional_number(((quote.get("price") or {}).get("raw")))
    change = optional_number(((quote.get("change") or {}).get("raw")))
    change_percent = optional_number(str(quote.get("changePercent") or "").replace("%", ""))
    if price is None or change is None or change_percent is None:
        raise RuntimeError("Yahoo Taiwan quote fields incomplete")
    return {
        "price": round(price, 2),
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "quoteTime": str(quote.get("regularMarketTime") or ""),
    }


def fetch_txf_quote() -> dict[str, Any]:
    quote = fetch_yahoo_direct_quote(TXF_QUOTE_ITEM)
    return {
        "id": "txf",
        "label": "台指期",
        "symbol": TXF_QUOTE_ITEM["symbol"],
        "url": YAHOO_TW_QUOTE_URL.format(symbol=TXF_QUOTE_ITEM["urlSymbol"]),
        "name": "台指期近一",
        **quote,
    }


def build_markets_payload() -> dict[str, Any]:
    markets: list[dict[str, Any]] = []
    benchmarks: dict[str, Any] = {}
    warnings: list[str] = []

    try:
        txf_quote = fetch_txf_quote()
        if txf_quote:
            markets.append(txf_quote)
    except Exception as exc:
        warnings.append(f"Yahoo TXF failed: {exc}")

    for item in MARKET_SYMBOLS:
        try:
            chart = fetch_yahoo_chart_range(item["symbol"], days=120)
            quote = quote_from_chart(item, chart)
            if not quote:
                raise RuntimeError("no usable chart prices")
            quote.update(fetch_yahoo_direct_quote(item))
            markets.append(quote)
            if item.get("benchmark"):
                benchmarks[item["id"]] = {
                    "label": item["label"],
                    "return2w": quote["return2w"],
                    "return1m": quote["return1m"],
                    "return3m": quote["return3m"],
                }
        except Exception as exc:
            warnings.append(f"Yahoo {item['symbol']} failed: {exc}")

    if not markets:
        raise RuntimeError("No market quote source returned usable data")

    payload = {
        "source": "Yahoo Taiwan market data",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "markets": markets,
        "benchmarks": benchmarks,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload


def fetch_yuanta_api(func_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params = {
        "APIType": "EC2API",
        "AppName": "FundWeb",
        "PageName": "WELCOME",
        "Device": "4",
        "DeviceId": str(uuid.uuid4()),
        "FuncId": func_id,
        "OSVersion": "1",
        "AppVersion": "3.0.1",
        "LogTime": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
    }
    if extra:
        params.update(extra)
    url = f"https://api.yuantafunds.com/ectranslation/api/trans?{urlencode(params)}"
    return fetch_json(url)


def clean_series(values: list[Any]) -> list[float]:
    return [float(value) for value in values if value is not None and float(value) > 0]


def annualized_return(prices: list[float]) -> float:
    if len(prices) < 2:
        return 0.0
    years = max((len(prices) - 1) / 252, 1 / 252)
    return ((prices[-1] / prices[0]) ** (1 / years) - 1) * 100


def annualized_volatility(prices: list[float]) -> float:
    if len(prices) < 3:
        return 0.0
    returns = [(prices[index] / prices[index - 1]) - 1 for index in range(1, len(prices))]
    if len(returns) < 2:
        return 0.0
    return statistics.stdev(returns) * (252 ** 0.5) * 100


def sharpe_like(return3y: float, volatility: float) -> float:
    if volatility <= 0:
        return 0.0
    return return3y / volatility


def risk_from_volatility(volatility: float) -> int:
    if volatility < 8:
        return 2
    if volatility < 14:
        return 3
    if volatility < 22:
        return 4
    return 5


def parse_rr(value: Any, fallback: int = 4) -> int:
    text = str(value or "")
    digits = "".join(char for char in text if char.isdigit())
    if not digits:
        return fallback
    return max(1, min(5, int(digits[-1])))


def map_yuanta_type(item: dict[str, Any]) -> str:
    inv_type = str(item.get("INV_TYPE") or item.get("LFUND_TYPE_DESCRP") or "")
    name = str(item.get("FUND_SH_NM") or "")
    if "ETF連結" in inv_type or "ETF連結" in name:
        return "ETF連結"
    if item.get("STK_CD"):
        return "ETF"
    if "債" in inv_type:
        return "債券"
    if "多重資產" in inv_type or "平衡" in inv_type:
        return "平衡"
    if "國內" in inv_type or "台灣" in name:
        return "台股"
    if "股票" in inv_type:
        return "全球股票"
    return "基金"


def map_yuanta_region(item: dict[str, Any]) -> str:
    inv_type = str(item.get("INV_TYPE") or item.get("LFUND_TYPE_DESCRP") or "")
    name = str(item.get("FUND_SH_NM") or "")
    if "國內" in inv_type or "台灣" in name:
        return "台灣"
    if "美" in inv_type or "S&P" in name or "NASDAQ" in name or "FANG" in name:
        return "美國"
    if "亞洲" in inv_type or "亞洲" in name or "日本" in name or "印尼" in name or "中國" in name:
        return "亞洲"
    return "全球"


def normalize_yuanta_fund(item: dict[str, Any]) -> dict[str, Any] | None:
    name = str(item.get("FUND_SH_NM") or "").strip()
    if not name or item.get("SHOW_PERFORMANCE") == "N":
        return None

    nav = number(item.get("NAV") or 0, "NAV")
    return3y = number(item.get("Y3_RATE") or 0, "Y3_RATE")
    return1y = number(item.get("Y1_RATE") or 0, "Y1_RATE")
    risk = parse_rr(item.get("RISK_CLASS") or item.get("RISK_LEVEL"), fallback=4)
    volatility = {1: 3.0, 2: 6.0, 3: 11.0, 4: 17.0, 5: 25.0}.get(risk, 17.0)
    return3y_annualized = ((1 + return3y / 100) ** (1 / 3) - 1) * 100 if return3y > -100 else return3y

    tags = [
        str(item.get("INV_TYPE") or item.get("LFUND_TYPE_SH_NAME") or "基金"),
        str(item.get("RISK_CLASS") or f"RR{risk}"),
        str(item.get("CRNCY_NM") or ""),
    ]
    if item.get("STK_CD"):
        tags.append(str(item["STK_CD"]))
    tags = [tag for tag in tags if tag]

    return {
        "fundId": str(item.get("FUND_ID") or ""),
        "ticker": str(item.get("STK_CD") or ""),
        "name": name,
        "company": "元大投信",
        "type": map_yuanta_type(item),
        "region": map_yuanta_region(item),
        "risk": risk,
        "return3y": round(return3y_annualized, 2),
        "return3yCumulative": round(return3y, 2),
        "return1y": round(return1y, 2),
        "fee": 0.0,
        "volatility": volatility,
        "sharpe": round(sharpe_like(return3y_annualized, volatility), 2),
        "aum": round(number(item.get("FUND_SIZE") or 0, "FUND_SIZE") / 100000000, 2),
        "nav": nav,
        "navDate": str(item.get("NAV_DATE") or ""),
        "price": nav,
        "dividend": str(item.get("CYCLE_TYPE") or "累積型"),
        "minRsp": int(number(item.get("RSP_ALLOT_MIN_AMT") or item.get("EC_ALLOT_MIN_AMT") or 1000, "minRsp")),
        "tags": tags,
    }


def build_yuanta_funds_payload() -> dict[str, Any]:
    payload = fetch_yuanta_api("FundList")
    if payload.get("ResultCode") != 0:
        raise RuntimeError(f"Yuanta FundList failed: {payload.get('ResultMsg')}")

    data = payload.get("Data") or {}
    raw_funds = data.get("FUND") or []
    funds = [fund for fund in (normalize_yuanta_fund(item) for item in raw_funds) if fund]
    if not funds:
        raise RuntimeError("Yuanta FundList returned no usable funds")

    return {
        "source": "Yuanta Funds FundList API",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }


def strip_html(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def optional_number(value: Any) -> float | None:
    text = str(value or "").replace(",", "").strip()
    if text in {"", "-", "--", "N/A"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_megabank_companies() -> list[tuple[str, str]]:
    text = fetch_text(f"{MEGABANK_BASE_URL}/w/js/wvipaspfundUTF8.djjs", "utf-8-sig")
    match = re.search(r"var\s+gsSector\s*=\s*'([^']*)'", text)
    if not match:
        raise RuntimeError("MegaBank/MoneyDJ company list not found")

    companies = []
    for part in match.group(1).split(";"):
        fields = part.split(",")
        if len(fields) >= 3 and fields[0] == "A":
            companies.append((fields[1], fields[2]))
    if not companies:
        raise RuntimeError("MegaBank/MoneyDJ returned no domestic fund companies")
    return companies


def parse_megabank_rows(url: str) -> dict[str, list[str]]:
    text = fetch_text(url, "big5")
    rows: dict[str, list[str]] = {}
    for row_html in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", text, flags=re.IGNORECASE):
        match = re.search(
            r'href="/w/wr/wr01_([^"]+)\.djhtm"[^>]*>(.*?)</a>',
            row_html,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not match:
            continue

        cells = re.findall(r"<td[^>]*>([\s\S]*?)</td>", row_html, flags=re.IGNORECASE)
        values = [strip_html(cell) for cell in cells]
        if values:
            rows[match.group(1)] = values
    return rows


def moneydj_table_rows(url: str) -> dict[str, list[str]]:
    text = fetch_text(url, "big5")
    table_match = re.search(
        r'<table[^>]+id=["\']oMainTable["\'][\s\S]*?<tbody>([\s\S]*?)</tbody>',
        text,
        flags=re.IGNORECASE,
    )
    if not table_match:
        raise RuntimeError(f"MoneyDJ table not found: {url}")

    rows: dict[str, list[str]] = {}
    for row_html in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", table_match.group(1), flags=re.IGNORECASE):
        match = re.search(r"yp010000\.djhtm\?a=([^\"'&>]+)", row_html, flags=re.IGNORECASE)
        if not match:
            continue
        cells = re.findall(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", row_html, flags=re.IGNORECASE)
        values = [strip_html(cell) for cell in cells]
        if values:
            rows[match.group(1).strip().upper()] = values
    return rows


def clean_megabank_name(value: str) -> tuple[str, str]:
    match = re.match(r"^([A-Z0-9]+)\s+(.+)$", value.strip(), flags=re.IGNORECASE)
    if not match:
        return "", value.strip()
    return match.group(1), match.group(2).strip()


def is_twd_currency(value: str | None) -> bool:
    text = (value or "").strip().upper()
    if not text:
        return False
    return any(keyword in text for keyword in ["台幣", "新台幣", "新臺幣", "TWD", "NTD"])


def canonical_fund_name(value: str) -> str:
    text = html.unescape(value)
    text = re.sub(r"[\(（][^()（）]*(?:本金|配息來源|收益平準金|保證收益)[^()（）]*[\)）]", "", text)
    text = re.sub(r"[\(（]\s*([A-Z]{1,3})\s*[\)）]", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"[\(（]([^（）()]{1,12})[\)）]", r"\1", text)
    replacements = [
        "證券投資信託基金",
        "投資信託基金",
        "基金",
        "股份有限公司",
        "證券投資信託",
        "投信",
        "新台幣",
        "新臺幣",
        "台幣",
        "臺幣",
        "類型",
        "級別",
        "累積型",
        "配息型",
        "不配息",
        "配息",
    ]
    for replacement in replacements:
        text = text.replace(replacement, "")
    return re.sub(r"[\s　\-_－—/／、:：\.．]+", "", text).lower()


def fund_class_tokens(value: str) -> set[str]:
    text = html.unescape(value or "")
    text = re.sub(r"[\(（][^()（）]*(?:本金|配息來源|收益平準金|保證收益)[^()（）]*[\)）]", "", text)
    tokens = set()
    patterns = [
        r"[\(（]\s*([A-Z]{1,3})\s*[\)）]",
        r"基金\s*([A-Z]{1,3})(?=(?:不配息|配息|月配|季配|累積|後收|類型|級別|$))",
        r"([A-Z]{1,3})(?=類型|級別)",
    ]
    for pattern in patterns:
        tokens.update(match.lower() for match in re.findall(pattern, text, flags=re.IGNORECASE))
    return tokens


def channel_item_name(item: dict[str, Any]) -> str:
    return str(item.get("fundrichName") or item.get("name") or "")


def distribution_tokens(value: str) -> set[str]:
    text = html.unescape(value or "")
    text = re.sub(r"[\(（][^()（）]*(?:本金|配息來源|收益平準金|保證收益)[^()（）]*[\)）]", "", text)
    tokens = set()
    is_accumulating = any(keyword in text for keyword in ["不配息", "累積", "累積型"])
    if is_accumulating:
        tokens.add("acc")
    if any(keyword in text for keyword in ["月配", "月配息"]):
        tokens.add("monthly")
    elif any(keyword in text for keyword in ["季配", "季配息"]):
        tokens.add("quarterly")
    elif any(keyword in text for keyword in ["年配", "年配息"]):
        tokens.add("yearly")
    elif "配息" in text and not is_accumulating:
        tokens.add("distribution")
    return tokens


def fund_classes_compatible(source_name: str, candidate_name: str) -> bool:
    source_tokens = fund_class_tokens(source_name)
    candidate_tokens = fund_class_tokens(candidate_name)
    if source_tokens and not candidate_tokens:
        return False
    if source_tokens and candidate_tokens and source_tokens.isdisjoint(candidate_tokens):
        return False
    return True


def fund_distribution_compatible(source_name: str, candidate_name: str) -> bool:
    source_tokens = distribution_tokens(source_name)
    candidate_tokens = distribution_tokens(candidate_name)
    if source_tokens and not candidate_tokens:
        return False
    if source_tokens and candidate_tokens and source_tokens.isdisjoint(candidate_tokens):
        return False
    return True


def channel_match_compatible(source_name: str, item: dict[str, Any]) -> bool:
    candidate_name = channel_item_name(item)
    return fund_classes_compatible(source_name, candidate_name) and fund_distribution_compatible(source_name, candidate_name)


def find_channel_match(name: str, channel_items: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    key = canonical_fund_name(name)
    if not key:
        return None
    if key in channel_items and channel_match_compatible(name, channel_items[key]):
        return channel_items[key]
    for candidate_key, item in channel_items.items():
        if len(key) >= 5 and (key in candidate_key or candidate_key in key) and channel_match_compatible(name, item):
            return item
    return None


def map_megabank_type(fund_type: str, name: str) -> str:
    text = f"{fund_type} {name}"
    if "貨幣" in text:
        return "貨幣"
    if "ETF連結" in text:
        return "ETF連結"
    if "ETF" in text or "指數型" in text:
        return "ETF"
    if "債" in text:
        return "債券"
    if "平衡" in text or "多重資產" in text:
        return "平衡"
    if "國內股票" in text or "台灣" in text:
        return "台股"
    if "股票" in text:
        return "全球股票"
    return "基金"


def map_megabank_region(fund_type: str, name: str) -> str:
    text = f"{fund_type} {name}"
    if "國內" in fund_type or "台灣" in text:
        return "台灣"
    if any(keyword in text for keyword in ["美國", "NASDAQ", "那斯達克", "S&P", "費城半導體"]):
        return "美國"
    if any(keyword in text for keyword in ["亞洲", "中國", "大中華", "日本", "印度", "越南", "東協", "印尼"]):
        return "亞洲"
    return "全球"


def normalize_moneydj_domestic_fund(
    fund_code: str,
    return_row: list[str],
    risk_row: list[str] | None,
) -> dict[str, Any] | None:
    if len(return_row) < 15:
        return None

    name = return_row[1].strip()
    company = return_row[2].strip() if len(return_row) > 2 else ""
    fund_type = return_row[3].strip() if len(return_row) > 3 else "基金"
    if not name or not company:
        return None

    currency = risk_row[4] if risk_row and len(risk_row) > 4 else ""
    if not is_twd_currency(currency or name):
        return None

    year_to_date = optional_number(return_row[6])
    one_month = optional_number(return_row[7])
    three_month = optional_number(return_row[8])
    six_month = optional_number(return_row[9])
    one_year = optional_number(return_row[10])
    three_year = optional_number(return_row[11])
    five_year = optional_number(return_row[12])

    risk_type = risk_row[2] if risk_row and len(risk_row) > 2 else fund_type
    aum = optional_number(risk_row[6]) if risk_row and len(risk_row) > 6 else None
    volatility = optional_number(risk_row[7]) if risk_row and len(risk_row) > 7 else None
    sharpe = optional_number(risk_row[8]) if risk_row and len(risk_row) > 8 else None
    risk = parse_rr(risk_row[10] if risk_row and len(risk_row) > 10 else "", fallback=4)

    return3y_annualized = 0.0
    if three_year is not None and three_year > -100:
        return3y_annualized = ((1 + three_year / 100) ** (1 / 3) - 1) * 100

    if volatility is None:
        volatility = {1: 3.0, 2: 6.0, 3: 11.0, 4: 17.0, 5: 25.0}.get(risk, 17.0)
    if sharpe is None:
        sharpe = sharpe_like(return3y_annualized, volatility)

    tags = [risk_type or fund_type, "台幣", f"RR{risk}"]
    if three_month is not None:
        tags.append(f"3月 {three_month:.2f}%")
    if one_year is not None:
        tags.append(f"1年 {one_year:.2f}%")

    return {
        "fundId": fund_code,
        "ticker": fund_code,
        "name": name,
        "company": company,
        "currency": "台幣",
        "type": map_megabank_type(risk_type or fund_type, name),
        "region": map_megabank_region(risk_type or fund_type, name),
        "risk": risk,
        "return3y": round(return3y_annualized, 2),
        "return3yCumulative": round(three_year or 0.0, 2),
        "return3m": round(three_month or 0.0, 2),
        "return1y": round(one_year or 0.0, 2),
        "return6m": round(six_month or 0.0, 2),
        "returnYtd": round(year_to_date or 0.0, 2),
        "return5y": round(five_year or 0.0, 2),
        "fee": 0.0,
        "feeUnavailable": True,
        "volatility": round(volatility, 2),
        "sharpe": round(sharpe, 2),
        "aum": round(aum or 0.0, 2),
        "nav": round(optional_number(risk_row[3]) or 0.0, 4) if risk_row and len(risk_row) > 3 else None,
        "navDate": return_row[0],
        "dividend": "配息" if any(keyword in name for keyword in ["配息", "月配", "季配", "年配"]) else "累積型",
        "minRsp": 1000,
        "tags": tags,
        "moneyDjUrl": f"https://m.moneydj.com/a1.aspx?a={fund_code}",
    }


def normalize_megabank_fund(
    fund_code: str,
    company: str,
    return_row: list[str],
    risk_row: list[str] | None,
) -> dict[str, Any] | None:
    if len(return_row) < 9:
        return None

    bank_code, name = clean_megabank_name(return_row[0])
    if not name:
        return None

    currency = return_row[1]
    if not is_twd_currency(currency):
        return None

    three_month = optional_number(return_row[2])
    six_month = optional_number(return_row[3])
    one_year = optional_number(return_row[4])
    two_year = optional_number(return_row[5])
    three_year = optional_number(return_row[6])
    five_year = optional_number(return_row[7])
    year_to_date = optional_number(return_row[8])

    fund_type = risk_row[1] if risk_row and len(risk_row) > 1 else "基金"
    volatility = optional_number(risk_row[3]) if risk_row and len(risk_row) > 3 else None
    sharpe = optional_number(risk_row[4]) if risk_row and len(risk_row) > 4 else None
    aum = optional_number(risk_row[6]) if risk_row and len(risk_row) > 6 else None
    risk = parse_rr(risk_row[7] if risk_row and len(risk_row) > 7 else "", fallback=4)

    return3y_annualized = 0.0
    if three_year is not None and three_year > -100:
        return3y_annualized = ((1 + three_year / 100) ** (1 / 3) - 1) * 100

    if volatility is None:
        volatility = {1: 3.0, 2: 6.0, 3: 11.0, 4: 17.0, 5: 25.0}.get(risk, 17.0)
    if sharpe is None:
        sharpe = sharpe_like(return3y_annualized, volatility)

    tags = [fund_type, currency, f"RR{risk}"]
    if three_month is not None:
        tags.append(f"3月 {three_month:.2f}%")
    if one_year is not None:
        tags.append(f"1年 {one_year:.2f}%")

    return {
        "fundId": fund_code,
        "ticker": bank_code,
        "name": name,
        "company": company,
        "currency": "台幣",
        "type": map_megabank_type(fund_type, name),
        "region": map_megabank_region(fund_type, name),
        "risk": risk,
        "return3y": round(return3y_annualized, 2),
        "return3yCumulative": round(three_year or 0.0, 2),
        "return3m": round(three_month or 0.0, 2),
        "return1y": round(one_year or 0.0, 2),
        "return6m": round(six_month or 0.0, 2),
        "returnYtd": round(year_to_date or 0.0, 2),
        "fee": 0.0,
        "feeUnavailable": True,
        "volatility": round(volatility, 2),
        "sharpe": round(sharpe, 2),
        "aum": round(aum or 0.0, 2),
        "dividend": "配息" if any(keyword in name for keyword in ["配息", "月配", "季配", "年配"]) else "累積型",
        "minRsp": 1000,
        "tags": tags,
        "moneyDjUrl": f"{MEGABANK_BASE_URL}/w/wr/wr01_{fund_code}.djhtm",
    }


def build_megabank_tw_funds_payload() -> dict[str, Any]:
    funds = []
    warnings = []
    for company_code, company_name in parse_megabank_companies():
        try:
            return_rows = parse_megabank_rows(f"{MEGABANK_BASE_URL}/w/wq/wq01.djhtm?a={company_code}")
            risk_rows = parse_megabank_rows(f"{MEGABANK_BASE_URL}/w/wq/wq03.djhtm?a={company_code}")
            for fund_code, return_row in return_rows.items():
                fund = normalize_megabank_fund(fund_code, company_name, return_row, risk_rows.get(fund_code))
                if fund:
                    funds.append(fund)
        except Exception as exc:
            warnings.append(f"{company_name}({company_code}): {exc}")

    if not funds:
        raise RuntimeError("MegaBank/MoneyDJ returned no usable Taiwan domestic funds")

    enrich_recent_fund_returns(funds)
    funds.sort(key=lambda fund: fund["return3y"], reverse=True)
    payload: dict[str, Any] = {
        "source": "兆豐基金/MoneyDJ 國內基金公開資料",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload


def build_moneydj_tw_funds_payload() -> dict[str, Any]:
    return_rows = moneydj_table_rows(MONEYDJ_DOMESTIC_RETURN_URL)
    risk_rows = moneydj_table_rows(MONEYDJ_DOMESTIC_RISK_URL)
    funds = [
        fund
        for fund in (
            normalize_moneydj_domestic_fund(fund_code, return_row, risk_rows.get(fund_code))
            for fund_code, return_row in return_rows.items()
        )
        if fund
    ]

    if not funds:
        raise RuntimeError("MoneyDJ domestic fund tables returned no usable TWD funds")

    enrich_recent_fund_returns(funds)
    funds.sort(key=lambda fund: fund["return3y"], reverse=True)
    return {
        "source": "MoneyDJ 國內基金進階搜尋公開資料",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }


def parse_iso_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.fromtimestamp(0, timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.fromtimestamp(0, timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def load_nav_cache(root: Path) -> dict[str, Any]:
    cache_path = root / "data/nav_cache.json"
    items: dict[str, Any] = {}
    next_top_offset = 0
    if cache_path.exists():
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(payload.get("items"), dict):
                items.update(payload["items"])
            next_top_offset = int(payload.get("nextTopOffset") or 0)
        except (OSError, json.JSONDecodeError):
            pass

    funds_path = root / "data/funds.json"
    if funds_path.exists():
        try:
            payload = json.loads(funds_path.read_text(encoding="utf-8"))
            for fund in payload.get("funds", []):
                fund_id = str(fund.get("fundId") or "")
                if not fund_id or fund_id in items or fund.get("return2w") is None:
                    continue
                items[fund_id] = {
                    "return2w": fund["return2w"],
                    "return2wStartDate": fund.get("return2wStartDate"),
                    "return2wEndDate": fund.get("return2wEndDate"),
                    "return1m": fund.get("return1m"),
                    "return1mStartDate": fund.get("return1mStartDate"),
                    "return1mEndDate": fund.get("return1mEndDate"),
                    "fetchedAt": payload.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
                }
        except (OSError, json.JSONDecodeError):
            pass

    return {"updatedAt": datetime.now(timezone.utc).isoformat(), "items": items, "nextTopOffset": max(0, next_top_offset)}


def apply_nav_cache(funds: list[dict[str, Any]], cache: dict[str, Any]) -> None:
    items = cache.get("items") or {}
    max_age_hours = float(os.environ.get("RECENT_NAV_MAX_AGE_HOURS", RECENT_NAV_MAX_AGE_HOURS))
    fresh_after = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)

    def cached_for_fund(fund_id: str) -> dict[str, Any] | None:
        cached = items.get(fund_id)
        if cached:
            return cached
        prefix = f"{fund_id}-"
        candidates = [
            item
            for key, item in items.items()
            if isinstance(key, str) and key.startswith(prefix) and isinstance(item, dict)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda item: parse_iso_datetime(item.get("fetchedAt")))

    for fund in funds:
        cached = cached_for_fund(str(fund.get("fundId") or ""))
        if not cached or cached.get("return2w") is None:
            continue
        if parse_iso_datetime(cached.get("fetchedAt")) < fresh_after:
            continue
        fund["return2w"] = cached["return2w"]
        if cached.get("return2wStartDate"):
            fund["return2wStartDate"] = cached["return2wStartDate"]
        if cached.get("return2wEndDate"):
            fund["return2wEndDate"] = cached["return2wEndDate"]
        if cached.get("return1m") is not None:
            fund["return1m"] = cached["return1m"]
        if cached.get("return1mStartDate"):
            fund["return1mStartDate"] = cached["return1mStartDate"]
        if cached.get("return1mEndDate"):
            fund["return1mEndDate"] = cached["return1mEndDate"]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def load_taiwan_benchmark_returns(root: Path) -> dict[str, float]:
    markets_path = root / "data/markets.json"
    if not markets_path.exists():
        return {}
    try:
        payload = json.loads(markets_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    for market in payload.get("markets", []):
        if market.get("id") == "twii":
            return {
                "return2w": number(market.get("return2w", 0), "twii.return2w"),
                "return1m": number(market.get("return1m", 0), "twii.return1m"),
            }
    return {}


def growth_score_for_nav_refresh(fund: dict[str, Any], benchmark: dict[str, float]) -> int:
    return_3m_score = clamp(number(fund.get("return3m", 0), "return3m") / 60, 0, 1)
    if fund.get("return2w") is None or benchmark.get("return2w") is None:
        excess_2w_score = 0.45
    else:
        excess_2w_score = clamp((number(fund["return2w"], "return2w") - benchmark["return2w"] + 10) / 25, 0, 1)
    if fund.get("return1m") is None or benchmark.get("return1m") is None:
        excess_1m_score = 0.45
    else:
        excess_1m_score = clamp((number(fund["return1m"], "return1m") - benchmark["return1m"] + 12) / 30, 0, 1)
    momentum_score = return_3m_score * 0.45 + excess_2w_score * 0.3 + excess_1m_score * 0.25
    return_score = clamp(number(fund.get("return3y", 0), "return3y") / 80, 0, 1)
    sharpe_score = clamp(number(fund.get("sharpe", 0), "sharpe") / 2, 0, 1)
    risk_fit = 1 - max(0, int(number(fund.get("risk", 5), "risk")) - 5) / 4
    score = return_score * 0.25 + momentum_score * 0.45 + sharpe_score * 0.2 + risk_fit * 0.1
    return round(score * 100)


def is_buyable_default_fund(fund: dict[str, Any]) -> bool:
    return str(fund.get("type") or "") != "ETF"


def nav_refresh_candidates(funds: list[dict[str, Any]], cache: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    root = Path(__file__).resolve().parent
    benchmark = load_taiwan_benchmark_returns(root)
    top_limit = int(os.environ.get("RECENT_NAV_TOP_LIMIT", RECENT_NAV_TOP_LIMIT))
    always_refresh_top = int(os.environ.get("RECENT_NAV_ALWAYS_REFRESH_TOP", RECENT_NAV_ALWAYS_REFRESH_TOP))
    default_funds = [fund for fund in funds if is_buyable_default_fund(fund)]
    score_ranked_funds = sorted(
        default_funds,
        key=lambda fund: (
            growth_score_for_nav_refresh(fund, benchmark),
            number(fund.get("return3y", 0), "return3y"),
            number(fund.get("return3m", 0), "return3m"),
        ),
        reverse=True,
    )
    high_performance_funds = score_ranked_funds[:top_limit]

    if not high_performance_funds or limit <= 0:
        return []

    always_refresh = score_ranked_funds[: min(always_refresh_top, limit, len(score_ranked_funds))]
    selected_ids = {str(fund.get("fundId") or "") for fund in always_refresh}
    offset = int(cache.get("nextTopOffset") or 0) % len(high_performance_funds)
    wrapped = high_performance_funds[offset:] + high_performance_funds[:offset]
    rotating_candidates = [fund for fund in wrapped if str(fund.get("fundId") or "") not in selected_ids]
    rotating_limit = max(0, limit - len(always_refresh))
    candidates = always_refresh + rotating_candidates[: min(rotating_limit, len(rotating_candidates))]
    cache["nextTopOffset"] = (offset + rotating_limit) % len(high_performance_funds)
    return candidates


def monthly_nav_candidates(funds: list[dict[str, Any]], cache: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    root = Path(__file__).resolve().parent
    benchmark = load_taiwan_benchmark_returns(root)
    default_funds = [fund for fund in funds if is_buyable_default_fund(fund) and str(fund.get("fundId") or "")]
    ranked_funds = sorted(
        default_funds,
        key=lambda fund: (
            growth_score_for_nav_refresh(fund, benchmark),
            number(fund.get("return3y", 0), "return3y"),
            str(fund.get("fundId") or ""),
        ),
        reverse=True,
    )
    if not ranked_funds:
        return []
    offset = int(cache.get("nextAllOffset") or 0) % len(ranked_funds)
    wrapped = ranked_funds[offset:] + ranked_funds[:offset]
    candidates = wrapped[: min(limit, len(wrapped))]
    cache["nextAllOffset"] = (offset + len(candidates)) % len(ranked_funds)
    return candidates


def requested_nav_fund_ids() -> list[str]:
    url = f"{SUPABASE_URL}/rest/v1/fund_nav_requests?select=fund_id&order=requested_at.desc&limit=200"
    request = Request(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"{datetime.now().isoformat(timespec='seconds')} fund nav requests unavailable: {exc}", file=sys.stderr)
        return []
    if not isinstance(rows, list):
        return []
    ids = []
    for row in rows:
        fund_id = str((row or {}).get("fund_id") or "").strip()
        if fund_id and not fund_id.startswith("manual:") and fund_id not in ids:
            ids.append(fund_id)
    return ids


def prioritize_requested_nav_candidates(funds: list[dict[str, Any]], candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    requested_ids = requested_nav_fund_ids()
    if not requested_ids or limit <= 0:
        return candidates
    by_id = {str(fund.get("fundId") or ""): fund for fund in funds if str(fund.get("fundId") or "")}
    prioritized = [by_id[fund_id] for fund_id in requested_ids if fund_id in by_id]
    selected = {str(fund.get("fundId") or "") for fund in prioritized}
    prioritized.extend(fund for fund in candidates if str(fund.get("fundId") or "") not in selected)
    return prioritized[:limit]


def enrich_recent_fund_returns(funds: list[dict[str, Any]]) -> None:
    root = Path(__file__).resolve().parent
    cache = load_nav_cache(root)
    apply_nav_cache(funds, cache)

    refresh_limit = int(os.environ.get("RECENT_NAV_REFRESH_LIMIT", RECENT_NAV_REFRESH_LIMIT))
    candidates = nav_refresh_candidates(funds, cache, max(0, refresh_limit))
    if not candidates:
        return

    max_workers = int(os.environ.get("RECENT_NAV_WORKERS", RECENT_NAV_WORKERS))

    def fetch_recent(fund: dict[str, Any]) -> tuple[str, dict[str, tuple[float, str, str]], str | None]:
        fund_id = str(fund.get("fundId") or "")
        if not fund_id:
            return str(fund.get("name") or ""), {}, "missing fundId"
        try:
            series = fetch_moneydj_bcd_nav(fund_id)
            returns = {
                "return2w": period_return_from_series(series, RECENT_RETURN_DAYS),
                "return1m": period_return_from_series(series, MONTH_RETURN_DAYS),
            }
            return fund_id, {key: value for key, value in returns.items() if value}, None
        except Exception as exc:
            return fund_id, {}, str(exc)

    errors = 0
    by_id = {str(fund.get("fundId") or ""): fund for fund in funds}
    cache_items = cache.setdefault("items", {})
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_recent, fund) for fund in candidates]
        for future in concurrent.futures.as_completed(futures):
            fund_id, recent_returns, error = future.result()
            if error or not recent_returns.get("return2w"):
                errors += 1
                continue
            period_return, start_date, end_date = recent_returns["return2w"]
            fund = by_id.get(fund_id)
            if fund is not None:
                fund["return2w"] = period_return
                fund["return2wStartDate"] = start_date
                fund["return2wEndDate"] = end_date
            cache_item = {
                "return2w": period_return,
                "return2wStartDate": start_date,
                "return2wEndDate": end_date,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
            }
            if recent_returns.get("return1m"):
                month_return, month_start_date, month_end_date = recent_returns["return1m"]
                if fund is not None:
                    fund["return1m"] = month_return
                    fund["return1mStartDate"] = month_start_date
                    fund["return1mEndDate"] = month_end_date
                cache_item.update(
                    {
                        "return1m": month_return,
                        "return1mStartDate": month_start_date,
                        "return1mEndDate": month_end_date,
                    }
                )
            cache_items[fund_id] = cache_item

    if errors:
        print(f"{datetime.now().isoformat(timespec='seconds')} recent NAV skipped for {errors} funds", file=sys.stderr)
    cache["updatedAt"] = datetime.now(timezone.utc).isoformat()
    atomic_write_json(root / "data/nav_cache.json", cache)
    print(
        f"{datetime.now().isoformat(timespec='seconds')} recent NAV refreshed {len(candidates) - errors}/{len(candidates)} funds; cache has {len(cache_items)} funds",
        file=sys.stderr,
    )


def load_monthly_nav_cache(root: Path) -> dict[str, Any]:
    cache_path = root / "data/monthly_nav.json"
    items: dict[str, Any] = {}
    next_top_offset = 0
    next_all_offset = 0
    if cache_path.exists():
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(payload.get("items"), dict):
                items.update(payload["items"])
            next_top_offset = int(payload.get("nextTopOffset") or 0)
            next_all_offset = int(payload.get("nextAllOffset") or 0)
        except (OSError, json.JSONDecodeError, ValueError):
            pass
    return {
        "source": "MoneyDJ 歷史淨值月底整理",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "items": items,
        "nextTopOffset": max(0, next_top_offset),
        "nextAllOffset": max(0, next_all_offset),
    }


def update_monthly_nav_history(root: Path, funds: list[dict[str, Any]]) -> None:
    cache = load_monthly_nav_cache(root)
    refresh_limit = int(os.environ.get("MONTHLY_NAV_REFRESH_LIMIT", MONTHLY_NAV_REFRESH_LIMIT))
    candidates = monthly_nav_candidates(funds, cache, max(0, refresh_limit))
    candidates = prioritize_requested_nav_candidates(funds, candidates, max(0, refresh_limit))
    if not candidates:
        atomic_write_json(root / "data/monthly_nav.json", cache)
        return

    months = int(os.environ.get("MONTHLY_NAV_MONTHS", MONTHLY_NAV_MONTHS))
    weeks = int(os.environ.get("WEEKLY_NAV_WEEKS", WEEKLY_NAV_WEEKS))
    max_workers = min(int(os.environ.get("RECENT_NAV_WORKERS", RECENT_NAV_WORKERS)), max(1, refresh_limit))

    def fetch_monthly(fund: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str | None]:
        fund_id = str(fund.get("fundId") or "")
        if not fund_id:
            return str(fund.get("name") or ""), None, "missing fundId"
        try:
            series = fetch_moneydj_bcd_nav(fund_id)
            month_ends = month_end_navs_from_series(series, months)
            week_ends = week_end_navs_from_series(series, weeks)
            if not month_ends and not week_ends:
                return fund_id, None, "empty period nav"
            return (
                fund_id,
                {
                    "fundId": fund_id,
                    "name": fund.get("name"),
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                    "months": month_ends,
                    "weeks": week_ends,
                },
                None,
            )
        except Exception as exc:
            return fund_id, None, str(exc)

    errors = 0
    cache_items = cache.setdefault("items", {})
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_monthly, fund) for fund in candidates]
        for future in concurrent.futures.as_completed(futures):
            fund_id, item, error = future.result()
            if error or item is None:
                errors += 1
                continue
            cache_items[fund_id] = item

    cache["updatedAt"] = datetime.now(timezone.utc).isoformat()
    atomic_write_json(root / "data/monthly_nav.json", cache)
    if errors:
        print(f"{datetime.now().isoformat(timespec='seconds')} monthly NAV skipped for {errors} funds", file=sys.stderr)
    print(
        f"{datetime.now().isoformat(timespec='seconds')} monthly NAV refreshed {len(candidates) - errors}/{len(candidates)} funds; cache has {len(cache_items)} funds",
        file=sys.stderr,
    )


def fubon_text(item: ET.Element, tag: str) -> str:
    return html.unescape(item.findtext(tag) or "").replace("\u3000", " ").strip()


def map_fubon_type(target: str, name: str) -> str:
    text = f"{target} {name}"
    if "貨幣" in text:
        return "貨幣"
    if "ETF連結" in text:
        return "ETF連結"
    if "ETF" in text or "指數" in text:
        return "ETF"
    if "債" in text:
        return "債券"
    if "平衡" in text or "多重資產" in text or "組合" in text:
        return "平衡"
    if "國內" in text or "台灣" in text:
        return "台股"
    if "股票" in text or "股" in text:
        return "全球股票"
    return "基金"


def map_fubon_region(target: str, area: str, name: str) -> str:
    text = f"{target} {area} {name}"
    if "國內" in target or "台灣" in text:
        return "台灣"
    if any(keyword in text for keyword in ["美國", "北美", "NASDAQ", "那斯達克", "S&P", "費城半導體"]):
        return "美國"
    if any(keyword in text for keyword in ["亞洲", "中國", "大中華", "日本", "印度", "越南", "東協", "印尼", "韓國"]):
        return "亞洲"
    return "全球"


def normalize_fubon_fund(item: ET.Element) -> dict[str, Any] | None:
    fund_code = fubon_text(item, "FUND_CODE")
    name = fubon_text(item, "FUND_NAME")
    if not fund_code or not name:
        return None

    approve_flag = fubon_text(item, "APPROVE_FLAG")
    purchase_flag = fubon_text(item, "PURCHASE_FLAG")
    if approve_flag == "Y" or purchase_flag == "Y":
        return None

    target = fubon_text(item, "INVEST_TARGET_CHINESE")
    org_name = fubon_text(item, "ORG_FUND_NAME") or "富邦銀行上架基金"
    currency = fubon_text(item, "CURRENCY_CODE")
    if not is_twd_currency(currency):
        return None

    area = fubon_text(item, "AREA")
    risk = parse_rr(fubon_text(item, "RAM_TYPE"), fallback=4)
    three_year = optional_number(fubon_text(item, "YEAR_VALUE_3")) or 0.0
    return3y_annualized = ((1 + three_year / 100) ** (1 / 3) - 1) * 100 if three_year > -100 else three_year
    volatility = optional_number(fubon_text(item, "ANNUALIZED"))
    if volatility is None:
        volatility = {1: 3.0, 2: 6.0, 3: 11.0, 4: 17.0, 5: 25.0}.get(risk, 17.0)
    sharpe = optional_number(fubon_text(item, "SHARPE"))
    if sharpe is None:
        sharpe = sharpe_like(return3y_annualized, volatility)

    fund_kind = fubon_text(item, "FUND_KIND")
    purchase_types = {
        "1": ["單筆申購"],
        "2": ["定期定額"],
        "3": ["單筆申購", "定期定額"],
    }.get(fund_kind, ["申購"])
    interest_rate = optional_number(fubon_text(item, "WITH_INTEREST_RATE"))
    dividend = "配息" if (interest_rate is not None and interest_rate > -900) or any(keyword in name for keyword in ["配息", "月配", "季配", "年配"]) else "累積型"

    tags = [
        "富邦銀行可買",
        target,
        currency,
        f"風險P{risk}",
        "、".join(purchase_types),
    ]
    three_month = optional_number(fubon_text(item, "MONTH_VALUE_3"))
    one_year = optional_number(fubon_text(item, "YEAR_VALUE_1"))
    if three_month is not None:
        tags.append(f"3月 {three_month:.2f}%")
    if one_year is not None:
        tags.append(f"1年 {one_year:.2f}%")
    tags = [tag for tag in tags if tag]

    return {
        "fundId": fund_code,
        "ticker": fund_code,
        "name": name,
        "company": org_name,
        "currency": "台幣",
        "type": map_fubon_type(target, name),
        "region": map_fubon_region(target, area, name),
        "risk": risk,
        "return3y": round(return3y_annualized, 2),
        "return3yCumulative": round(three_year, 2),
        "return3m": round(three_month or 0.0, 2),
        "return1y": round(optional_number(fubon_text(item, "YEAR_VALUE_1")) or 0.0, 2),
        "return6m": round(optional_number(fubon_text(item, "MONTH_VALUE_6")) or 0.0, 2),
        "fee": 0.0,
        "feeUnavailable": True,
        "volatility": round(volatility, 2),
        "sharpe": round(sharpe, 2),
        "aum": 0.0,
        "nav": round(optional_number(fubon_text(item, "NET_VAULE")) or 0.0, 4),
        "navDate": fubon_text(item, "DATA_DATE"),
        "dividend": dividend,
        "minRsp": 1000,
        "tags": tags,
        "channel": "台北富邦銀行",
        "sourceDetail": "台北富邦銀行基金搜尋",
        "fubonBuyUrl": FUBON_PLUS_BUY_URL.format(fund_code=fund_code),
        "fubonPurchaseTypes": purchase_types,
    }


def build_fubon_bank_funds_payload() -> dict[str, Any]:
    xml_text = post_fubon_fund_search()
    root = ET.fromstring(xml_text)
    funds = [fund for fund in (normalize_fubon_fund(item) for item in root.findall(".//item")) if fund]
    if not funds:
        raise RuntimeError("Fubon fund search returned no buyable funds")
    funds.sort(key=lambda fund: fund["return3y"], reverse=True)
    return {
        "source": "台北富邦銀行官方基金搜尋資料",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }


def build_fubon_lookup() -> dict[str, dict[str, Any]]:
    xml_text = post_fubon_fund_search()
    root = ET.fromstring(xml_text)
    lookup: dict[str, dict[str, Any]] = {}
    for item in root.findall(".//item"):
        fund = normalize_fubon_fund(item)
        if fund:
            lookup[canonical_fund_name(fund["name"])] = fund
    return lookup


def load_json_file(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback
    return payload if isinstance(payload, dict) else fallback


def fundrich_lookup_from_items(items: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for item in items.values():
        if not isinstance(item, dict):
            continue
        name = str(item.get("fundrichName") or "").strip()
        fund_id = str(item.get("fundrichFundId") or "").strip()
        if not name or not fund_id:
            continue
        if not is_twd_currency(name):
            continue
        lookup[canonical_fund_name(name)] = {
            "fundrichFundId": fund_id,
            "fundrichName": name,
            "fundrichUrl": str(item.get("fundrichUrl") or FUNDRICH_DETAIL_URL.format(fund_id=fund_id)),
            "fundrichAppUrl": str(item.get("fundrichAppUrl") or FUNDRICH_APP_BUY_URL.format(fund_id=fund_id)),
        }
    return lookup


def build_fundrich_lookup() -> dict[str, dict[str, Any]]:
    root = Path(__file__).resolve().parent
    cache_path = root / "data/fundrich_cache.json"
    cache = load_json_file(cache_path, {"items": {}, "nextPage": 1, "maxPage": None, "updatedAt": None})
    items = cache.setdefault("items", {})
    funds_path = root / "data/funds.json"
    if funds_path.exists():
        try:
            payload = json.loads(funds_path.read_text(encoding="utf-8"))
            for fund in payload.get("funds", []):
                fund_id = str(fund.get("fundrichFundId") or "").strip()
                name = str(fund.get("fundrichName") or "").strip()
                if not fund_id or not name or fund_id in items:
                    continue
                if not is_twd_currency(name):
                    continue
                items[fund_id] = {
                    "fundrichFundId": fund_id,
                    "fundrichName": name,
                    "fundrichUrl": fund.get("fundrichUrl") or FUNDRICH_DETAIL_URL.format(fund_id=fund_id),
                    "fundrichAppUrl": fund.get("fundrichAppUrl") or FUNDRICH_APP_BUY_URL.format(fund_id=fund_id),
                }
        except (OSError, json.JSONDecodeError):
            pass
    max_age_hours = float(os.environ.get("FUNDRICH_CACHE_MAX_AGE_HOURS", FUNDRICH_CACHE_MAX_AGE_HOURS))
    is_fresh = bool(items) and parse_iso_datetime(cache.get("updatedAt")) >= datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    if is_fresh:
        return fundrich_lookup_from_items(items)

    page = max(1, int(cache.get("nextPage") or 1))
    max_page = cache.get("maxPage")
    max_page = int(max_page) if max_page else None
    refresh_pages = int(os.environ.get("FUNDRICH_REFRESH_PAGES", FUNDRICH_REFRESH_PAGES))
    fetched_pages = 0

    while fetched_pages < refresh_pages and (max_page is None or page <= max_page):
        payload = post_json(
            FUNDRICH_FUND_TABLE_URL,
            {"data": {"currentPage": page}},
            "https://www.fundrich.com.tw/fundCenter/fundOverview",
        )
        if payload.get("status") != 0:
            raise RuntimeError(f"FundRich FundTableInfo failed: {payload.get('msg')}")
        data = (payload.get("data") or [{}])[0]
        total = int(data.get("resultCount") or 0)
        tablebox = data.get("tablebox") or []
        if max_page is None and tablebox:
            max_page = min(300, (total + len(tablebox) - 1) // len(tablebox))
        if not tablebox:
            break
        for row in tablebox:
            fund_id = str(row.get("fundId") or "").strip()
            name = str(row.get("name") or "").strip()
            state = row.get("state")
            if not fund_id or not name or state not in {0, "0"}:
                continue
            items[fund_id] = {
                "fundrichFundId": fund_id,
                "fundrichName": name,
                "fundrichUrl": FUNDRICH_DETAIL_URL.format(fund_id=fund_id),
                "fundrichAppUrl": FUNDRICH_APP_BUY_URL.format(fund_id=fund_id),
            }
        page += 1
        fetched_pages += 1

    if max_page and page > max_page:
        page = 1
    cache["nextPage"] = page
    cache["maxPage"] = max_page
    cache["updatedAt"] = datetime.now(timezone.utc).isoformat()
    atomic_write_json(cache_path, cache)

    lookup = fundrich_lookup_from_items(items)
    if not lookup:
        raise RuntimeError("FundRich returned no buyable funds")
    print(
        f"{datetime.now().isoformat(timespec='seconds')} FundRich refreshed {fetched_pages} pages; cache has {len(items)} funds; next page {page}",
        file=sys.stderr,
    )
    return lookup


def moneydj_fund_code(fund: dict[str, Any]) -> str:
    return str(fund.get("fundId") or "").split("-", 1)[0].strip().upper()


def build_moneydj_fundrich_lookup() -> dict[str, dict[str, Any]]:
    platforms_payload = fetch_json(MONEYDJ_MOBILE_PLATFORM_URL)
    fund_payload = fetch_json(MONEYDJ_FUND_BUY_URL)
    platforms = (platforms_payload.get("ResultSet") or {}).get("Result") or []
    fundrich_platform = next(
        (item for item in platforms if str(item.get("V1") or "").lower() == MONEYDJ_FUNDRICH_PLATFORM_ID.lower()),
        None,
    )
    if not fundrich_platform:
        return {}
    order_template = str(fundrich_platform.get("V4") or "")
    if "{0}" not in order_template:
        return {}

    lookup: dict[str, dict[str, Any]] = {}
    rows = (fund_payload.get("ResultSet") or {}).get("Result") or []
    for row in rows:
        if str(row.get("V3") or "").lower() != MONEYDJ_FUNDRICH_PLATFORM_ID.lower():
            continue
        fund_code = str(row.get("V1") or "").strip().upper()
        if not fund_code:
            continue
        lookup[fund_code] = {
            "fundrichFundId": str(row.get("V2") or "").strip(),
            "fundrichName": f"MoneyDJ {fund_code} FundRich",
            "fundrichUrl": order_template.replace("{0}", fund_code),
            "fundrichAppUrl": order_template.replace("{0}", fund_code),
            "fundrichSource": "MoneyDJ 申購清單",
        }
    return lookup


def enrich_channel_links(
    fund: dict[str, Any],
    fubon_lookup: dict[str, dict[str, Any]],
    moneydj_fundrich_lookup: dict[str, dict[str, Any]],
    fundrich_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    tags = list(fund.get("tags") or [])
    fubon = find_channel_match(fund["name"], fubon_lookup)
    if fubon:
        fund["channel"] = "台北富邦銀行"
        fund["fubonFundId"] = fubon.get("fundId")
        fund["fubonBuyUrl"] = fubon.get("fubonBuyUrl")
        fund["fubonPurchaseTypes"] = fubon.get("fubonPurchaseTypes", [])
        tags.append("富邦銀行可買")
    else:
        fundrich = moneydj_fundrich_lookup.get(moneydj_fund_code(fund)) or find_channel_match(fund["name"], fundrich_lookup)
        if fundrich:
            fund.update(fundrich)
            fund["channel"] = "基富通"
            tags.append("基富通可買")
    fund["tags"] = list(dict.fromkeys(tag for tag in tags if tag))
    return fund


def build_combined_tw_funds_payload() -> dict[str, Any]:
    try:
        base = build_moneydj_tw_funds_payload()
    except Exception as exc:
        print(f"{datetime.now().isoformat(timespec='seconds')} MoneyDJ all-table update failed; fallback to MegaBank pages: {exc}", file=sys.stderr)
        base = build_megabank_tw_funds_payload()
    fubon_lookup = build_fubon_lookup()
    try:
        moneydj_fundrich_lookup = build_moneydj_fundrich_lookup()
    except Exception as exc:
        print(f"{datetime.now().isoformat(timespec='seconds')} MoneyDJ FundRich lookup failed: {exc}", file=sys.stderr)
        moneydj_fundrich_lookup = {}
    fundrich_lookup = build_fundrich_lookup()
    funds = [enrich_channel_links(fund, fubon_lookup, moneydj_fundrich_lookup, fundrich_lookup) for fund in base["funds"]]
    return {
        "source": f"{base['source']} + 富邦銀行/基富通可買連結",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }


def build_yahoo_etf_payload() -> dict[str, Any]:
    funds = []
    errors = []

    for meta in TAIWAN_ETFS:
        try:
            chart = fetch_yahoo_chart(meta["symbol"])
            result = chart["chart"]["result"][0]
            quote = result["indicators"]["quote"][0]
            adjclose = result["indicators"].get("adjclose", [{}])[0].get("adjclose") or quote.get("close", [])
            prices = clean_series(adjclose)
            closes = clean_series(quote.get("close", []))
            volumes = clean_series(quote.get("volume", []))
            latest_price = closes[-1] if closes else prices[-1]
            return3y = annualized_return(prices)
            volatility = annualized_volatility(prices)

            funds.append(
                {
                    "ticker": meta["symbol"],
                    "name": meta["name"],
                    "company": meta["company"],
                    "type": meta["type"],
                    "region": meta["region"],
                    "risk": risk_from_volatility(volatility),
                    "return3y": round(return3y, 2),
                    "fee": meta["fee"],
                    "volatility": round(volatility, 2),
                    "sharpe": round(sharpe_like(return3y, volatility), 2),
                    "aum": 0,
                    "price": round(latest_price, 2),
                    "averageVolume": round(sum(volumes[-20:]) / len(volumes[-20:])) if volumes[-20:] else 0,
                    "dividend": meta["dividend"],
                    "minRsp": 1000,
                    "tags": [*meta["tags"], meta["symbol"].replace(".TW", "")],
                }
            )
        except Exception as exc:
            errors.append(f"{meta['symbol']}: {exc}")

    if not funds:
        raise RuntimeError(f"Yahoo ETF update failed for all symbols: {'; '.join(errors)}")

    payload = {
        "source": "Yahoo Finance Taiwan ETF market data",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }
    if errors:
        payload["warnings"] = errors
    return payload


def number(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} 必須是數字: {value!r}") from exc


def normalize_fund(item: dict[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_FIELDS - set(item)
    if missing:
        raise ValueError(f"基金缺少欄位 {sorted(missing)}: {item.get('name', '未命名')}")
    if not isinstance(item["tags"], list):
        raise ValueError(f"tags 必須是陣列: {item.get('name', '未命名')}")

    normalized = {
        "name": str(item["name"]),
        "company": str(item["company"]),
        "type": str(item["type"]),
        "region": str(item["region"]),
        "risk": int(number(item["risk"], "risk")),
        "return3y": number(item["return3y"], "return3y"),
        "fee": number(item["fee"], "fee"),
        "volatility": number(item["volatility"], "volatility"),
        "sharpe": number(item["sharpe"], "sharpe"),
        "aum": number(item["aum"], "aum"),
        "dividend": str(item["dividend"]),
        "minRsp": int(number(item["minRsp"], "minRsp")),
        "tags": [str(tag) for tag in item["tags"]],
    }

    if item.get("ticker"):
        normalized["ticker"] = str(item["ticker"])
    if item.get("fundId"):
        normalized["fundId"] = str(item["fundId"])
    if item.get("price") is not None:
        normalized["price"] = number(item["price"], "price")
    if item.get("nav") is not None:
        normalized["nav"] = number(item["nav"], "nav")
    if item.get("navDate"):
        normalized["navDate"] = str(item["navDate"])
    if item.get("return3yCumulative") is not None:
        normalized["return3yCumulative"] = number(item["return3yCumulative"], "return3yCumulative")
    if item.get("return3m") is not None:
        normalized["return3m"] = number(item["return3m"], "return3m")
    if item.get("return2w") is not None:
        normalized["return2w"] = number(item["return2w"], "return2w")
    if item.get("return2wStartDate"):
        normalized["return2wStartDate"] = str(item["return2wStartDate"])
    if item.get("return2wEndDate"):
        normalized["return2wEndDate"] = str(item["return2wEndDate"])
    if item.get("return1m") is not None:
        normalized["return1m"] = number(item["return1m"], "return1m")
    if item.get("return1mStartDate"):
        normalized["return1mStartDate"] = str(item["return1mStartDate"])
    if item.get("return1mEndDate"):
        normalized["return1mEndDate"] = str(item["return1mEndDate"])
    if item.get("return1y") is not None:
        normalized["return1y"] = number(item["return1y"], "return1y")
    if item.get("return6m") is not None:
        normalized["return6m"] = number(item["return6m"], "return6m")
    if item.get("returnYtd") is not None:
        normalized["returnYtd"] = number(item["returnYtd"], "returnYtd")
    if item.get("averageVolume") is not None:
        normalized["averageVolume"] = int(number(item["averageVolume"], "averageVolume"))
    if item.get("feeUnavailable") is not None:
        normalized["feeUnavailable"] = bool(item["feeUnavailable"])
    for key in [
        "moneyDjUrl",
        "channel",
        "sourceDetail",
        "fubonFundId",
        "fubonBuyUrl",
        "fundrichFundId",
        "fundrichName",
        "fundrichUrl",
        "fundrichAppUrl",
        "fundrichSource",
    ]:
        if item.get(key):
            normalized[key] = str(item[key])
    if item.get("fubonPurchaseTypes") is not None:
        normalized["fubonPurchaseTypes"] = [str(value) for value in item["fubonPurchaseTypes"]]

    return normalized


def normalize_payload(payload: Any, source_name: str) -> dict[str, Any]:
    if isinstance(payload, list):
        funds = payload
        source = source_name
    elif isinstance(payload, dict) and isinstance(payload.get("funds"), list):
        funds = payload["funds"]
        source = str(payload.get("source") or source_name)
    else:
        raise ValueError("來源資料必須是基金陣列，或包含 funds 陣列的物件")

    normalized = [normalize_fund(item) for item in funds]
    return {
        "source": source,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": normalized,
    }


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
        temp_name = file.name
    os.replace(temp_name, path)


def update_once(config: dict[str, Any], root: Path) -> None:
    source_url = str(config["sourceUrl"])
    output_path = root / config.get("outputPath", "data/funds.json")
    source_name = str(config.get("sourceName") or source_url)

    payload = fetch_json(source_url)
    normalized = normalize_payload(payload, source_name)
    atomic_write_json(output_path, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {output_path} ({len(normalized['funds'])} funds)")


def update_yahoo_etfs_once(root: Path, output_path: str = "data/funds.json") -> None:
    normalized = normalize_payload(build_yahoo_etf_payload(), "Yahoo Finance Taiwan ETF market data")
    target = root / output_path
    atomic_write_json(target, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(normalized['funds'])} ETFs)")


def update_yuanta_funds_once(root: Path, output_path: str = "data/funds.json") -> None:
    normalized = normalize_payload(build_yuanta_funds_payload(), "Yuanta Funds FundList API")
    target = root / output_path
    atomic_write_json(target, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(normalized['funds'])} Yuanta funds)")


def update_megabank_tw_funds_once(root: Path, output_path: str = "data/funds.json") -> None:
    normalized = normalize_payload(build_megabank_tw_funds_payload(), "兆豐基金/MoneyDJ 國內基金公開資料")
    target = root / output_path
    atomic_write_json(target, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(normalized['funds'])} Taiwan funds)")


def update_fubon_bank_funds_once(root: Path, output_path: str = "data/funds.json") -> None:
    normalized = normalize_payload(build_fubon_bank_funds_payload(), "台北富邦銀行官方基金搜尋資料")
    target = root / output_path
    atomic_write_json(target, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(normalized['funds'])} Fubon funds)")


def update_combined_tw_funds_once(root: Path, output_path: str = "data/funds.json") -> None:
    normalized = normalize_payload(build_combined_tw_funds_payload(), "台灣基金與通路連結")
    try:
        update_monthly_nav_history(root, normalized["funds"])
    except Exception as exc:
        print(f"{datetime.now().isoformat(timespec='seconds')} monthly NAV update failed: {exc}", file=sys.stderr)
    target = root / output_path
    atomic_write_json(target, normalized)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(normalized['funds'])} Taiwan funds)")


def update_markets_once(root: Path, output_path: str = "data/markets.json") -> None:
    target = root / output_path
    payload = build_markets_payload()
    atomic_write_json(target, payload)
    print(f"{datetime.now().isoformat(timespec='seconds')} updated {target} ({len(payload['markets'])} markets)")


def watch(config: dict[str, Any] | None, root: Path, provider: str) -> None:
    interval_hours = float(config.get("intervalHours", 3)) if config else 3
    interval_seconds = int(interval_hours * 60 * 60) or DEFAULT_INTERVAL_SECONDS

    while True:
        try:
            if provider == "yahoo-tw-etf":
                update_yahoo_etfs_once(root)
            elif provider == "yuanta-funds":
                update_yuanta_funds_once(root)
            elif provider == "megabank-tw-funds":
                update_megabank_tw_funds_once(root)
            elif provider == "fubon-bank-funds":
                update_fubon_bank_funds_once(root)
            elif provider == "combined-tw-funds":
                update_combined_tw_funds_once(root)
                try:
                    update_markets_once(root)
                except Exception as exc:
                    print(f"{datetime.now().isoformat(timespec='seconds')} market update failed: {exc}", file=sys.stderr)
            else:
                if config is None:
                    raise ValueError("config is required for JSON provider")
                update_once(config, root)
        except Exception as exc:
            print(f"{datetime.now().isoformat(timespec='seconds')} update failed: {exc}", file=sys.stderr)
        time.sleep(interval_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description="Update Taiwan Fund Radar data.")
    parser.add_argument("--config", default="config/source.json", help="Path to source config JSON.")
    parser.add_argument(
        "--provider",
        choices=["json", "yahoo-tw-etf", "yuanta-funds", "megabank-tw-funds", "fubon-bank-funds", "combined-tw-funds", "markets"],
        default="json",
        help="Data provider to use.",
    )
    parser.add_argument("--once", action="store_true", help="Run one update and exit.")
    parser.add_argument("--watch", action="store_true", help="Update repeatedly. Default interval is read from config/source.json.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    config = load_config(root / args.config) if args.provider == "json" else None

    if args.watch:
        watch(config, root, args.provider)
    elif args.provider == "yahoo-tw-etf":
        update_yahoo_etfs_once(root)
    elif args.provider == "yuanta-funds":
        update_yuanta_funds_once(root)
    elif args.provider == "megabank-tw-funds":
        update_megabank_tw_funds_once(root)
    elif args.provider == "fubon-bank-funds":
        update_fubon_bank_funds_once(root)
    elif args.provider == "combined-tw-funds":
        update_combined_tw_funds_once(root)
        try:
            update_markets_once(root)
        except Exception as exc:
            print(f"{datetime.now().isoformat(timespec='seconds')} market update failed: {exc}", file=sys.stderr)
    elif args.provider == "markets":
        update_markets_once(root)
    else:
        if config is None:
            raise ValueError("config is required for JSON provider")
        update_once(config, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
