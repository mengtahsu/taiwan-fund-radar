import importlib.util
import unittest
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
        with patch.object(updater, "has_recent_nav_date", return_value=True), patch.object(updater, "requested_nav_fund_ids", return_value=requested):
            selected = updater.nav_refresh_candidates(funds, {}, 50)
            selected = updater.prioritize_requested_nav_candidates(funds, selected, 50)
        ids = [fund["fundId"] for fund in selected]
        self.assertEqual(len(ids), 50)
        self.assertEqual(len(set(ids)), 50)
        self.assertTrue(set(requested).issubset(ids))
        self.assertTrue({fund["fundId"] for fund in broader[:20]}.issubset(ids))
        self.assertEqual(sum(f"SCREEN{i}" in ids for i in range(38, 50)), 10)

    def test_zero_budget_never_fetches(self):
        with patch.object(updater, "has_recent_nav_date", return_value=True):
            self.assertEqual(updater.nav_refresh_candidates([{"fundId": "TEST"}], {}, 0), [])


if __name__ == "__main__":
    unittest.main()
