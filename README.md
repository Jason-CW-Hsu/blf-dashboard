# blf-dashboard

勞動基金月度自動更新與視覺化儀表板。

## 每月操作（只需 GitHub 網頁）

1. 在 GitHub repository 開啟 `incoming`。
2. 建立一個新資料夾，名稱為 `YYYYMM`，例如 `202607`。
3. 在該資料夾一次上傳三份 PDF：檔名須分別含有「勞工退休基金」、「勞工保險基金」及「國民年金保險基金」。
4. 按 **Commit changes**。
5. 到 **Actions** 查看 `Update monthly dashboard from PDFs`；綠色勾勾代表已完成。
6. 約 2–5 分鐘後，GitHub Pages 網站自動更新；新版 Excel 位於 `downloads/勞動基金月度揭露_可持續更新.xlsx`。

## 第一次設定

在 GitHub repository 的 **Settings → Pages → Source** 選擇 **GitHub Actions**。

## 安全檢核

工作流程會拒絕發布下列情況：缺少任一 PDF、找不到資產配置合計，或委外明細少於 270 筆。遇到紅色叉叉時，舊網站與既有 Excel 不會被覆蓋。
