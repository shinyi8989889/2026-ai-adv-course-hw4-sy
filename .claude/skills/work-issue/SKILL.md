---
name: work-issue
description: Use when the user runs /work-issue <issue-number>, or asks to "work on issue #N" / "處理 Issue #N" / "接手 Issue #N" in this repo. Autonomously implements a single ready GitHub issue end-to-end — verifies it's ready and owned by the caller, branches from main, implements with tests, runs the test-runner subagent, updates docs/openapi.json, opens a PR that closes the issue, and runs security-reviewer/code-reviewer subagents against the PR, fixing only High-severity findings. Stops before merging — never merges, closes, or deletes branches.
---

# Work Issue

處理單一 GitHub Issue 的標準流程：從「確認這個 Issue 可以做」一路做到「PR 開好、審查完成」為止。**不含合併 PR**——合併一律由人工執行。

## 輸入

呼叫時附帶的文字（例如 `/work-issue 3`）即為 Issue 編號。如果沒有附編號，用 AskUserQuestion 或直接詢問使用者要處理哪一個 Issue，不要自行猜測或挑一個看起來像的 Issue 來做。一次呼叫只處理一個編號；若使用者一次給多個編號，依序逐一完整跑完整個流程，不要並行處理（會互相干擾 git 工作目錄與分支）。

## 前置條件檢查（任一不符合就停下，不要往下做）

用 `gh issue view <編號> --json number,title,author,body,labels,state` 讀取 Issue，確認：

1. Issue 狀態為 `OPEN`
2. 標籤中包含 `ready`
3. `author.login` 等於目前登入帳號（`gh auth status` 顯示的帳號）——也就是使用者本人開的 Issue
4. 工作目錄所在的是一個乾淨可操作的 git repo（執行 `git status`；若有既有、與本次無關的未提交變更，不要清掉它，繞過即可，但後面 commit 時絕不要把它一併加入）

只要有一項不符合，**不要**把標籤改成 `in-progress`，直接停下來，跟使用者說明具體原因（例如：Issue 不存在、沒有 `ready` 標籤、不是你開的、已經 CLOSED）。

## 步驟

1. **讀 Issue、標記進度**
   - 完整讀過 Issue 內文：功能說明、規則/規格、驗收條件、對應的驗收測試檔名（通常在 `tests/acceptance/` 下，描述會附規格附錄位置）
   - 前置條件都通過後：`gh issue edit <編號> --remove-label ready --add-label in-progress`

2. **從最新 main 開分支**
   - `git fetch origin && git checkout main && git pull origin main --ff-only`
   - 分支命名 `issue-<編號>-<簡短名稱>`（英文或拼音，例如 `issue-1-coupon`），`git checkout -b` 建立

3. **實作**
   - 動手前先讀過相關既有程式碼（對應的 routes / services / utils / schema），盡量比照專案既有模式與慣例（例如純邏輯規則集中在 `src/utils/`，不依賴 Express 或 DB，可獨立單元測試）
   - 若需要新增/修改資料表欄位，記得同時處理兩處：(a) `CREATE TABLE` 定義本身（供全新安裝），(b) 既有資料庫的 `ALTER TABLE ... ADD COLUMN` 遷移（供已存在的 `database.sqlite` 升級用）
   - **補上 Unit 或 Integration Test**：新的純邏輯模組至少要有單元測試；新增/修改的路由行為要在對應的 `tests/*.test.js` 或 `tests/integration/` 補上案例
   - 實作過程中可以自己先跑 `npm run test:unit`（必要時 `test:integration`）驗證邏輯，但正式驗證一律走下一步的 test-runner，不要只憑自己跑過就跳過第 4 步

