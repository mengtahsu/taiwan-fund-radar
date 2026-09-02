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
SCHEDULE_TARGET_HOURS = {
    "15 0-3,22-23 * * *": 4,
    "15 6-11 * * *": 12,
    "15 14-19 * * *": 20,
}
EARLY_WINDOW_MINUTES = 345
LATE_WINDOW_MINUTES = 360
COMPLETION_TOLERANCE_MINUTES = 0
LIVE_FUNDS_URL = "https://mengtahsu.github.io/taiwan-fund-radar/data/funds.json"


def nearest_target(now: datetime, target_hours: tuple[int, ...] = TARGET_HOURS) -> datetime:
    candidates = []
    for day_offset in (-1, 0, 1):
        day = (now + timedelta(days=day_offset)).date()
        for hour in target_hours:
            candidates.append(datetime(day.year, day.month, day.day, hour, tzinfo=TAIPEI))
    return min(candidates, key=lambda value: abs((now - value).total_seconds()))


def target_for_attempt(now: datetime, schedule: str = "") -> datetime:
    target_hour = SCHEDULE_TARGET_HOURS.get(schedule)
    return nearest_target(now, (target_hour,)) if target_hour is not None else nearest_target(now)


def target_delta_minutes(now: datetime, target: datetime) -> float:
    return (now - target).total_seconds() / 60


def is_target_window(now: datetime, target: datetime) -> bool:
    delta = target_delta_minutes(now, target)
    return -EARLY_WINDOW_MINUTES <= delta <= LATE_WINDOW_MINUTES


def parse_timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def live_data_updated_at(now: datetime) -> datetime | None:
    request = Request(
        f"{LIVE_FUNDS_URL}?gate={int(now.timestamp())}",
        headers={"User-Agent": "TaiwanFundRadar-ScheduleGate/1.0"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return parse_timestamp(payload.get("updatedAt"))
    except Exception as error:
        print(f"Freshness check unavailable ({error}); allowing update")
        return None


def target_is_complete(target: datetime, updated_at: datetime | None) -> bool:
    if updated_at is None:
        return False
    threshold = target.astimezone(timezone.utc) - timedelta(minutes=COMPLETION_TOLERANCE_MINUTES)
    return updated_at.astimezone(timezone.utc) >= threshold


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
        ("2026-08-04T22:15:00+08:00", "15 0-3,22-23 * * *"): (True, 20700, 4),
        ("2026-08-05T01:15:00+08:00", "15 0-3,22-23 * * *"): (True, 9900, 4),
        ("2026-08-05T03:55:00+08:00", "15 0-3,22-23 * * *"): (True, 300, 4),
        ("2026-08-05T05:30:00+08:00", "15 0-3,22-23 * * *"): (True, 0, 4),
        ("2026-08-05T06:15:00+08:00", "15 6-11 * * *"): (True, 20700, 12),
        ("2026-08-05T11:55:00+08:00", "15 6-11 * * *"): (True, 300, 12),
        ("2026-08-05T13:54:00+08:00", "15 6-11 * * *"): (True, 0, 12),
        ("2026-08-05T14:15:00+08:00", "15 14-19 * * *"): (True, 20700, 20),
        ("2026-08-05T20:45:00+08:00", "15 14-19 * * *"): (True, 0, 20),
    }
    for (value, schedule), (expected_window, expected_wait, expected_hour) in cases.items():
        now = datetime.fromisoformat(value)
        target = target_for_attempt(now, schedule)
        actual_window = is_target_window(now, target)
        actual_wait = (
            max(0, math.ceil((target - now).total_seconds()))
            if actual_window
            else 0
        )
        actual = (actual_window, actual_wait, target.hour)
        expected = (expected_window, expected_wait, expected_hour)
        if actual != expected:
            raise AssertionError(
                f"{value} ({schedule}): expected {expected}, got {actual}"
            )
    target = datetime.fromisoformat("2026-08-05T12:00:00+08:00")
    assert not target_is_complete(target, datetime.fromisoformat("2026-08-05T11:59:59+08:00"))
    assert target_is_complete(target, datetime.fromisoformat("2026-08-05T12:00:00+08:00"))
    assert target_is_complete(target, datetime.fromisoformat("2026-08-05T12:01:00+08:00"))
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
    schedule = os.environ.get("GITHUB_EVENT_SCHEDULE", "")
    target = target_for_attempt(now, schedule)
    if not is_target_window(now, target):
        write_output(False, "outside-target-window")
        return
    wait_seconds = max(0, math.ceil((target - now).total_seconds()))
    if wait_seconds:
        write_output(True, "wait-for-taipei-target", wait_seconds)
        return
    updated_at = live_data_updated_at(now)
    if target_is_complete(target, updated_at):
        updated_label = updated_at.astimezone(TAIPEI).isoformat(timespec="minutes") if updated_at else "unknown"
        write_output(False, f"target-already-complete-{updated_label}")
        return
    write_output(True, f"target-{target.isoformat(timespec='minutes')}-needs-update")


if __name__ == "__main__":
    main()
