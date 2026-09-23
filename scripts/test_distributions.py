import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_funds import parse_moneydj_distributions, fetch_fund_distributions
from datetime import datetime


def page(rows, fund_id="TESTB"):
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
    return f"""<a href="javascript:addWatchList('{fund_id}')">Watch</a>
    <table id="a5_table"><thead><tr><td><span>除息日</span></td><td>幣別</td>
    <td>息值</td><td>年化配息率%</td></tr></thead><tbody>{body}</tbody></table>"""


class DistributionTests(unittest.TestCase):
    def test_reads_cash_not_annual_yield(self):
        events = parse_moneydj_distributions(page([["2026/08/05", "台幣", "0.5200", "10.04"]]), "TESTB")
        self.assertEqual(events, [{"date": "2026-08-05", "amount": 0.52}])

    def test_rejects_wrong_class_or_missing_table(self):
        for text in [page([], "TESTA"), "<html>Unavailable</html>", page([])]:
            with self.assertRaises(ValueError):
                parse_moneydj_distributions(text, "TESTB")

    def test_rejects_malformed_rows(self):
        for row in [["2026/08/05", "美元", "0.5", "10"], ["2026/02/31", "台幣", "0.5", "10"],
                    ["2026/08/05", "台幣", "-1", "10"], ["2026/08/05", "台幣", "NaN", "10"],
                    ["2026/08/05", "台幣", "0.5"]]:
            with self.assertRaises(ValueError):
                parse_moneydj_distributions(page([row]), "TESTB")

    def test_deduplicates_and_rejects_conflicts(self):
        row = ["2026/08/05", "台幣", "0.52", "10.04"]
        self.assertEqual(len(parse_moneydj_distributions(page([row, row]), "TESTB")), 1)
        with self.assertRaises(ValueError):
            parse_moneydj_distributions(page([row, ["2026/08/05", "台幣", "0.53", "10.04"]]), "TESTB")

    def test_exact_ex_nav_and_contiguous_history(self):
        previous = {"fundId": "TESTB", "events": [
            {"date": "2026-02-06", "amount": 0.34, "exNav": 15},
            {"date": "2026-05-11", "amount": 0.39, "exNav": 18}
        ]}
        html = page([["2026/08/05", "台幣", "0.52", "10"], ["2026/05/11", "台幣", "0.39", "10"]])
        with patch("update_funds.fetch_text", return_value=html):
            result = fetch_fund_distributions("TESTB", [(datetime(2026, 8, 5), 20), (datetime(2026, 5, 12), 19)], previous)
        self.assertEqual(result["coverageStart"], "2026-02-06")
        self.assertEqual(result["events"][-1]["exNav"], 20)
        self.assertNotIn("exNav", result["events"][1])
        self.assertEqual(result["events"][0]["exNav"], 15)

    def test_history_gap_cannot_claim_complete_coverage(self):
        with patch("update_funds.fetch_text", return_value=page([["2026/08/05", "台幣", "0.52", "10"]])):
            result = fetch_fund_distributions("TESTB", [], {"fundId": "TESTB", "events": [{"date": "2020-01-01", "amount": 1}]})
        self.assertEqual(result["coverageStart"], "2026-08-05")


if __name__ == "__main__":
    unittest.main()
