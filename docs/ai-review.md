# AI Review：訂單 / 付款 / 運費 / 購物車

本報告由三個 subagent（`security-reviewer`、`code-reviewer`、`test-runner`）於 2026-10-25 分工產出，審查階段僅做唯讀審查與測試執行、未修改任何程式碼。**修正階段（同日稍後）已由主 agent 依本報告逐項修正**，詳見每個問題下的「修正狀態」。

- 審查範圍：`src/routes/{orderRoutes,adminOrderRoutes,cartRoutes,pageRoutes,authRoutes}.js`、`src/services/{orderService,paymentService}.js`、`src/utils/{ecpay,shipping,validators}.js`、`src/middleware/{authMiddleware,sessionMiddleware,adminMiddleware}.js`、`src/database.js`、`app.js`、`errorHandler.js`，以及對應的 `tests/` 測試檔案（unit、integration、acceptance）。
- 分工：`security-reviewer` 負責權限控管／身分驗證／金流驗證／輸入驗證；`code-reviewer` 負責業務邏輯與邊界、規格符合度、測試是否被刪除/跳過/放寬；`test-runner` 執行 `test:unit` 與 `test:integration`。

## 測試結果

### 審查當下（修正前）

| 指令 | 結果 | 通過 | 失敗 | 略過 | 總數 |
| --- | --- | --- | --- | --- | --- |
| `npm run test:unit` | ✅ PASS | 54 | 0 | 1 | 55（7 個測試檔） |
| `npm run test:integration` | ✅ PASS | 10 | 0 | 0 | 10（`tests/integration/order-checkout.integration.test.js`） |

略過的 1 項在 `tests/shipping.test.js:29`（`it.skip`），見下方 **問題 1**，此 skip 並非偶然，而是掩蓋了一個真實邏輯錯誤。

### 修正後（重新執行）

| 指令 | 結果 | 通過 | 失敗 | 略過 | 總數 |
| --- | --- | --- | --- | --- | --- |
| `npm run test:unit` | ✅ PASS | 57 | 0 | 0 | 57（7 個測試檔） |
| `npm run test:integration` | ✅ PASS | 10 | 0 | 0 | 10（`tests/integration/order-checkout.integration.test.js`） |

`shipping.test.js` 的 skip 已移除並通過；另為問題 2、3、5 新增了回歸測試（詳見各問題說明），因此 unit 測試數由 54 增為 57，integration 測試數維持 10（新增的斷言併入既有迴圈測試，未新增測試案例數）。未執行 `test:e2e` 與 `test:acceptance`。

---

## 問題清單（依嚴重程度排序）

### 🔴 High

#### 1. 運費滿額免運門檻「差一」邏輯錯誤，且唯一能驗證此邊界的測試被 `.skip`

- **修正狀態**：✅ 已修正
- **檔案**：`src/utils/shipping.js:39-41`

  ```js
  function qualifiesForFreeShipping(subtotal) {
    return subtotal > SHIPPING_RATES.FREE_SHIPPING_THRESHOLD;
  }
  ```

  `FREE_SHIPPING_THRESHOLD = 1500`（`shipping.js:9`）。目前要求 `subtotal > 1500` 才免運，代表小計**恰好 1500 元時不會免運**（仍收 120/60 元基本運費）。
- **規格依據**：`docs/FEATURES.md:232`、`docs/README.md:70`、`docs/ARCHITECTURE.md:420`、`docs/CHANGELOG.md:73` 皆寫「商品小計滿 1,500 元 → 基本運費 0 元」，中文「滿」在電商語境應為「達到門檻（≥）」，與現行 `>` 實作矛盾。
- **測試被跳過**：`tests/shipping.test.js:29-34`（`it.skip('商品小計 1,500 元時免基本運費', ...)`）是全庫唯一一個 `.skip`。啟用後以原實作執行會**失敗**，證實此 bug 是被刻意跳過而非偶然遺漏。
- **業務影響**：所有小計恰好 1,500 元的訂單都會被多收一筆基本運費，金額差異會寫入訂單快照並送交綠界付款，與文件宣告的規則不一致。
- **已套用的修正**：`qualifiesForFreeShipping` 改為 `subtotal >= SHIPPING_RATES.FREE_SHIPPING_THRESHOLD`；移除 `tests/shipping.test.js:29` 的 `.skip`，測試已通過。
- 來源：code-reviewer

#### 2. `GET /api/orders/:id` 訂單詳情 API 缺少擁有者檢查（IDOR）

