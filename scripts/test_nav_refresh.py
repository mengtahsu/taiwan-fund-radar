import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("update_funds", Path(__file__).resolve().parents[1] / "update_funds.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class NavRefreshTests(unittest.TestCase):
    def test_screened_gaps_are_not_starved_by_the_broader_ranking(self):
        broader = [
            {"fundId": f"OTHER{i}", "return3m": 1000 - i, "return3y": 10, "risk": 4, "type": "基金"}
            for i in range(120)
        ]
        screened = [
            {"fundId": f"SCREEN{i}", "return3m": 100 - i, "return3y": 25, "risk": 4, "type": "基金",
             **({"return1m": 0, "return2w": 0} if i < 38 else {})}
            for i in range(50)
        ]
        owned = [{"fundId": f"OWNED{i}"} for i in range(20)]
        funds = broader + screened + owned
        requested = [fund["fundId"] for fund in owned]
        with patch.object(updater, "has_recent_nav_date", return_value=True):
            selected = updater.nav_refresh_candidates(funds, {}, 50, requested)
        ids = [fund["fundId"] for fund in selected]
        self.assertEqual(len(ids), 50)
        self.assertEqual(len(set(ids)), 50)
        self.assertTrue(set(requested).issubset(ids))
        self.assertTrue({fund["fundId"] for fund in screened[:20]}.issubset(ids))
        self.assertEqual(sum(f"SCREEN{i}" in ids for i in range(38, 50)), 10)

    def test_zero_budget_never_fetches(self):
        with patch.object(updater, "has_recent_nav_date", return_value=True):
            self.assertEqual(updater.nav_refresh_candidates([{"fundId": "TEST"}], {}, 0), [])

    def test_recovery_uses_budget_for_missing_returns_instead_of_refetching_leaders(self):
        funds = [
            {"fundId": f"SCREEN{i}", "return3m": 100 - i, "return3y": 25, "risk": 4,
             **({"return1m": 0, "return2w": 0} if i < 20 else {})}
            for i in range(50)
        ]
        now = updater.datetime.now(updater.timezone.utc).isoformat()
        cache = {"items": {f"SCREEN{i}": {"fetchedAt": now} for i in range(20)}}
        with patch.object(updater, "has_recent_nav_date", return_value=True):
            selected = updater.nav_refresh_candidates(funds, cache, 30)
        self.assertEqual({fund["fundId"] for fund in selected}, {f"SCREEN{i}" for i in range(20, 50)})

    def test_three_updates_per_day_cover_all_120_candidates_within_two_days(self):
        clock = datetime(2026, 10, 27, 20, tzinfo=timezone.utc)

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.astimezone(tz) if tz else clock.replace(tzinfo=None)

        leaders = [
            {"fundId": f"F{i:03}", "type": "基金", "risk": 4, "return3y": 25, "nav": 100,
             "volatility": 20, "return3m": 120 - i, "return6m": 10, "return1y": 20}
            for i in range(120)
        ]
        owned = [
            {"fundId": f"O{i:02}", "type": "基金", "risk": 4, "return3y": 10, "nav": 100,
             "volatility": 20, "return3m": -50, "return6m": 0, "return1y": 0}
            for i in range(20)
        ]
        requests = [{"fund_id": fund["fundId"], "requested_at": clock.isoformat()} for fund in owned]
        cache = {"items": {fund["fundId"]: {
            "fetchedAt": clock.isoformat(), "return1m": 0, "return2w": 0
        } for fund in leaders}}
        seen = set()
        with patch.object(updater, "datetime", Clock), patch.object(updater, "has_recent_nav_date", return_value=True), \
             patch.object(updater, "requested_nav_requests", return_value=requests):
            for run in range(30):
                clock += timedelta(hours=8)
                funds = [dict(fund) for fund in leaders + owned]
                updater.apply_nav_cache(funds, cache)
                pending = updater.requested_nav_fund_ids(cache)
                selected = updater.nav_refresh_candidates(funds, cache, 50, pending)
                ids = [fund["fundId"] for fund in selected]
                self.assertLessEqual(len(ids), 50)
                self.assertEqual(len(ids), len(set(ids)))
                self.assertTrue({fund["fundId"] for fund in leaders[:20]}.issubset(ids))
                seen.update(ids)
                for fund_id in ids:
                    cache["items"][fund_id] = {"fetchedAt": clock.isoformat(), "return1m": 0, "return2w": 0}
                if run >= 5:
                    for fund in leaders:
                        age = clock - updater.parse_iso_datetime(cache["items"][fund["fundId"]]["fetchedAt"])
                        self.assertLessEqual(age, timedelta(hours=48), fund["fundId"])
            self.assertTrue({fund["fundId"] for fund in leaders}.issubset(seen))
            final = [dict(fund) for fund in leaders]
            updater.apply_nav_cache(final, cache)
            self.assertTrue(all(fund.get("return1m") is not None for fund in final))

    def test_completed_request_requeues_on_new_request_or_after_one_day(self):
        now = datetime.now(timezone.utc)
        requests = [{"fund_id": "OWNED", "requested_at": (now - timedelta(hours=2)).isoformat()}]
        cache = {"items": {"OWNED": {"fetchedAt": (now - timedelta(hours=1)).isoformat()}}}
        with patch.object(updater, "requested_nav_requests", return_value=requests):
            self.assertEqual(updater.requested_nav_fund_ids(cache), [])
            requests[0]["requested_at"] = now.isoformat()
            self.assertEqual(updater.requested_nav_fund_ids(cache), ["OWNED"])
            requests[0]["requested_at"] = (now - timedelta(days=3)).isoformat()
            cache["items"]["OWNED"]["fetchedAt"] = (now - timedelta(hours=25)).isoformat()
            self.assertEqual(updater.requested_nav_fund_ids(cache), ["OWNED"])

    def test_history_rotation_does_not_skip_entries_after_owned_priority(self):
        funds = [{"fundId": f"F{i}", "return3y": 25} for i in range(60)]
        owned = [{"fundId": f"O{i}"} for i in range(20)]
        cache = {"items": {}}
        selected = updater.monthly_nav_candidates(funds + owned, cache, 20, [fund["fundId"] for fund in owned])
        self.assertEqual({fund["fundId"] for fund in selected}, {fund["fundId"] for fund in owned})
        seen = set()
        for run in range(3):
            for fund in selected:
                cache["items"][fund["fundId"]] = {"fetchedAt": datetime.now(timezone.utc).isoformat()}
            selected = updater.monthly_nav_candidates(funds + owned, cache, 20)
            seen.update(fund["fundId"] for fund in selected)
        self.assertTrue({fund["fundId"] for fund in funds}.issubset(seen))

    def test_dynamic_rankings_and_repeated_requests_cannot_starve_the_pool(self):
        clock = datetime(2026, 10, 27, 20, tzinfo=timezone.utc)

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.astimezone(tz) if tz else clock.replace(tzinfo=None)

        leaders = [{"fundId": f"F{i:03}", "risk": 4, "return3y": 25, "return1m": 0, "return2w": 0} for i in range(120)]
        owned = [{"fundId": f"O{i:02}", "risk": 4, "return3y": 10, "return3m": -100} for i in range(20)]
        cache = {"items": {fund["fundId"]: {"fetchedAt": clock.isoformat(), "return1m": 0, "return2w": 0} for fund in leaders}}
        requests = [{"fund_id": fund["fundId"], "requested_at": clock.isoformat()} for fund in owned]
        with patch.object(updater, "datetime", Clock), patch.object(updater, "has_recent_nav_date", return_value=True), \
             patch.object(updater, "requested_nav_requests", return_value=requests):
            for run in range(90):
                clock += timedelta(hours=8)
                funds = [{**fund, "return3m": (index + run * 7) % 120 + 1} for index, fund in enumerate(leaders)] + owned
                for request in requests:
                    request["requested_at"] = clock.isoformat()
                requested = updater.requested_nav_fund_ids(cache)
                selected = updater.nav_refresh_candidates(funds, cache, 50, requested)
                self.assertLessEqual(len(selected), 50)
                for fund in selected:
                    cache["items"][fund["fundId"]] = {"fetchedAt": clock.isoformat(), "return1m": 0, "return2w": 0}
                if run >= 5:
                    for fund in leaders:
                        age = clock - updater.parse_iso_datetime(cache["items"][fund["fundId"]]["fetchedAt"])
                        self.assertLessEqual(age, timedelta(hours=48), fund["fundId"])
                    for fund in owned:
                        age = clock - updater.parse_iso_datetime(cache["items"][fund["fundId"]]["fetchedAt"])
                        self.assertLessEqual(age, timedelta(hours=24), fund["fundId"])

    def test_insufficient_quota_is_rejected_instead_of_silently_skipping_funds(self):
        funds = [{"fundId": f"F{i}", "risk": 4, "return3y": 25} for i in range(120)]
        with patch.object(updater, "has_recent_nav_date", return_value=True):
            with self.assertRaisesRegex(ValueError, "need at least 37"):
                updater.nav_refresh_candidates(funds, {}, 30)

    def test_persistent_missing_top_fifty_cannot_starve_the_remaining_pool(self):
        clock = datetime(2026, 10, 27, 20, tzinfo=timezone.utc)

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.astimezone(tz) if tz else clock.replace(tzinfo=None)

        funds = [{"fundId": f"F{i:03}", "risk": 4, "return3y": 25, "return3m": 120 - i,
                  **({"return1m": 0} if i >= 50 else {})} for i in range(120)]
        cache = {"items": {}}
        seen = set()
        with patch.object(updater, "datetime", Clock), patch.object(updater, "has_recent_nav_date", return_value=True):
            for _ in range(6):
                selected = updater.nav_refresh_candidates(funds, cache, 50)
                for fund in selected:
                    seen.add(fund["fundId"])
                    cache["items"][fund["fundId"]] = {"fetchedAt": clock.isoformat()}
                clock += timedelta(hours=8)
        self.assertEqual(len(seen), 120)

    def test_older_cache_cannot_replace_newer_nav_and_one_month_is_independent(self):
        now = datetime.now(timezone.utc).isoformat()
        funds = [{"fundId": "TEST", "nav": 120, "navDate": "10/29"}]
        cache = {"items": {"TEST": {"fetchedAt": now, "nav": 110, "navDate": "10/28", "return1m": 20}}}
        updater.apply_nav_cache(funds, cache)
        self.assertEqual(funds[0]["nav"], 120)
        self.assertEqual(funds[0]["navDate"], "10/29")
        self.assertEqual(funds[0]["return1m"], 20)
        self.assertIsNone(updater.nav_date_age_days("99/99"))

    def test_cache_restoration_keeps_one_month_without_two_week_data(self):
        now = datetime.now(timezone.utc).isoformat()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/nav_cache.json").write_text(json.dumps({"items": {"TEST": None}}))
            (root / "data/funds.json").write_text(json.dumps({"updatedAt": now, "funds": [{"fundId": "TEST", "return1m": 12}]}))
            cache = updater.load_nav_cache(root)
        funds = [{"fundId": "TEST"}]
        updater.apply_nav_cache(funds, cache)
        self.assertEqual(funds[0]["return1m"], 12)

    def test_failed_attempt_does_not_extend_the_lifetime_of_expired_returns(self):
        now = datetime.now(timezone.utc)
        cache = {"items": {"TEST": {"return1m": 12, "fetchedAt": (now - timedelta(hours=73)).isoformat(),
                                    "attemptedAt": now.isoformat()}}}
        funds = [{"fundId": "TEST"}]
        updater.apply_nav_cache(funds, cache)
        self.assertNotIn("return1m", funds[0])

    def test_failed_fetch_keeps_last_good_data_and_does_not_mark_it_fresh(self):
        fetched_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        fund = {"fundId": "TEST", "nav": 110, "navDate": "10/28", "return1m": 10}
        cache = {"items": {"TEST": {"fetchedAt": fetched_at, "nav": 110, "navDate": "10/28", "return1m": 10}}}
        with patch.object(updater, "load_nav_cache", return_value=cache), \
             patch.object(updater, "requested_nav_fund_ids", return_value=[]), \
             patch.object(updater, "nav_refresh_candidates", return_value=[fund]), \
             patch.object(updater, "fetch_moneydj_bcd_nav", side_effect=RuntimeError("temporary source error")), \
             patch.object(updater, "atomic_write_json"):
            updater.enrich_recent_fund_returns([fund])
        saved = cache["items"]["TEST"]
        self.assertEqual(saved["fetchedAt"], fetched_at)
        self.assertEqual(saved["nav"], 110)
        self.assertEqual(saved["return1m"], 10)
        self.assertIn("attemptedAt", saved)

    def test_failing_fund_does_not_block_other_missing_funds(self):
        now = datetime.now(timezone.utc).isoformat()
        funds = [{"fundId": f"F{i}", "risk": 4, "return3y": 25} for i in range(5)]
        cache = {"items": {"F0": {"attemptedAt": now, "lastError": "source unavailable"}}}
        with patch.object(updater, "has_recent_nav_date", return_value=True), \
             patch.dict(updater.os.environ, {"RECENT_NAV_ALWAYS_REFRESH_TOP": "0"}):
            selected = updater.nav_refresh_candidates(funds, cache, 1)
        self.assertEqual(selected[0]["fundId"], "F1")

    def test_one_month_return_uses_the_newer_mobile_endpoint(self):
        fund = {"fundId": "TEST", "nav": 110, "navDate": "10/27"}
        cache = {"items": {}}
        series = [(datetime(2026, 9, 29), 100), (datetime(2026, 10, 27), 110)]
        with patch.object(updater, "load_nav_cache", return_value=cache), \
             patch.object(updater, "requested_nav_fund_ids", return_value=[]), \
             patch.object(updater, "nav_refresh_candidates", return_value=[fund]), \
             patch.object(updater, "fetch_moneydj_bcd_nav", return_value=series), \
             patch.object(updater, "fetch_moneydj_mobile_latest_nav", return_value=(datetime(2026, 10, 29), 120)), \
             patch.object(updater, "atomic_write_json"):
            updater.enrich_recent_fund_returns([fund])
        self.assertEqual(fund["return1m"], 20)
        self.assertEqual(fund["return1mEndDate"], "2026-10-29")
        self.assertEqual(len(series), 2, "shared historical source data must not be mutated")


if __name__ == "__main__":
    unittest.main()
