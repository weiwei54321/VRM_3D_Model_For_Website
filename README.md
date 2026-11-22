# VRM 網站助理（純 JavaScript）

在任何網頁加一行 `<script>`，右下角就會出現一個 3D VRM 角色：會揮手、思考、指著文字解說等動作、眨眼、眼睛跟著滑鼠、說話動嘴巴；可以拖來拖去、會自己走動，躲起來時會從螢幕邊緣探頭。
不需要後端：聊天機器人是把 `maybeai.py` 的樸素貝氏分類器移植成 JS，直接在瀏覽器裡跑。

## 檔案

| 檔案 | 用途 |
|---|---|
| `vrm-assistant.js` | 主程式：VRM 角色、聊天介面、分類器 |
| `chatbot-data.js` | 知識庫（訓練句 + 回答），由 `maybeai.py` 的資料轉換而來，可直接編輯 |
| `demo.html` | 示範頁 |

## 嵌入網站

把 `vrm-assistant.js`、`chatbot-data.js`（和你的 `.vrm` 模型）放在同一個資料夾上傳，然後在 `</body>` 前加：

```html
<script src="/assistant/vrm-assistant.js"
        data-model="/assistant/my-avatar.vrm"
        data-name="小助理"
        data-greeting="你好！有什麼可以幫你的嗎？"></script>
```

沒指定 `data-model` 時會用 three-vrm 官方範例模型。three.js 與 three-vrm 會自動從 CDN（esm.sh）載入。

### 設定（data-* 屬性）

| 屬性 | 說明 | 預設 |
|---|---|---|
| `data-model` | .vrm 模型網址（若放在別的網域，該網域需允許 CORS） | 官方範例模型 |
| `data-knowledge` | 知識庫 JS 網址 | 同資料夾的 `chatbot-data.js` |
| `data-name` | 標題列名稱 | VRM 小助理 |
| `data-greeting` | 開場白（空字串 = 不說） | 預設招呼語 |
| `data-position` | `right` / `left` | right |
| `data-framing` | `full` 全身 / `upper` 上半身 | full |
| `data-width` / `data-height` | 角色畫布大小 (px)。全身模式不指定寬度時，會依模型實際大小自動計算，保證揮手、跳躍不會被裁到 | 全身 自動 / 520，上半身 260 / 360 |
| `data-scale` | 初始大小倍率 | 1 |
| `data-color` | 主題色 | #6c5ce7 |
| `data-voice` | `true` 啟用瀏覽器語音朗讀 | false |
| `data-lang` | 語音語系 | zh-TW |
| `data-api` | 改用自己的後端（POST `{message}` → `{reply, emotion}`） | 不使用 |
| `data-wander` | `false` 時角色不會自己走來走去 | true |
| `data-start` | `peek` = 一開始就躲在旁邊探頭 | stand |
| `data-animations` | （選用）自己的 .vrma 動作檔 JSON，如 `{"wave":"/vrma/wave.vrma"}` | 不使用 |
| `data-auto` | `false` 時不自動啟動 | 自動 |

### JavaScript API

```js
VRMAssistant.init({ model: "a.vrm", suggestions: ["你好", "運費多少？"] }); // 搭配 data-auto="false"
VRMAssistant.say("歡迎光臨！", "happy");   // 表情：happy relaxed surprised sad angry neutral
VRMAssistant.ask("我想要退款");
VRMAssistant.open(); VRMAssistant.close();
VRMAssistant.hide();                       // 走到螢幕邊緣探頭
VRMAssistant.show(true);                   // 走出來（true = 順便打開聊天）
VRMAssistant.walkTo(innerWidth / 2);       // 走到某個位置
VRMAssistant.play("clap");                 // 播放動作
VRMAssistant.setExpression("surprised");
VRMAssistant.bot.reply("你好");            // → { reply, category, emotion, confidence }
```

## 角色行為

