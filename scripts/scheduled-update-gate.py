#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


TAIPEI = ZoneInfo("Asia/Taipei")
TARGET_HOURS = (4, 12, 20)
EARLY_WINDOW_MINUTES = 20
LATE_WINDOW_MINUTES = 120
FRESH_MINUTES = 30
LIVE_FUNDS_URL = "https://mengtahsu.github.io/taiwan-fund-radar/data/funds.json"


def nearest_target_delta_minutes(now: datetime) -> float:
    candidates = []
    for day_offset in (-1, 0, 1):
        day = (now + timedelta(days=day_offset)).date()
        for hour in TARGET_HOURS:
            candidates.append(datetime(day.year, day.month, day.day, hour, tzinfo=TAIPEI))
    target = min(candidates, key=lambda value: abs((now - value).total_seconds()))
    return (now - target).total_seconds() / 60


def is_target_window(now: datetime) -> bool:
    delta = nearest_target_delta_minutes(now)
    return -EARLY_WINDOW_MINUTES <= delta <= LATE_WINDOW_MINUTES


def parse_timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def live_data_age_minutes(now: datetime) -> float | None:
    request = Request(
        f"{LIVE_FUNDS_URL}?gate={int(now.timestamp())}",
        headers={"User-Agent": "TaiwanFundRadar-ScheduleGate/1.0"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        updated_at = parse_timestamp(payload.get("updatedAt"))
    except Exception as error:
        print(f"Freshness check unavailable ({error}); allowing update")
        return None
    if not updated_at:
        return None
    return (now.astimezone(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds() / 60


def write_output(should_update: bool, reason: str) -> None:
    print(f"should_update={str(should_update).lower()} reason={reason}")
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"should_update={str(should_update).lower()}\n")
            output.write(f"reason={reason}\n")


def self_test() -> None:
    cases = {
        "2026-08-05T02:55:00+08:00": False,
        "2026-08-05T03:25:00+08:00": False,
        "2026-08-05T03:40:00+08:00": True,
        "2026-08-05T03:55:00+08:00": True,
        "2026-08-05T04:57:00+08:00": True,
        "2026-08-05T06:01:00+08:00": False,
        "2026-08-05T11:55:00+08:00": True,
        "2026-08-05T20:45:00+08:00": True,
    }
    for value, expected in cases.items():
        actual = is_target_window(datetime.fromisoformat(value))
        if actual != expected:
            raise AssertionError(f"{value}: expected {expected}, got {actual}")
    print(f"Schedule gate self-test passed: {len(cases)} cases")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    event_name = os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch")
    if event_name != "schedule":
        write_output(True, f"{event_name}-event")
        return
    now_value = os.environ.get("SCHEDULE_GATE_NOW")
    now = datetime.fromisoformat(now_value).astimezone(TAIPEI) if now_value else datetime.now(TAIPEI)
    if not is_target_window(now):
        write_output(False, "outside-target-window")
        return
    age_minutes = live_data_age_minutes(now)
    if age_minutes is not None and -5 <= age_minutes <= FRESH_MINUTES:
        write_output(False, f"live-data-fresh-{age_minutes:.1f}m")
        return
    write_output(True, "target-window-needs-update")


if __name__ == "__main__":
    main()
