# 台灣基金雷達

一個台灣基金篩選網站原型。網站會優先讀取 `data/funds.json`，重點是完成「設定條件、篩選基金、排序、比較、自動更新資料」的使用流程。

## 使用方式

直接開啟 `index.html` 即可使用。若想用本機伺服器：

```sh
python3 -m http.server 8000
```

然後開啟 `http://localhost:8000`。

## 自動更新

更新器是 `update_funds.py`。它會從設定檔指定的 JSON URL 抓資料，驗證欄位後寫入 `data/funds.json`。

## 線上部署

建議部署到 GitHub Pages。網站是靜態檔案，Python 更新器會由 GitHub Actions 在 GitHub 雲端執行，不需要你的 MacBook 開著。

預設資料來源是兆豐基金/MoneyDJ 國內基金公開資料，涵蓋多家台灣投信的境內基金。更新器會抓取報酬率、年化標準差、Sharpe、基金規模與 RR 等級，然後寫入 `data/funds.json`。

流程：

1. 建立一個 GitHub repository，將本專案推上去。
2. 到 repository 的 `Settings` -> `Pages`，把 `Build and deployment` 的 source 設成 `GitHub Actions`。
3. 如要使用自訂資料來源，到 `Settings` -> `Secrets and variables` -> `Actions` 設定：
   - `FUND_SOURCE_URL`: 真實基金資料 JSON/API URL。可用 secret 或 variable。
   - `FUND_SOURCE_NAME`: 顯示在網站上的資料來源名稱。可用 variable。
4. 到 `Actions` 手動執行 `Update data and deploy Pages` 一次。

之後 `.github/workflows/pages.yml` 會每 3 小時自動執行一次，一天 8 次：

```yaml
schedule:
  - cron: "0 */3 * * *"
```

GitHub Actions 的 cron 使用 UTC。若用台灣時間看，這個設定仍然是每 3 小時一次，只是執行時間會對應到 UTC。

如果沒有設定 `FUND_SOURCE_URL`，workflow 會改抓兆豐基金/MoneyDJ 國內基金公開資料。設定 `FUND_SOURCE_URL` 之後，才會改用你的自訂 JSON/API 來源。

先建立設定檔：

```sh
cp config/source.example.json config/source.json
```

把 `config/source.json` 裡的 `sourceUrl` 改成你的基金資料來源。資料來源需要回傳 JSON 陣列，或回傳含有 `funds` 陣列的 JSON 物件。

手動更新一次：

```sh
python3 update_funds.py --config config/source.json --once
```

每 3 小時自動更新一次，一天 8 次：

```sh
python3 update_funds.py --config config/source.json --watch
```

使用預設國內基金資料更新一次：

```sh
python3 update_funds.py --provider megabank-tw-funds --once
```

使用元大基金資料更新一次：

```sh
python3 update_funds.py --provider yuanta-funds --once
```

使用 Yahoo Finance 台灣 ETF 市場資料更新一次：

```sh
python3 update_funds.py --provider yahoo-tw-etf --once
```

正式部署時建議用系統排程執行 `--once`，例如 cron：

```cron
0 */3 * * * cd /path/to/new-chat && python3 update_funds.py --config config/source.json --once
```

## 資料欄位

`data/funds.json` 和資料匯入區都接受 JSON 陣列。每筆基金需包含：

```json
{
  "name": "基金名稱",
  "company": "投信公司",
  "type": "台股",
  "region": "台灣",
  "risk": 4,
  "return3y": 8.2,
  "fee": 1.1,
  "volatility": 14.8,
  "sharpe": 0.62,
  "aum": 320,
  "dividend": "累積型",
  "minRsp": 3000,
  "tags": ["電子", "大型股"]
}
```

也可以使用含 metadata 的格式：

```json
{
  "source": "基金資料供應商",
  "updatedAt": "2026-06-25T12:00:00+08:00",
  "funds": []
}
```

## 真實資料來源建議

- 投信投顧公會：https://www.sitca.org.tw/
- 基金資訊觀測站：https://announce.fundclear.com.tw/MOPSFundWeb/

匯入真實資料前，建議保留資料日期與來源欄位。基金績效、淨值、費用率與風險等級都會變動，本專案不構成投資建議。