4. **派 test-runner 跑測試**
   - 用 Agent 工具、`subagent_type: "test-runner"`，請它依序執行並各自回報結果：
     1. `npm run test:unit`
     2. `npm run test:integration`
     3. 這個 Issue 對應的驗收測試：`npm run test:acceptance -- <關鍵字>`（關鍵字取自驗收測試檔名；不確定對應哪個檔案時，先用 Read 查 `docs/TESTING.md` 或 `tests/acceptance/` 目錄裡的 Issue 對照表，不要用 Bash 以外的方式猜測）
   - 有失敗項目就回頭修正、重新派 test-runner 驗證，重複到三者全數通過為止
   - 若反覆修正後仍有測試卡住過不了，停下來，把標籤改成 `needs-human`，跟使用者說明卡在哪個測試、已經嘗試過什麼，不要勉強開 PR 交差

5. **更新文件與 OpenAPI**
   - 至少更新 `docs/FEATURES.md`（功能總覽表一行 + 對應章節的請求/回應欄位、業務邏輯步驟、錯誤碼表）
   - 視改動範圍更新 `docs/ARCHITECTURE.md`（新模組、新欄位、流程圖步驟）與 `docs/CHANGELOG.md`（在 `## [Unreleased]` 底下加條目）
   - 若 `test:unit` 測試數量有變化，順手同步 `docs/README.md`、`docs/TESTING.md` 中提到的測試數字
   - 若路由的 request/response schema 有變動，更新對應路由檔案裡的 `@openapi` JSDoc 註解，再執行 `npm run openapi` 重新產生 `openapi.json`，一併 commit

6. **開 PR**
   - `git add` 時明確列出本次相關檔案，不要用 `git add -A` 或 `git add .`，避免夾帶無關的既有未提交變更
   - `git push -u origin <branch>`
   - `gh pr create --base main --head <branch>`：標題簡短描述這個 Issue 做了什麼；body 至少包含 Summary（條列改動）與 Test plan（三個測試指令與通過數量），並在 body 中寫上 `Closes #<編號>`

7. **派 reviewer 審查 PR**
   - 同一則訊息中平行派 `subagent_type: "security-reviewer"` 與 `subagent_type: "code-reviewer"`，各自給：PR 編號、分支名稱、本次改動的核心檔案清單、Issue 規格摘要（兩位都只有唯讀工具，不會動到程式碼）
   - **只修正「高（High）」嚴重度的問題**；Medium／Low 一律原樣記錄下來回報給使用者，不要自行動手改（避免這次 PR 範圍不受控地擴大）
   - 有 High 問題時：修正 → 回到第 4 步重跑三項測試確認沒壞掉 → commit → push（同一個 PR 會自動更新，不必重開）→ 視情況可再派一次 reviewer 複查修正是否妥當
   - reviewer 若因為沒有 Bash 工具而無法直接看 diff，可以自己用 `git diff main...<branch> -- <path>` 做關鍵檔案的複核（例如確認驗收測試檔案零改動）

8. **收尾**
   - `gh issue edit <編號> --remove-label in-progress --add-label in-review`
   - 跟使用者總結：Issue 編號/標題、分支名稱、PR 連結、三項測試的通過情況、更新了哪些文件、reviewer 的發現（含未處理的 Medium/Low，讓使用者自行決定要不要後續處理）
   - **做到這裡就停下**，等待人工檢視與合併

## 邊界（這個 Skill 不做的事）

- **不合併 PR**、不 squash、不 rebase 到 main、不關閉 Issue、不刪除分支——合併永遠是人工的事，這是這個 Skill 最重要的邊界
- 不修改 `tests/acceptance/` 底下任何檔案（驗收測試由他人提供，規則明確禁止修改）
- 不修正 reviewer 回報中 Medium 或 Low 等級的問題，只處理 High
- 不把不相關的既有未提交變更（例如單純跑過 `npm install` 產生的 `package-lock.json` 差異）一併加入這次的 commit
- 不略過前置條件檢查；Issue 沒有 `ready` 標籤、不是使用者本人開的、或已關閉，一律停下來問清楚，不要自作主張開始做
- 不使用 `--no-verify`、`--force`、`git reset --hard` 等略過保護機制或會遺失工作的指令
- 一次只處理一個 Issue，不在同一次呼叫裡並行處理多個編號
- 測試反覆修正仍無法全數通過時，不要硬開 PR 充數，改標籤成 `needs-human` 並停下說明
