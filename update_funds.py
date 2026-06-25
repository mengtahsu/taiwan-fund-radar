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
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
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

    return {
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


def watch(config: dict[str, Any], root: Path) -> None:
    interval_hours = float(config.get("intervalHours", 3))
    interval_seconds = int(interval_hours * 60 * 60) or DEFAULT_INTERVAL_SECONDS

    while True:
        try:
            update_once(config, root)
        except Exception as exc:
            print(f"{datetime.now().isoformat(timespec='seconds')} update failed: {exc}", file=sys.stderr)
        time.sleep(interval_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description="Update Taiwan Fund Radar data.")
    parser.add_argument("--config", default="config/source.json", help="Path to source config JSON.")
    parser.add_argument("--once", action="store_true", help="Run one update and exit.")
    parser.add_argument("--watch", action="store_true", help="Update repeatedly. Default interval is every 3 hours.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    config = load_config(root / args.config)

    if args.watch:
        watch(config, root)
    else:
        update_once(config, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