- **修正狀態**：✅ 已修正
- **檔案**：`src/routes/orderRoutes.js:350-364`（呼叫 `src/services/orderService.js:21-23` 的 `findOrderById`）
- **問題**：此端點只用 `findOrderById(req.params.id)`（`SELECT * FROM orders WHERE id = ?`），未比對 `req.user.userId`。同檔案中 `/:id/pay`、`/:id/check-payment` 都正確改用 `findOrderForUser(id, userId)`，顯示此端點是獨漏的疏忽。
- **攻擊情境**：任何已登入會員只要取得別人的 order UUID（猜測、瀏覽器歷史、Referer、分享連結等），即可讀取該訂單完整內容：收件人姓名、Email、地址、商品明細、金額、`merchant_trade_no`。違反 CLAUDE.md「使用者只能存取自己的訂單」的規則。
- **已套用的修正**：`GET /:id` 改用 `findOrderForUser(req.params.id, req.user.userId)`；並在 `tests/orders.test.js` 新增「另一個使用者存取他人訂單應回 404」的回歸測試，已通過。
- 來源：security-reviewer

### 🟡 Medium

#### 3. 購物車 `PATCH /api/cart/:itemId` 數量驗證邊界寬鬆，與規格及 POST 端點不一致

- **修正狀態**：✅ 已修正
- **檔案**：`src/routes/cartRoutes.js:292-322`

  ```js
  const qty = Number(quantity);
  if (Number.isNaN(qty)) { ... }
  // ...
  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, itemId);
  ```

  只檢查「是否為 `NaN`」，未如 `POST /api/cart` 使用 `parsePositiveInteger()` 驗證「正整數」，導致 0、負數會變成未分類的 500（因 DB 的 `CHECK(quantity > 0)` 例外），小數與陣列輸入則會被誤判為合法值寫入。
- **規格依據**：`docs/FEATURES.md:188-204` 明確要求 `quantity` 必須為正整數，否則回 `400 VALIDATION_ERROR`。
- **已套用的修正**：PATCH 改用與 POST 相同的 `parsePositiveInteger()`；並在 `tests/cart.test.js` 新增對 0、負數、小數、陣列輸入皆應回 `400 VALIDATION_ERROR` 的回歸測試，已通過。
- 來源：code-reviewer（評為中）、security-reviewer（同一問題評為低）

#### 4. ECPay 付款頁面路由無身份驗證/歸屬檢查

- **修正狀態**：⚠️ 本次未修正（架構限制，已記錄待辦）
- **檔案**：`src/routes/pageRoutes.js:61-72`
- **問題**：`GET /ecpay/payment/:orderId` 掛在無任何 middleware 保護的 `pageRoutes`（`app.js:38`），只檢查訂單存在與 `status === 'pending'`，未檢查請求者是否為訂單本人，也不要求登入。
- **為何本次未修正**：已確認前端是透過一般瀏覽器導覽到此頁（`public/js/pages/checkout.js:57` 的 `window.location.href`、`views/pages/order-detail.ejs:95` 的 `<a href>`），兩者皆**不會**夾帶 `Authorization` 或 `X-Session-Id` header；而 `sessionMiddleware`（`src/middleware/sessionMiddleware.js`）僅讀取 `X-Session-Id` header、並未使用 cookie。因此這個頁面路由目前的架構下**沒有任何可用的身分憑證**可以拿來比對訂單擁有者——要修正需要引入新的身分機制（例如改用 cookie-based session，或為此連結簽發短效期的一次性權杖），屬於架構層級的改動，風險與影響面都超出本次「修正審查發現問題」的範圍，貿然變更可能破壞現有結帳導流程（目前沒有瀏覽器環境可即時驗證改動是否破壞金流）。
- **殘餘風險的緩解因素**：`order.id` 為 UUID v4（128 bit 隨機），無法被暴力猜測；此頁面僅在訂單狀態為 `pending` 時可用（一次性視窗）；untrusted 第三方即使取得連結，最多只能代為觸發一次真正導向綠界的付款（對訂單本人無金錢損失）或看到金額與品項摘要（不含收件人個資）。
- **建議待辦**：若要徹底修正，建議評估導入 cookie-based session 或簽章型一次性 capability token，列入後續規劃（例如 `docs/plans/`），而非本次審查修正範圍。
- 來源：security-reviewer

#### 5. `QueryTradeInfo` 的 `CheckMacValue` 驗證在欄位缺失時「失效開放」（fail-open）

