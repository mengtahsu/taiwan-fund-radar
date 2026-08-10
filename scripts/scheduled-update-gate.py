#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


TAIPEI = ZoneInfo("Asia/Taipei")
TARGET_HOURS = (4, 12, 20)
EARLY_WINDOW_MINUTES = 180
LATE_WINDOW_MINUTES = 120
FRESH_MINUTES = 30
LIVE_FUNDS_URL = "https://mengtahsu.github.io/taiwan-fund-radar/data/funds.json"


def nearest_target(now: datetime) -> datetime:
    candidates = []
    for day_offset in (-1, 0, 1):
        day = (now + timedelta(days=day_offset)).date()
        for hour in TARGET_HOURS:
            candidates.append(datetime(day.year, day.month, day.day, hour, tzinfo=TAIPEI))
    return min(candidates, key=lambda value: abs((now - value).total_seconds()))


def nearest_target_delta_minutes(now: datetime) -> float:
    return (now - nearest_target(now)).total_seconds() / 60


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


def write_output(should_update: bool, reason: str, wait_seconds: int = 0) -> None:
    print(
        f"should_update={str(should_update).lower()} "
        f"wait_seconds={wait_seconds} reason={reason}"
    )
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"should_update={str(should_update).lower()}\n")
            output.write(f"wait_seconds={wait_seconds}\n")
            output.write(f"reason={reason}\n")


def self_test() -> None:
    cases = {
        "2026-08-05T00:59:00+08:00": (False, 0),
        "2026-08-05T01:25:00+08:00": (True, 9300),
        "2026-08-05T02:25:00+08:00": (True, 5700),
        "2026-08-05T03:40:00+08:00": (True, 1200),
        "2026-08-05T03:55:00+08:00": (True, 300),
        "2026-08-05T04:57:00+08:00": (True, 0),
        "2026-08-05T06:01:00+08:00": (False, 0),
        "2026-08-05T11:55:00+08:00": (True, 300),
        "2026-08-05T20:45:00+08:00": (True, 0),
    }
    for value, (expected_window, expected_wait) in cases.items():
        now = datetime.fromisoformat(value)
        actual_window = is_target_window(now)
        actual_wait = (
            max(0, math.ceil((nearest_target(now) - now).total_seconds()))
            if actual_window
            else 0
        )
        if (actual_window, actual_wait) != (expected_window, expected_wait):
            raise AssertionError(
                f"{value}: expected {(expected_window, expected_wait)}, "
                f"got {(actual_window, actual_wait)}"
            )
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
    wait_seconds = max(0, math.ceil((nearest_target(now) - now).total_seconds()))
    if wait_seconds:
        write_output(True, "wait-for-taipei-target", wait_seconds)
        return
    age_minutes = live_data_age_minutes(now)
    if age_minutes is not None and -5 <= age_minutes <= FRESH_MINUTES:
        write_output(False, f"live-data-fresh-{age_minutes:.1f}m")
        return
    write_output(True, "target-window-needs-update")


if __name__ == "__main__":
    main()
