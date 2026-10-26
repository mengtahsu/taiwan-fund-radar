import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update_funds as updater

spec = importlib.util.spec_from_file_location("twii_backfill", Path(__file__).with_name("backfill-twii-history.py"))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


def chart(rows):
    return {"chart": {"result": [{
        "timestamp": [int(datetime.fromisoformat(row["date"]).replace(tzinfo=timezone.utc).timestamp()) for row in rows],
        "indicators": {"quote": [{"close": [row["close"] for row in rows]}]},
    }]}}


class TwiiHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = []
        date = datetime(1984, 9, 1)
        while date < datetime(2026, 1, 1):
            if date.weekday() < (6 if date.year <= 2000 else 5):
                rows.append({"date": date.date().isoformat(), "close": round(1000 + len(rows) * 0.37, 2)})
            date += timedelta(days=1)
        cls.archive = [row for row in rows if row["date"] < "2001-01-01"]
        cls.existing = [row for row in rows if row["date"] >= "1985-01-01"]

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "data").mkdir()
        (self.root / "data/twii_history_archive.json").write_text(json.dumps({"items": self.archive}))
        self.write_existing(self.existing)

    def write_existing(self, rows):
        (self.root / "data/twii_history.json").write_text(json.dumps({"items": rows}))

    def test_daily_refresh_retains_old_years_saturdays_and_warmup(self):
        corrected = {**self.existing[-1], "close": 5432.1}
        # A recent feed cannot overwrite the verified historical archive.
        with patch.object(updater, "fetch_yahoo_chart_range", return_value=chart([self.archive[100] | {"close": 1}, corrected])) as fetch:
            payload = updater.build_twii_trend_payload(self.root)
        fetch.assert_called_once_with("^TWII", days=updater.TWII_TREND_FETCH_DAYS)
        self.assertEqual(payload["items"][-1]["close"], corrected["close"])
        self.assertEqual(payload["items"][0]["date"], "1985-01-01")
        self.assertTrue(any(datetime.fromisoformat(row["date"]).weekday() == 5 for row in payload["items"][:100]))
        first_index = next(index for index, row in enumerate(self.archive) if row["date"] == "1985-01-01")
        for window in [20, 60]:
            expected = sum(Decimal(str(row["close"])) for row in self.archive[first_index - window + 1:first_index + 1]) / window
            self.assertEqual(payload["items"][0][f"ma{window}"], float(expected.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
        self.assertEqual(payload["items"][100]["close"], self.existing[100]["close"])

    def test_first_upgrade_fetches_the_gap_after_the_archive(self):
        self.write_existing([row for row in self.existing if row["date"] >= "2020-01-01"])
        gap = [row for row in self.existing if row["date"] > "2000-12-31"]
        with patch.object(updater, "fetch_yahoo_chart_range", return_value=chart(gap)) as fetch:
            payload = updater.build_twii_trend_payload(self.root)
        self.assertGreater(fetch.call_args.kwargs["days"], updater.TWII_TREND_FETCH_DAYS)
        self.assertTrue(any(row["date"].startswith("2005-") for row in payload["items"]))

    def test_missing_year_or_empty_feed_cannot_overwrite_saved_history(self):
        rows = [row for row in self.existing if not row["date"].startswith("2010-")]
        self.write_existing(rows)
        target = self.root / "data/twii_history.json"
        saved = target.read_bytes()
        with patch.object(updater, "fetch_yahoo_chart_range", return_value=chart(rows[-1:])):
            with self.assertRaisesRegex(ValueError, "incomplete for 2010"):
                updater.update_twii_trend_once(self.root)
        self.assertEqual(target.read_bytes(), saved)
        with patch.object(updater, "fetch_yahoo_chart_range", return_value={"chart": {"result": []}}):
            with self.assertRaisesRegex(ValueError, "no rows"):
                updater.update_twii_trend_once(self.root)
        self.assertEqual(target.read_bytes(), saved)

    def test_legacy_archive_rejects_conflicting_versions(self):
        with self.assertRaisesRegex(ValueError, "conflicting"):
            backfill.parse_archive("[new Date('1985/01/04'),829.9],[new Date('1985/01/04'),800]")

    def test_average_rounding_ties_are_stable(self):
        self.assertEqual(updater.moving_average([1, 1.01, 1.02], 2), [None, 1.01, 1.02])

    def test_recent_authoritative_range_removes_cached_phantom_session(self):
        phantom = {"date": "2025-12-28", "close": 9000}
        self.write_existing(sorted([*self.existing, phantom], key=lambda row: row["date"]))
        with patch.object(updater, "fetch_yahoo_chart_range", return_value=chart(self.existing[-70:])):
            payload = updater.build_twii_trend_payload(self.root)
        self.assertNotIn(phantom["date"], [row["date"] for row in payload["items"]])
        expected = sum(Decimal(str(row["close"])) for row in self.existing[-60:]) / 60
        self.assertEqual(payload["items"][-1]["ma60"], float(expected.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))


if __name__ == "__main__":
    unittest.main()