- **修正狀態**：✅ 已修正
- **檔案**：`src/services/paymentService.js:15`

  ```js
  if (tradeInfo.CheckMacValue && !verifyCheckMacValue(tradeInfo, config.hashKey, config.hashIV)) {
    throw new Error('QueryTradeInfo CheckMacValue mismatch');
  }
  ```

  只有當 `CheckMacValue` 為真值時才驗證簽章；若回應缺少此欄位，簽章驗證會被整段跳過，僅靠 `MerchantTradeNo`／`TradeAmt` 比對（兩者對訂單擁有者而言非機密）。
- **已套用的修正**：改為「沒有 `CheckMacValue` 或驗證失敗」都視為不合法並拋錯（`!tradeInfo.CheckMacValue || !verifyCheckMacValue(...)`）；並在 `tests/integration/order-checkout.integration.test.js` 的偽造回應測試中新增「`TradeStatus=1` 且完全缺少 `CheckMacValue`」情境，確認會被拒絕，已通過。
- 來源：security-reviewer

#### 6. 綠界商店金鑰硬編碼於原始碼，缺少如 `JWT_SECRET` 的 fail-fast 保護

- **修正狀態**：✅ 已修正
- **檔案**：`src/utils/ecpay.js:3-8`
- **問題**：`merchantId`/`hashKey`/`hashIV` 以硬編碼測試金鑰作為預設值；正式環境若忘記設定對應環境變數，系統不會像 `server.js` 對 `JWT_SECRET` 那樣直接拒絕啟動，而是靜默退回測試金鑰繼續運作。
- **已套用的修正**：移除 `ecpay.js` 的硬編碼 fallback（改為直接讀 `process.env.*`，缺少時為 `undefined`）；在 `server.js` 的啟動流程中比照 `JWT_SECRET` 新增檢查，`ECPAY_MERCHANT_ID`／`ECPAY_HASH_KEY`／`ECPAY_HASH_IV` 任一缺少即 `console.error` 並 `process.exit(1)`。測試環境（`tests/setup/testEnvironment.js`）本就會設定這三個變數，不受影響，`npm run test:unit`/`test:integration` 皆已確認通過；本機 `.env` 也已設有對應值，`npm run start` 不受影響。
- 來源：security-reviewer

### 🟢 Low / 資訊性

#### 7. JWT 中的 `role` 宣告未在每次請求時與資料庫重新核對

- **修正狀態**：✅ 已修正
- **檔案**：`src/middleware/authMiddleware.js:16-31`、`src/routes/cartRoutes.js:15-27`（dualAuth）
- **問題**：`req.user.role` 原本直接取自 JWT payload，未在每次請求重新查詢 DB 確認。目前專案沒有角色升降級 API，暫無可利用路徑，屬縱深防禦建議。
- **已套用的修正**：兩處查詢使用者是否存在的 SQL 皆改為 `SELECT id, role FROM users WHERE id = ?`，並以查詢結果的 `role`（而非 JWT payload 的 `role`）組成 `req.user`，確保角色一律以資料庫當下的值為準。
- 來源：security-reviewer

#### 8. 三份驗收測試（Issue A/B/C）目前失敗，屬預期狀態，非違規

- **修正狀態**：不處理（非本次範圍）
- **檔案**：`tests/acceptance/cancel-order.test.js`、`tests/acceptance/order-filter.test.js`、`tests/acceptance/coupon.test.js`
- **說明**：目前 `GET /api/orders` 尚未實作分頁/篩選，也沒有 `POST /api/orders/:id/cancel` 路由，與這兩份驗收測試的期待不符；`docs/TESTING.md:31-48` 已說明這是第四場作業 Issue B/C 的驗收測試，「在 Issue 完成前預期失敗」，不包含在 `test:unit`/`test:integration`/CI 中。兩位 reviewer 交叉確認：**這不是測試被刪除/跳過/放寬的違規情形**，而是尚待實作的功能；兩份測試中已設計好的越權/認證情境（跨使用者 404、未登入 401、僅看到自己的訂單）建議在實作時延用。
- 來源：code-reviewer、security-reviewer（交叉確認一致）

#### 附註（非漏洞，功能完整性待辦）