| 行為 | 說明 |
|---|---|
| 點角色 | 開／關聊天視窗；連戳三下會害羞 |
| 右鍵角色 | 選單：拖拉調整大小（40%～200%）、恢復預設、聊天、躲起來／走出來、開關自己走動 |
| 拖曳 | 抓起來會驚訝、腳晃來晃去；放開會掉回地上 |
| 拖到螢幕邊緣放開／按「躲起來」 | 走到邊緣，從旁邊**探頭**（取代開啟聊天按鈕）；滑過會說「有什麼需要幫忙的嗎？」，點一下就走出來並打開聊天 |
| 待機 | 淺淺微笑、頭跟著滑鼠轉並微微歪頭、重心左右換腳、手肘自然彎曲；滑鼠不動時偶爾飄一下視線、偶爾連眨兩下眼 |
| 閒置 | 每 25～55 秒隨機走動（聊天開著時不會）、東張西望、放鬆；超過 1 分鐘沒動靜會想睡 |
| 問答 | 送出問題時做思考動作，回答時依情緒播放動作（開心→拍手/跳、難過→sad、驚訝→surprised…） |

位置、大小、是否躲起來、是否自己走動都會記在 localStorage，換頁後維持原狀。

### 動作

所有動作都是程式即時產生，不需要任何外部動作檔，任何 VRM 模型都能用：

| 名稱 | 動作 | 什麼時候會自動出現 |
|---|---|---|
| `wave` | 揮手 | 打招呼、從旁邊走出來 |
| `present` | 雙手指向文字，看字 → 看我 → 看字 → 看我 | 一般回答（自動指向聊天視窗那一側） |
| `nod` | 點頭 | 一般回答 |
| `think` | 一手托下巴思考 | 送出問題、等待回答時 |
| `clap` / `jump` | 拍手 / 跳 | 開心的回答 |
| `surprised` / `sad` / `angry` | 驚訝 / 垂頭喪氣 / 雙手叉腰 | 對應情緒的回答 |
| `blush` | 害羞扭捏 | 連戳三下 |
| `lookAround` / `stretch` / `sleepy` | 東張西望 / 伸懶腰 / 打瞌睡 | 閒置時 |

`VRMAssistant.play("present", { dir: -1 })` 可以指定方向（-1 左、1 右），不指定時自動判斷。

想用自己的動作檔（.vrma），可以用 `data-animations` 指定，同名時會取代內建動作：

```html
<script src="vrm-assistant.js"
        data-animations='{"idle":"/vrma/idle.vrma","peace":"/vrma/peace.vrma"}'></script>
```

## 修改知識庫

編輯 `chatbot-data.js`：

```js
training: [
  ["運費怎麼算", "查詢|運費"],
  ["寄到台南要多少錢", "查詢|運費"],
  ...
],
responses: {
  "查詢|運費": ["滿 999 免運，未滿酌收 60 元。"],
  ...
}
```

同一類別多給幾句不同說法的訓練句，分類會更準。`responses` 一個類別可放多個回答，會隨機挑選。
表情由類別名稱決定（含「迎賓/美食/興趣/電影」→ 開心、「退款/取消」→ 難過…），規則在 `vrm-assistant.js` 的 `EMOTION_RULES`。

## 和 Python 版的差異

- jieba 無法在瀏覽器使用，改成「單字 + 雙字詞」斷詞（加上常見字停用表），在這份資料上留一法準確率約 77%。
- 輸入與訓練句完全相同時直接採用該類別。
- 輸入沒有任何認得的詞、或信心低於 `minConfidence`（預設 0.25）時，回答 fallback 而不是亂猜。
- Python dict 重複 key 只會留最後一個；這裡全部保留，同類別隨機回答。

## 本機測試

`.vrm` 與 ES module 不能用 `file://` 開，需要任何靜態伺服器，例如：

```powershell
npx serve .
```

再開 http://localhost:3000/demo.html 。

## 授權

[MIT License](LICENSE) © 2026 weiwei54321
