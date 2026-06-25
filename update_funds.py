#!/usr/bin/env python3
"""Fetch fund data and write the website data file.

Expected source format:

1. A JSON array of fund objects.
2. Or an object with a "funds" array plus optional "source" and "updatedAt".

Run once:
  python3 update_funds.py --config config/source.json --once

Run continuously, eight times per day by default:
  python3 update_funds.py --config config/source.json --watch
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import statistics
import sys
import tempfile
import time
import uuid
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


def clean_megabank_name(value: str) -> tuple[str, str]:
    match = re.match(r"^([A-Z0-9]+)\s+(.+)$", value.strip(), flags=re.IGNORECASE)
    if not match:
        return "", value.strip()
    return match.group(1), match.group(2).strip()


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
        "type": map_megabank_type(fund_type, name),
        "region": map_megabank_region(fund_type, name),
        "risk": risk,
        "return3y": round(return3y_annualized, 2),
        "return3yCumulative": round(three_year or 0.0, 2),
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

    funds.sort(key=lambda fund: fund["return3y"], reverse=True)
    payload: dict[str, Any] = {
        "source": "兆豐基金/MoneyDJ 國內基金公開資料",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "funds": funds,
    }
    if warnings:
        payload["warnings"] = warnings
    return payload


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
        choices=["json", "yahoo-tw-etf", "yuanta-funds", "megabank-tw-funds"],
        default="json",
        help="Data provider to use.",
    )
    parser.add_argument("--once", action="store_true", help="Run one update and exit.")
    parser.add_argument("--watch", action="store_true", help="Update repeatedly. Default interval is every 3 hours.")
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
    else:
        if config is None:
            raise ValueError("config is required for JSON provider")
        update_once(config, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