`src/utils/ecpay.js:114` 的 `ReturnURL` 指向 `/ecpay/notify`，但專案中找不到對應的被動 callback 路由。目前完全依賴使用者端主動呼叫 `/api/orders/:id/check-payment`（有伺服器端驗證），所以沒有被動端點代表沒有可被偽造的攻擊面，不構成漏洞；但若使用者在綠界付款完成後未回站內觸發查詢，訂單可能停留在 `pending` 不會自動變 `paid`，建議列為可靠性待辦，非安全性缺陷，本次未處理。（來源：security-reviewer）

---

## 已檢查且未發現問題的範圍

- **交易原子性**：`createOrderFromCart` 使用 `db.transaction()` 包住「建單→寫入品項→扣庫存→清空購物車」，`order-checkout.integration.test.js` 的 trigger 強制失敗測試驗證中途失敗會完整回滾，未見斷言被放寬。
- **付款狀態機**：`paymentService` 的 `isTradePaid`/`markOrderPaid` 與 `ecpay.js` 的簽章/金額/交易編號核對邏輯與規格一致，狀態更新皆以 `WHERE status = 'pending'` 保證不可逆；相關 integration 測試（偽造簽章、金額不符、HTTP 錯誤）斷言皆為精確值比對。
- **SQL Injection**：所有查詢皆使用 `?` 參數化綁定；`adminOrderRoutes.js` 的 `status` 篩選在拼接前先經白名單驗證。
- **JWT 簽章/密鑰**：`JWT_SECRET` 僅從環境變數讀取，未設定時 `server.js` 會 `process.exit(1)`；`jwt.verify` 鎖定 `algorithms: ['HS256']`；`jwt.sign` 設有 `expiresIn: '7d'`。
- **dualAuth 設計**：Authorization header 存在但 token 無效/過期時直接回 401，不會降級為 session 模式；JWT 與 session 同時存在時以 JWT 優先；建立訂單路由僅掛 `authMiddleware`，符合 CLAUDE.md 規定。
- **運費/金額計算（輸入驗證部分）**：`calculateShipping` 對輸入做嚴格型別檢查，`subtotal` 一律由伺服器端根據購物車目前商品單價重新計算，不信任前端傳入總額。
- **XSS**：前端全面使用 Vue 的 mustache 插值（自動 escape），無 `v-html`；EJS 輸出使用者可控值皆用 `<%= %>`；`buildAioFormHtml` 透過 `escapeHtml()` 跳脫屬性值。
- **Admin 權限控管**：`adminOrderRoutes.js` 正確串接 `authMiddleware` + `adminMiddleware`，並有測試驗證一般會員存取會得到 403。
- **回應格式**：`orderRoutes.js`、`adminOrderRoutes.js` 一致遵守 `{ data, error, message }`，錯誤時 `data: null`；後台分頁邊界處理（`Math.max`/`Math.min`/白名單）正確。
- **測試斷言嚴謹度**：`tests/orders.test.js`、`tests/adminOrders.test.js` 等斷言皆為精確值比對（如 `toHaveProperty('status', 'paid')`），未發現放寬或刪減案例。

---

## 總結

| # | 問題 | 嚴重程度 | 狀態 |
| --- | --- | --- | --- |
| 1 | 運費滿額門檻 `>` 應為 `>=` | High | ✅ 已修正 |
| 2 | `GET /api/orders/:id` 缺少擁有者檢查（IDOR） | High | ✅ 已修正 |
| 3 | 購物車 PATCH 數量驗證寬鬆 | Medium | ✅ 已修正 |
| 4 | ECPay 付款頁面無身份/歸屬檢查 | Medium | ⚠️ 未修正（架構限制，見上方說明） |
| 5 | `CheckMacValue` 欄位缺失時 fail-open | Medium | ✅ 已修正 |
| 6 | 綠界金鑰硬編碼且缺少 fail-fast | Medium | ✅ 已修正 |
| 7 | JWT role 未逐次核對資料庫 | Low | ✅ 已修正 |
| 8 | 3 份 acceptance 測試失敗 | 資訊性 | 不處理（Issue B/C 尚未實作，非缺陷） |
| 附註 | 綠界被動 callback 缺失 | 資訊性 | 不處理（功能完整性待辦，非安全缺陷） |

本次共修正 6 項問題（含 2 項 High、3 項 Medium、1 項 Low），並為其中 3 項新增回歸測試；修正後 `npm run test:unit`（57 項）與 `npm run test:integration`（10 項）全數通過。問題 4（ECPay 付款頁面歸屬檢查）因需要架構層級變更（身分驗證機制）而保留未修正，已記錄原因與建議待辦；問題 8 與附註維持原狀，非本次範圍。
