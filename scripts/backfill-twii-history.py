"""Import TAIEX daily history through 2000, cross-check it, then rebuild the chart."""

import hashlib
import json
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update_funds as updater


SOURCE_URL = "https://www.011.idv.tw/Taiex/taiex-Native.js"


def parse_archive(text):
    # Read only the legacy date/number literals; never execute the downloaded JS.
    matches = re.findall(r"\[new Date\('([0-9]{4}/[0-9]{2}/[0-9]{2})'\),([0-9]+(?:\.[0-9]+)?)\]", text)
    rows = {}
    for date, value in matches:
        date = datetime.strptime(date, "%Y/%m/%d").date().isoformat()
        close = round(float(value), 2)
        if not "1984-09-01" <= date <= "1989-12-31":
            continue
        if close <= 0 or (date in rows and rows[date] != close):
            raise ValueError(f"Invalid or conflicting archive close: {date}")
        rows[date] = close
    for year in range(1985, 1990):
        dates = [date for date in rows if date.startswith(str(year))]
        if len(dates) < 270 or not any(datetime.fromisoformat(date).weekday() == 5 for date in dates):
            raise ValueError(f"Archive is missing trading sessions for {year}")
    return rows


def verify_rows(rows, reference, label, minimum):
    overlap = sorted(rows.keys() & reference.keys())
    if len(overlap) < minimum:
        raise ValueError(f"Too few overlapping dates for {label}: {len(overlap)}")
    conflicts = [date for date in overlap if abs(rows[date] - reference[date]) > 0.011]
    if conflicts:
        raise ValueError(f"Archive differs from {label}: {[(date, rows[date], reference[date]) for date in conflicts[:5]]}")
    print(f"Verified {len(overlap)} daily closes against {label}")
    return len(overlap)


def fetch_official_month(year, month):
    cache = Path(tempfile.gettempdir()) / "taiwan-fund-radar-twii-backfill" / f"{year}{month:02d}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    url = f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={year}{month:02d}01&response=json"
    for attempt in range(3):
        try:
            report = updater.fetch_json(url)
            if report.get("stat") != "OK" or len(report.get("data", [])) < 5:
                raise ValueError(f"Missing TWSE daily report for {year}-{month:02d}")
            updater.atomic_write_json(cache, report)
            time.sleep(0.5)
            return report
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def main():
    root = Path(__file__).resolve().parents[1]
    text = updater.fetch_text(SOURCE_URL)
    rows = parse_archive(text)
    old_reference = {}
    end = datetime(1997, 8, 1, tzinfo=timezone.utc)
    start = datetime(1984, 9, 1, tzinfo=timezone.utc)
    while end > start:
        query = updater.urlencode({"resolution": "D", "symbol": "TWS:TSE01:INDEX", "from": int(end.timestamp()), "to": int(start.timestamp())})
        payload = updater.fetch_json(f"https://ws.api.cnyes.com/ws/api/v1/charting/history?{query}")["data"]
        timestamps, closes = payload.get("t", []), payload.get("c", [])
        if not timestamps or len(timestamps) != len(closes):
            raise ValueError("Cnyes verification returned no daily history")
        for timestamp, close in zip(timestamps, closes):
            old_reference[datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()] = round(float(close), 2)
        next_end = datetime.fromtimestamp(min(timestamps), timezone.utc) - timedelta(days=1)
        if next_end < start + timedelta(days=7):
            break
        if next_end >= end:
            raise ValueError("Cnyes history pagination did not advance")
        end = next_end
    cnyes_count = verify_rows(rows, old_reference, "Cnyes TWS:TSE01:INDEX", 1200)
    # TWSE's monthly reports retain Saturday sessions omitted by many chart feeds.
    official_rows = {}
    for year in range(1990, 2001):
        for month in range(1, 13):
            official = fetch_official_month(year, month)
            for row in official["data"]:
                roc_year, month_value, day = row[0].strip().split("/")
                date = f"{int(roc_year) + 1911:04d}-{month_value}-{day}"
                official_rows[date] = float(row[4].replace(",", ""))
        print(f"Imported official TWSE trading sessions: {year}", flush=True)
    rows.update(official_rows)
    archive = {
        "source": "011 TAIEX archive through 1989 (cross-checked against Cnyes); TWSE official daily closes for 1990-2000",
        "sourceUrl": SOURCE_URL,
        "officialSourceUrl": "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK",
        "sourceSha256": hashlib.sha256(text.encode()).hexdigest(),
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "verification": {"cnyesRows": cnyes_count, "twseRows": len(official_rows)},
        "items": [{"date": date, "close": close} for date, close in sorted(rows.items())],
    }
    updater.atomic_write_json(root / "data/twii_history_archive.json", archive)
    updater.update_twii_trend_once(root)


if __name__ == "__main__":
    main()
