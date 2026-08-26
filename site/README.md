# 私有 GitHub Pages 部署

此網站由 `site/index.html` 提供。建立組織擁有的私有 repository 後，推送至 `main` 即會由 `.github/workflows/deploy-pages.yml` 部署。

在 GitHub 的 **Settings → Pages** 將站台可見性設為 **Private**，並只授予需要閱覽者 repository 的 Read 權限。GitHub 私有 Pages 需使用 GitHub Enterprise Cloud；若未具備此方案，需改採具身分驗證的 Cloudflare Pages、Azure Static Web Apps 或內部網頁主機。
