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
import json
import os
import statistics
import sys
import tempfile
import time
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


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"找不到設定檔: {path}")
    with path.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not config.get("sourceUrl"):
        raise ValueError("設定檔需要 sourceUrl")
    return config


def fetch_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": "TaiwanFundRadar/1.0"})
    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        raw = response.read().decode(charset)
    return json.loads(raw)


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
    if item.get("price") is not None:
        normalized["price"] = number(item["price"], "price")
    if item.get("averageVolume") is not None:
        normalized["averageVolume"] = int(number(item["averageVolume"], "averageVolume"))

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


def watch(config: dict[str, Any] | None, root: Path, provider: str) -> None:
    interval_hours = float(config.get("intervalHours", 3)) if config else 3
    interval_seconds = int(interval_hours * 60 * 60) or DEFAULT_INTERVAL_SECONDS

    while True:
        try:
            if provider == "yahoo-tw-etf":
                update_yahoo_etfs_once(root)
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
    parser.add_argument("--provider", choices=["json", "yahoo-tw-etf"], default="json", help="Data provider to use.")
    parser.add_argument("--once", action="store_true", help="Run one update and exit.")
    parser.add_argument("--watch", action="store_true", help="Update repeatedly. Default interval is every 3 hours.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    config = load_config(root / args.config) if args.provider == "json" else None

    if args.watch:
        watch(config, root, args.provider)
    elif args.provider == "yahoo-tw-etf":
        update_yahoo_etfs_once(root)
    else:
        if config is None:
            raise ValueError("config is required for JSON provider")
        update_once(config, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
