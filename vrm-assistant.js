/*!
 * vrm-assistant.js — 一行 <script> 就能放進網站的 VRM 3D 助理
 * MIT License © 2026 weiwei54321 — https://github.com/weiwei54321/VRM_3D_Model_For_Website
 *
 * 用法（放在 </body> 前）：
 *   <script src="vrm-assistant.js"
 *           data-model="my-avatar.vrm"
 *           data-name="小助理"
 *           data-greeting="你好！有什麼可以幫你的嗎？"></script>
 *
 * 可用的 data-* 屬性：
 *   data-model       .vrm 模型網址（預設使用 three-vrm 官方範例模型）
 *   data-knowledge   知識庫 JS 網址（預設：與本檔同資料夾的 chatbot-data.js）
 *   data-name        助理名稱（標題列顯示）
 *   data-greeting    開場白
 *   data-position    right | left：一開始站的位置（預設 right）
 *   data-framing     full = 全身（預設）| upper = 上半身
 *   data-width       角色畫布寬度 px（全身預設依模型自動計算，上半身 260）
 *   data-height      角色畫布高度 px（全身預設 520，上半身 360）
 *   data-scale       初始大小倍率（預設 1；使用者也可以在角色上按右鍵調整）
 *   data-color       主題色（預設 #6c5ce7）
 *   data-voice       true 啟用瀏覽器語音朗讀（預設 false）
 *   data-lang        語音語系（預設 zh-TW）
 *   data-api         （選用）改用自訂後端：POST {message} → {reply, emotion}
 *   data-wander      false 時角色不會自己走來走去（預設 true）
 *   data-start       peek 時一開始就躲在旁邊探頭（預設 stand）
 *   data-animations  （選用）自己的 VRMA 動作檔 JSON：{"idle":"idle.vrma","wave":"wave.vrma"}，會取代同名的內建動作
 *   data-auto        false 時不自動啟動，改由 VRMAssistant.init({...}) 手動啟動
 *
 * JavaScript API：
 *   VRMAssistant.init(options)        手動啟動（options 同上，使用 camelCase）
 *   VRMAssistant.say(text, emotion)   讓助理說話（emotion: happy/relaxed/surprised/sad/angry/neutral）
 *   VRMAssistant.ask(text)            代替使用者送出問題
 *   VRMAssistant.open() / close()     開關聊天視窗
 *   VRMAssistant.hide() / show()      走到旁邊探頭 / 走出來
 *   VRMAssistant.walkTo(x)            走到畫面上的 x（px，角色中心）
 *   VRMAssistant.play(name)           播放動作（wave nod think clap jump surprised sad angry sleepy lookAround blush stretch）
 *   VRMAssistant.setExpression(name)  設定表情
 *   VRMAssistant.bot                  內建分類器（bot.reply(text) 回傳 {reply, category, emotion, confidence}）
 *
 * 所有動作都是程式即時產生（不需要任何外部動作檔）。
 */
(function () {
  "use strict";
  if (window.VRMAssistant && window.VRMAssistant.__loaded) return;

  var currentScript = document.currentScript;
  var BASE_URL = currentScript && currentScript.src
    ? currentScript.src.replace(/[^/]*(\?.*)?$/, "")
    : "./";

  var THREE_URL = "https://esm.sh/three@0.180.0";
  var GLTF_URL = "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
  var VRM_URL = "https://esm.sh/@pixiv/three-vrm@3.5.5?deps=three@0.180.0";
  var VRMA_URL = "https://esm.sh/@pixiv/three-vrm-animation@3.5.5?deps=three@0.180.0";
  var DEFAULT_MODEL =
    "https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";

  /* ------------------------------------------------------------------ *
   * 內建動作（程式產生）
   *   pose(p, t) 回傳要靠近的骨頭姿勢；p = 進度 0~1，t = 經過秒數
   *   手臂以「右手」為準：z 正 = 放下、負 = 舉起；x 負 = 往前；手肘 y 正 = 往前彎、z 正 = 往下彎
   *   左手由 arms() 自動鏡像
   * ------------------------------------------------------------------ */
  function ease(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  function arms(o, side, ux, uy, uz, lx, ly, lz) {
    var m = side === "left" ? -1 : 1;
    o.push([side + "UpperArm", ux, uy * m, uz * m]);
    o.push([side + "LowerArm", lx || 0, (ly || 0) * m, (lz || 0) * m]);
  }
  function both(o, ux, uy, uz, lx, ly, lz) {
    arms(o, "right", ux, uy, uz, lx, ly, lz);
    arms(o, "left", ux, uy, uz, lx, ly, lz);
  }
  var GESTURES = {
    wave: { dur: 2.6, emo: "happy", pose: function (p, t) {
      var o = [], s = Math.sin(t * 10);
      arms(o, "right", -0.3, 0, -0.15, 0, 0, -1.35 + s * 0.35);
      o.push(["head", 0, 0, -0.08], ["spine", 0, 0, 0.05]);
      return { pose: o };
    } },
    nod: { dur: 1.1, pose: function (p) {
      var n = Math.abs(Math.sin(p * Math.PI * 2)) * 0.14;
      return { pose: [["neck", n, 0, 0], ["head", n * 0.6, 0, 0]] };
    } },
    think: { dur: 3.2, pose: function (p, t) {
      var o = [];
      arms(o, "right", -0.45, 0.25, 1.15, 0, 2.35, 0);
      arms(o, "left", -0.2, 0.7, 1.3, 0, 1.25, 0);     // 另一手橫放在胸前托著手肘
      o.push(["neck", -0.08, 0.12, 0.1], ["head", -0.06, 0.1, 0.08 + Math.sin(t * 1.5) * 0.03]);
      return { pose: o, look: { x: 0.5, y: -0.6 } };
    } },
    clap: { dur: 2.2, emo: "happy", pose: function (p, t) {
      var o = [], c = Math.abs(Math.sin(t * 9));
      both(o, -0.45, 0.45 + c * 0.35, 1.1, 0, 1.15, 0);
      o.push(["head", 0.05, 0, Math.sin(t * 4.5) * 0.06], ["spine", 0.05, 0, 0]);
      return { pose: o };
    } },
    jump: { dur: 1.3, emo: "happy", noIK: true, pose: function (p) {
      var crouch = p < 0.18 ? ease(p / 0.18) : p < 0.28 ? 1 - ease((p - 0.18) / 0.1)
        : p < 0.72 ? 0 : p < 0.82 ? ease((p - 0.72) / 0.1) : 1 - ease((p - 0.82) / 0.18);
      var air = p > 0.24 && p < 0.76 ? Math.sin((p - 0.24) / 0.52 * Math.PI) : 0;
      var o = [];
      ["left", "right"].forEach(function (sd) {
        o.push([sd + "UpperLeg", -0.6 * crouch - 0.25 * air, 0, 0]);
        o.push([sd + "LowerLeg", 1.1 * crouch + 0.5 * air, 0, 0]);
      });
      both(o, -0.2 * air, 0, 1.2 - 2.0 * air, 0, 0, -0.2 * air);
      o.push(["spine", 0.2 * crouch, 0, 0]);
      return { pose: o, rootY: -0.12 * crouch + 0.2 * air };
    } },
    surprised: { dur: 1.8, emo: "surprised", noIK: true, pose: function (p) {
      var o = [];
      both(o, -0.5, 0.2, 0.95, 0, 1.9, 0);
      o.push(["spine", -0.08, 0, 0], ["head", -0.1, 0, 0]);
      return { pose: o, rootY: p < 0.22 ? Math.sin(p / 0.22 * Math.PI) * 0.05 : 0 };
    } },
    sad: { dur: 3.0, emo: "sad", pose: function (p, t) {
      var o = [];
      both(o, -0.25, 0.45, 1.3, 0, 0.75, 0);
      o.push(["neck", 0.28, 0, Math.sin(t * 0.8) * 0.04], ["head", 0.12, 0, 0],
        ["spine", 0.12, 0, 0], ["chest", 0.06, 0, 0]);
      return { pose: o, look: { x: 0.2, y: 0.7 } };
    } },
    angry: { dur: 2.6, emo: "angry", pose: function (p, t) {
      var o = [];
      both(o, 0.25, 0, 0.75, 0, 0, 1.45);              // 雙手叉腰
      o.push(["spine", 0.08, 0, 0], ["head", 0.1, Math.sin(t * 7) * 0.08 * (p < 0.5 ? 1 : 0), 0]);
      return { pose: o };
    } },
    sleepy: { dur: 4.0, pose: function (p, t) {
      var cyc = (p * 2) % 1;                          // 頭慢慢垂下、突然驚醒，兩次
      var droop = cyc < 0.8 ? ease(cyc / 0.8) : 1 - ease((cyc - 0.8) / 0.2);
      var o = [["neck", 0.35 * droop, 0, 0.12 * droop], ["head", 0.15 * droop, 0, 0.05 * droop],
        ["spine", 0.05 * droop, 0, 0]];
      return { pose: o, blink: 0.45 + 0.5 * droop };
    } },
    lookAround: { dur: 3.6, pose: function (p) {
      var yv = Math.sin(p * Math.PI * 2);
      return { pose: [["neck", -0.03, yv * 0.45, 0], ["head", 0, yv * 0.25, 0], ["spine", 0, yv * 0.1, 0]],
        look: { x: yv * 0.9, y: -0.1 } };
    } },
    blush: { dur: 3.0, emo: "happy", pose: function (p, t) {
      var o = [], sw = Math.sin(t * 3);
      both(o, -0.3, 0.55, 1.25, 0, 0.95, 0);
      o.push(["neck", 0.18, 0, sw * 0.1], ["head", 0.08, 0, sw * 0.05], ["hips", 0, sw * 0.08, 0]);
      return { pose: o, look: { x: 0.4, y: 0.5 } };
    } },
    stretch: { dur: 3.0, emo: "relaxed", pose: function (p) {
      var o = [];
      both(o, 0, 0, -1.35, 0, 0, -0.2);
      o.push(["spine", -0.12, 0, 0], ["chest", -0.08, 0, 0], ["head", -0.15, 0, 0]);
      return { pose: o, rootY: 0.02, blink: 0.85 };
    } }
  };
  // 介紹：側身、雙手朝文字的方向伸出去，看字 → 看我 → 看字 → 看我
  GESTURES.present = { dur: 5.2, pose: function (p, t, g) {
    var dir = g.dir || -1;                            // -1 = 文字在畫面左邊，1 = 右邊
    var turn = 0.25;                                  // 身體稍微轉向文字
    // atText：1 = 看字、0 = 看我。四段依序 看字 → 看我 → 看字 → 看我，每段開頭平滑轉頭
    var seq = [1, 0, 1, 0];
    var k = Math.min(3, Math.floor(p * 4)), f = p * 4 - k;
    var prev = k === 0 ? 0 : seq[k - 1];
    var atText = prev + (seq[k] - prev) * ease(f / 0.35);
    var o = [];
    // 靠文字那側的手平伸指過去；另一手橫過胸前、略低，也指向文字（兩手平行）
    var near = dir > 0 ? "left" : "right", far = dir > 0 ? "right" : "left";
    arms(o, near, -0.1, 0.5, 0.05, 0, 0.15, 0);
    arms(o, far, 0, 2.45, 0.35, 0, 0.2, 0);
    var headY = dir * 0.6 * atText - dir * turn * (1 - atText);
    o.push(["neck", 0.03 * atText, headY * 0.6, 0], ["head", 0.05 * atText, headY * 0.4, -dir * 0.06 * (1 - atText)]);
    return { pose: o, yaw: dir * turn, look: { x: dir * atText, y: 0.15 * atText } };
  } };
  GESTURES.relax = GESTURES.stretch;

  /* ------------------------------------------------------------------ *
   * 1. 簡易 chatbot：移植自 maybeai.py（CountVectorizer + MultinomialNB）
   *    jieba 無法在瀏覽器使用，改用「單字 + 雙字詞」斷詞，對中文短句效果相近。
   * ------------------------------------------------------------------ */
  // 太常見、對分類沒幫助的單字（雙字詞仍會保留，例如「你好」）
  var STOP_CHARS = "我你您的了是嗎呢吧啊呀喔哦請問想要有什麼麼怎如何這那個一在可以能會不沒和與及就也都還很嗎？";
  function normalize(text) {
    return String(text || "").toLowerCase().replace(/[^㐀-䶿一-鿿a-z0-9]/g, "");
  }
  function tokenize(text) {
    var tokens = [];
    var segs = String(text || "").toLowerCase()
      .match(/[㐀-䶿一-鿿]+|[a-z0-9]+/g) || [];
    segs.forEach(function (seg) {
      if (/^[a-z0-9]+$/.test(seg)) { tokens.push(seg); return; }
      for (var i = 0; i < seg.length; i++) {
        if (STOP_CHARS.indexOf(seg[i]) < 0 || seg.length === 1) tokens.push(seg[i]);
        if (i + 1 < seg.length) tokens.push(seg.substr(i, 2));
      }
    });
    return tokens;
  }

  var EMOTION_RULES = [
    ["迎賓", "happy"], ["美食", "happy"], ["興趣", "happy"], ["電影", "happy"],
    ["天氣", "relaxed"], ["日常", "relaxed"], ["健康", "relaxed"], ["工作", "relaxed"],
    ["退款", "sad"], ["取消", "sad"], ["客服", "neutral"]
  ];
  function emotionFor(category) {
    for (var i = 0; i < EMOTION_RULES.length; i++) {
      if (String(category || "").indexOf(EMOTION_RULES[i][0]) >= 0) return EMOTION_RULES[i][1];
    }
    return "neutral";
  }

  function NaiveBayesBot(data) {
    data = data || {};
    this.fallback = data.fallback || "抱歉，我無法理解您的問題。";
    this.responses = data.responses || {};
    this.alpha = 1; // Laplace smoothing（同 sklearn MultinomialNB 預設）
    this.minConfidence = data.minConfidence == null ? 0.25 : data.minConfidence;
    this.vocab = Object.create(null);
    this.classes = [];
    var stats = Object.create(null);
    var total = 0;
    this.exact = Object.create(null); // 與訓練句完全相同時直接採用
    (data.training || []).forEach(function (row) {
      var label = String(row[1]).replace(/\s+/g, "");
      var key = normalize(row[0]);
      if (key) this.exact[key] = label;
      var s = stats[label] || (stats[label] = { docs: 0, words: 0, counts: Object.create(null) });
      s.docs++; total++;
      tokenize(row[0]).forEach(function (t) {
        this.vocab[t] = true;
        s.counts[t] = (s.counts[t] || 0) + 1;
        s.words++;
      }, this);
    }, this);
    this.vocabSize = Object.keys(this.vocab).length;
    for (var label in stats) {
      stats[label].prior = Math.log(stats[label].docs / total);
      this.classes.push(label);
    }
    this.stats = stats;
  }
  NaiveBayesBot.prototype.classify = function (text, skipExact) {
    var hit = !skipExact && this.exact[normalize(text)];
    if (hit) return { category: hit, confidence: 1 };
    var tokens = tokenize(text).filter(function (t) { return this.vocab[t]; }, this);
    if (!tokens.length) return null;
    var scores = this.classes.map(function (label) {
      var s = this.stats[label];
      var denom = Math.log(s.words + this.alpha * this.vocabSize);
      var score = s.prior;
      tokens.forEach(function (t) {
        score += Math.log((s.counts[t] || 0) + this.alpha) - denom;
      }, this);
      return { label: label, score: score };
    }, this).sort(function (a, b) { return b.score - a.score; });
    var max = scores[0].score;
    var sum = scores.reduce(function (acc, s) { return acc + Math.exp(s.score - max); }, 0);
    return { category: scores[0].label, confidence: 1 / sum };
  };
  NaiveBayesBot.prototype.reply = function (text) {
    if (!String(text || "").trim()) {
      return { reply: "請輸入想問的問題喔！", category: null, emotion: "neutral", confidence: 0 };
    }
    var r = this.classify(text);
    if (r && r.confidence < this.minConfidence) r = null; // 太不確定就不要亂答
    var options = r && this.responses[r.category];
    if (!options || !options.length) {
      return { reply: this.fallback, category: r ? r.category : null, emotion: "surprised", confidence: 0 };
    }
    if (!Array.isArray(options)) options = [options];
    return {
      reply: options[Math.floor(Math.random() * options.length)],
      category: r.category,
      emotion: emotionFor(r.category),
      confidence: Math.round(r.confidence * 1000) / 1000
    };
  };

  /* ------------------------------------------------------------------ *
   * 2. 小工具
   * ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("無法載入 " + src)); };
      document.head.appendChild(s);
    });
  }
  function readAttrs(el) {
    if (!el) return {};
    var d = el.dataset || {};
    var anims;
    if (d.animations === "none") anims = false;
    else if (d.animations) {
      try { anims = JSON.parse(d.animations); } catch (e) { console.warn("[VRMAssistant] data-animations 不是有效的 JSON"); }
    }
    return {
      model: d.model, knowledge: d.knowledge, name: d.name, greeting: d.greeting,
      position: d.position, width: d.width && +d.width, height: d.height && +d.height,
      color: d.color, voice: d.voice === "true", lang: d.lang, api: d.api, auto: d.auto,
      wander: d.wander === undefined ? undefined : d.wander !== "false",
      start: d.start, animations: anims, framing: d.framing, scale: d.scale && +d.scale
    };
  }
  function resolveUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function vw() { return document.documentElement.clientWidth || window.innerWidth; }
  function vh() { return document.documentElement.clientHeight || window.innerHeight; }
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem("vrm-assistant") || "{}"); } catch (e) { return {}; } },
    set: function (v) { try { localStorage.setItem("vrm-assistant", JSON.stringify(v)); } catch (e) { /* 無痕模式等 */ } }
  };

  /* ------------------------------------------------------------------ *
   * 3. 介面（Shadow DOM，避免與網站樣式互相干擾）
   * ------------------------------------------------------------------ */
  var CSS = "\
:host{all:initial}\
*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI','Noto Sans TC','Microsoft JhengHei',sans-serif}\
.stage{position:fixed;left:0;bottom:0;z-index:2147483000;pointer-events:none;filter:drop-shadow(0 6px 18px rgba(0,0,0,.18))}\
.stage canvas{display:block;width:100%;height:100%}\
.hit{position:absolute;left:34%;width:32%;top:var(--ht,8%);bottom:0;pointer-events:auto;cursor:grab;touch-action:none}\
.stage.dragging .hit{cursor:grabbing}\
.stage.peek-right .hit{left:0;width:34%;top:var(--ht,8%);bottom:0;cursor:pointer}\
.stage.peek-left .hit{left:66%;width:34%;top:var(--ht,8%);bottom:0;cursor:pointer}\
.hide-btn{position:absolute;top:calc(var(--ht,8%) + 2%);right:30%;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.92);color:#555;font-size:14px;line-height:28px;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);opacity:0;transition:opacity .2s;pointer-events:auto;padding:0}\
.stage:hover .hide-btn,.hide-btn:focus{opacity:1}\
.stage.peek-right .hide-btn,.stage.peek-left .hide-btn,.stage.walking .hide-btn{display:none}\
.status{position:absolute;inset:auto 0 40% 0;text-align:center;font-size:12px;color:#666;text-shadow:0 1px 2px #fff}\
.fallback{position:absolute;inset:0;display:none;align-items:flex-end;justify-content:center;padding-bottom:20px;font-size:84px}\
.bubble{position:absolute;left:0;bottom:calc(100% - var(--ht,8%) + 6px);max-width:min(260px,90vw);width:max-content;background:#fff;color:#222;font-size:14px;line-height:1.45;padding:9px 13px;border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,.15);opacity:0;transition:opacity .25s;pointer-events:none;word-break:break-word}\
.bubble.show{opacity:1}\
.bubble:after{content:'';position:absolute;bottom:-7px;left:var(--ax,50%);margin-left:-7px;border:7px solid transparent;border-bottom:0;border-top-color:#fff}\
.stage.chat-open .bubble{display:none}\
.panel{position:fixed;z-index:2147483001;width:min(340px,calc(100vw - 24px));height:max(220px,min(440px,calc(100vh - var(--sh) - 24px)));background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}\
.panel.open{display:flex}\
.head{background:var(--c);color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}\
.head .dot{width:8px;height:8px;border-radius:50%;background:#55efc4}\
.head .sp{flex:1}\
.head button{background:none;border:0;color:#fff;font-size:13px;cursor:pointer;line-height:1;padding:4px 6px;border-radius:6px;opacity:.9}\
.head button:hover{background:rgba(255,255,255,.18);opacity:1}\
.head .close{font-size:20px}\
.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f6fb}\
.msg{max-width:82%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}\
.msg.bot{background:#fff;color:#222;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}\
.msg.user{background:var(--c);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}\
.msg.typing{color:#999;font-style:italic}\
.chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px 0;background:#fff}\
.chips button{border:1px solid var(--c);color:var(--c);background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}\
.chips button:hover{background:var(--c);color:#fff}\
form{display:flex;gap:6px;padding:10px;background:#fff;border-top:1px solid #eee}\
input{flex:1;border:1px solid #ddd;border-radius:999px;padding:9px 14px;font-size:14px;outline:none;color:#222;background:#fff;min-width:0}\
input:focus{border-color:var(--c)}\
form button{background:var(--c);color:#fff;border:0;border-radius:999px;padding:0 16px;font-size:14px;cursor:pointer}.menu{position:fixed;z-index:2147483002;min-width:190px;background:#fff;color:#222;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:6px;display:none;font-size:13px}.menu.open{display:block}.menu .row{display:flex;align-items:center;gap:8px;padding:8px 10px}.menu .row b{font-weight:600;min-width:42px;text-align:right;color:var(--c)}.menu input[type=range]{flex:1;accent-color:var(--c);padding:0;border:0}.menu button{display:block;width:100%;text-align:left;background:none;border:0;padding:8px 10px;border-radius:8px;font-size:13px;color:#222;cursor:pointer}.menu button:hover{background:#f0eefc}.menu hr{border:0;border-top:1px solid #eee;margin:4px 0}";

  function buildUI(opts) {
    var host = document.createElement("div");
    host.id = "vrm-assistant";
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>" + CSS + "</style>" +
      "<div class='wrap' style='--c:" + opts.color + ";--sh:" + opts.height + "px'>" +
      "  <div class='panel' role='dialog'>" +
      "    <div class='head'><span class='dot'></span><span class='title'></span><span class='sp'></span>" +
      "      <button class='hide' title='讓角色躲到旁邊'>躲起來</button>" +
      "      <button class='close' title='關閉聊天' aria-label='關閉聊天'>×</button></div>" +
      "    <div class='log' role='log' aria-live='polite'></div>" +
      "    <div class='chips'></div>" +
      "    <form><input placeholder='輸入訊息…' maxlength='300' aria-label='輸入訊息'><button type='submit'>送出</button></form>" +
      "  </div>" +
      "  <div class='stage' style='width:" + opts.width + "px;height:" + opts.height + "px'>" +
      "    <div class='fallback'>🤖</div><div class='status'>載入角色中…</div><div class='bubble'></div>" +
      "    <div class='hit' title='點我聊天，可拖曳移動' role='button' aria-label='開啟聊天'></div>" +
      "    <button class='hide-btn' title='躲起來' aria-label='讓角色躲到旁邊'>⇲</button>" +
      "  </div>" +
      "  <div class='menu' role='menu'>" +
      "    <div class='row'>大小 <input class='scale' type='range' min='40' max='200' step='5' aria-label='角色大小'><b class='scale-val'></b></div>" +
      "    <button data-act='reset'>↺ 恢復預設大小</button>" +
      "    <hr>" +
      "    <button data-act='chat'>💬 聊天</button>" +
      "    <button data-act='hide'>🙈 躲到旁邊</button>" +
      "    <button data-act='wander'></button>" +
      "  </div>" +
      "</div>";
    document.body.appendChild(host);
    var $ = function (s) { return root.querySelector(s); };
    $(".title").textContent = opts.name;
    return {
      host: host, root: root, panel: $(".panel"), log: $(".log"), chips: $(".chips"),
      form: $("form"), input: $("input"), stage: $(".stage"), status: $(".status"),
      bubble: $(".bubble"), fallback: $(".fallback"), close: $(".close"), hide: $(".hide"),
      hit: $(".hit"), hideBtn: $(".hide-btn"), menu: $(".menu"),
      scale: $(".scale"), scaleVal: $(".scale-val"), wrap: $(".wrap")
    };
  }

  /* ------------------------------------------------------------------ *
   * 4. VRM 角色（three.js + @pixiv/three-vrm + VRMA 動作，從 CDN 動態載入）
   *
   *   mode: stand（站著）/ walk（走路）/ drag（被拖著）/ fall（掉下來）/ peek（躲在邊邊探頭）
   * ------------------------------------------------------------------ */
  function Avatar(stage, opts) {
    this.stage = stage;
    this.opts = opts;
    this.baseW = opts.width;
    this.baseH = opts.height;
    this.scale = 1;
    this.W = opts.width;
    this.H = opts.height;
    this.talking = false;
    this.emotion = "neutral";
    this.emotionUntil = 0;
    this.weights = { happy: 0, relaxed: 0, surprised: 0, sad: 0, angry: 0 };
    this.nextBlink = 1.5;
    this.blinkT = -1;
    this.mouse = { x: 0, y: 0 };
    this.visible = true;
    this.lifeBlend = 0;                 // 待機「生命感」層的權重
    this.headLook = { x: 0, y: 0 };     // 頭轉向（平滑過的）
    this.glance = { x: 0, y: 0, until: 0, next: 4 };
    this.weightSide = 1; this.weightT = 0; this.nextWeight = 6;
    this.lastMouseMove = 0;

    this.mode = "stand";
    this.x = 0; this.y = 0; this.vy = 0;      // 畫布左下角位置（px）
    this.targetX = 0;
    this.onArrive = null;
    this.side = opts.position === "left" ? "left" : "right";
    this.yaw = 0;
    this.walkBlend = 0; this.peekBlend = 0; this.dragBlend = 0;
    this.walkPhase = 0;
    this.dragVX = 0;
    this.peekHover = false;
    this.clips = {};
    this.current = null;      // 正在播放的單次動作（自訂 VRMA）
    this.gestures = [];       // 正在播放的內建動作
    this.gLook = null;
    this.idleAction = null;
    this.lastInteract = 0;
    this.nextWander = 20 + Math.random() * 20;
    this.nextGesture = 12 + Math.random() * 10;
    this.onChange = function () {};
  }

  Avatar.prototype.load = function () {
    var self = this;
    return Promise.all([import(THREE_URL), import(GLTF_URL), import(VRM_URL)]).then(function (mods) {
      var THREE = mods[0], GLTFLoader = mods[1].GLTFLoader, VRMLib = mods[2];
      self.THREE = THREE;
      self.GLTFLoader = GLTFLoader;
      self.tmpQ = new THREE.Quaternion();
      self.tmpE = new THREE.Euler();
      var w = self.W, h = self.H;

      var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      self.stage.insertBefore(renderer.domElement, self.stage.firstChild);
      self.renderer = renderer;

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 20);
      var light = new THREE.DirectionalLight(0xffffff, Math.PI);
      light.position.set(1, 1.5, 2);
      scene.add(light, new THREE.AmbientLight(0xffffff, 0.6));
      self.scene = scene; self.camera = camera;
      self.lookTarget = new THREE.Object3D();
      camera.add(self.lookTarget);
      scene.add(camera);

      // leanGroup（左右傾，探頭用）> yawGroup（轉身）> vrm.scene
      self.leanGroup = new THREE.Group();
      self.yawGroup = new THREE.Group();
      self.leanGroup.add(self.yawGroup);
      scene.add(self.leanGroup);

      var loader = new GLTFLoader();
      loader.register(function (parser) { return new VRMLib.VRMLoaderPlugin(parser); });
      return loader.loadAsync(self.opts.model).then(function (gltf) {
        var vrm = gltf.userData.vrm;
        if (!vrm) throw new Error("這不是有效的 VRM 檔案");
        VRMLib.VRMUtils.removeUnnecessaryVertices(gltf.scene);
        if (VRMLib.VRMUtils.combineSkeletons) VRMLib.VRMUtils.combineSkeletons(gltf.scene);
        VRMLib.VRMUtils.rotateVRM0(vrm); // VRM 0.x 模型面向相反，轉正
        vrm.scene.traverse(function (o) { o.frustumCulled = false; });
        self.yawGroup.add(vrm.scene);
        self.vrm = vrm;
        if (vrm.lookAt) vrm.lookAt.target = self.lookTarget;

        // 鏡頭：full = 全身（預設）、upper = 上半身
        vrm.scene.updateMatrixWorld(true);
        var headPos = new THREE.Vector3();
        vrm.humanoid.getNormalizedBoneNode("head").getWorldPosition(headPos);
        self.headY = headPos.y;
        if (self.opts.framing === "upper") {
          var focusY = headPos.y - 0.22;
          self.camDist = 1.6;
          camera.position.set(0, focusY + 0.05, self.camDist);
          camera.lookAt(0, focusY, 0);
        } else {
          // 依模型實際大小取景：T-pose 手臂展開的寬度 + 上方留跳躍空間 + 下方留腳
          var box = new THREE.Box3();
          vrm.scene.traverse(function (o) {
            if (!o.isMesh || !o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
          });
          var top = Math.max(box.max.y, headPos.y + 0.1) + 0.3, bottom = -0.08;
          var halfW = Math.max(-box.min.x, box.max.x, 0.4) * 0.9 + 0.06;
          camera.fov = 22;                                  // 小一點的視角，透視變形較少
          var tanHalf = Math.tan(camera.fov * Math.PI / 360);
          if (self.opts.autoWidth) {
            self.baseW = Math.round(self.baseH * (2 * halfW) / (top - bottom));
            self.setScale(self.scale);                       // 套用新寬度，維持角色中心
          }
          var aspect = self.W / self.H;
          var needH = Math.max(top - bottom, (2 * halfW) / aspect);
          self.camDist = needH / 2 / tanHalf + Math.max(box.max.z, 0.1);
          var midY = bottom + needH / 2;
          camera.position.set(0, midY, self.camDist);
          camera.lookAt(0, midY, 0);
        }
        camera.aspect = self.W / self.H;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        // 頭頂在畫布的位置（%），給點擊區、對話泡泡、聊天視窗對齊用
        var ht = new THREE.Vector3(0, headPos.y + 0.13, 0).project(camera);
        self.headTop = clamp((1 - ht.y) / 2, 0, 0.6);
        self.stage.style.setProperty("--ht", (self.headTop * 100).toFixed(1) + "%");
        self.onChange();

        self.bones = {};
        ["hips", "spine", "chest", "neck", "head", "leftUpperArm", "rightUpperArm",
          "leftLowerArm", "rightLowerArm", "leftUpperLeg", "rightUpperLeg",
          "leftLowerLeg", "rightLowerLeg"].forEach(function (n) {
          self.bones[n] = vrm.humanoid.getNormalizedBoneNode(n);
        });
        self._initFootIK();
        self.mixer = new THREE.AnimationMixer(vrm.scene);
        self.mixer.addEventListener("finished", function (e) {
          if (self.current && e.action === self.current.action) self._backToIdle(0.5);
        });
        self.clock = new THREE.Clock();
        self._bindEvents();
        self._loop();
        self._loadAnimations();
      });
    });
  };

  // 載入 VRMA 動作：先 idle，其他在背景慢慢載
  Avatar.prototype._loadAnimations = function () {
    var self = this, list = this.opts.animations;
    if (!list || !Object.keys(list).length) return;
    import(VRMA_URL).then(function (VA) {
      var loader = new self.GLTFLoader();
      loader.register(function (p) { return new VA.VRMAnimationLoaderPlugin(p); });
      var loadOne = function (name) {
        return loader.loadAsync(resolveUrl(list[name])).then(function (gltf) {
          var anim = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
          if (!anim) throw new Error("沒有動畫資料");
          var clip = VA.createVRMAnimationClip(anim, self.vrm);
          // 有些動作錄製時人不在原點（例如 idle 偏左 16cm），把水平位移平移回中間
          clip.tracks.forEach(function (tr) {
            if (!/\.position$/.test(tr.name)) return;
            var v = tr.values, n = v.length / 3, mx = 0, mz = 0, i;
            for (i = 0; i < n; i++) { mx += v[i * 3]; mz += v[i * 3 + 2]; }
            mx /= n; mz /= n;
            for (i = 0; i < n; i++) { v[i * 3] -= mx; v[i * 3 + 2] -= mz; }
          });
          self.clips[name] = clip;
          if (name === "idle") {
            self.idleAction = self.mixer.clipAction(self.clips.idle);
            self.idleAction.play();
          }
        }).catch(function (err) {
          console.warn("[VRMAssistant] 動作載入失敗：" + name, err);
        });
      };
      var rest = function () {
        Object.keys(list).forEach(function (n) { if (n !== "idle" && list[n]) loadOne(n); });
      };
      if (list.idle) loadOne("idle").then(rest); else rest();
    }).catch(function (err) {
      console.warn("[VRMAssistant] 無法載入 three-vrm-animation，改用內建動作", err);
    });
  };

  // 播放單次動作，播完自動回到 idle
  Avatar.prototype.play = function (name, o) {
    o = o || {};
    if (this.mode === "walk" || this.mode === "drag" || this.mode === "fall") return false;
    var clip = this.clips[name];
    if (!clip || !this.mixer) return this._playGesture(name, o);
    this.stopGestures(0.3);
    var THREE = this.THREE;
    var action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, o.loop ? Infinity : 1);
    action.clampWhenFinished = true;
    action.timeScale = o.speed || 1;
    action.setEffectiveWeight(1);
    action.play();
    var from = this.current ? this.current.action : this.idleAction;
    if (from && from !== action) action.crossFadeFrom(from, 0.4, false);
    else action.fadeIn(0.4);
    this.current = { name: name, action: action };
    return true;
  };

  // 內建（程式產生）動作
  Avatar.prototype._playGesture = function (name, o) {
    var g = GESTURES[name];
    if (!g) return false;
    var now = this.clock ? this.clock.elapsedTime : 0;
    this.stopGestures(0.3);
    if (this.current) this._backToIdle(0.3);
    var dur = o.loop ? 1e9 : g.dur / (o.speed || 1);
    this.gestures.push({ name: name, def: g, t0: now, end: now + dur, speed: o.speed || 1, dir: o.dir });
    if (g.emo && !this.talking) this.setEmotion(g.emo, Math.min(dur, g.dur) + 0.5);
    return true;
  };
  Avatar.prototype.stopGestures = function (fade) {
    var now = this.clock ? this.clock.elapsedTime : 0;
    this.gestures.forEach(function (g) { g.end = Math.min(g.end, now + (fade || 0.3)); });
  };
  Avatar.prototype.isPlaying = function (name) {
    if (this.current && this.current.name === name) return true;
    return this.gestures.some(function (g) { return g.name === name; });
  };
  Avatar.prototype.busy = function () { return !!this.current || this.gestures.length > 0; };
  Avatar.prototype._applyGestures = function (t) {
    var b = this.bones, root = 0, look = null, blink = 0, yaw = 0;
    this.gestures = this.gestures.filter(function (g) { return t < g.end; });
    for (var i = 0; i < this.gestures.length; i++) {
      var g = this.gestures[i], el = (t - g.t0) * g.speed;
      var w = ease((t - g.t0) / 0.3) * ease((g.end - t) / 0.4);
      var dur = g.def.dur;
      var p = g.end > 1e8 ? (el % dur) / dur : Math.min(1, el / dur);
      var r = g.def.pose(p, el, g);
      for (var j = 0; j < r.pose.length; j++) {
        var e = r.pose[j];
        this._pose(b[e[0]], e[1], e[2], e[3], w);
      }
      root += (r.rootY || 0) * w;
      if (r.look) look = { x: r.look.x, y: r.look.y, w: w };
      blink = Math.max(blink, (r.blink || 0) * w);
      yaw += (r.yaw || 0) * w;
    }
    this.gLook = look;
    this.gYaw = yaw;
    this.yawGroup.position.y += root;
    return blink;
  };

  Avatar.prototype._backToIdle = function (fade) {
    if (!this.current) return;
    var a = this.current.action;
    this.current = null;
    if (this.idleAction) {
      this.idleAction.reset().play();
      this.idleAction.crossFadeFrom(a, fade || 0.4, false);
    } else {
      a.fadeOut(fade || 0.4);
    }
  };

  Avatar.prototype._bindEvents = function () {
    var self = this;
    var touch = function () { self.lastInteract = self.clock.elapsedTime; };
    window.addEventListener("pointermove", function (e) {
      var r = self.stage.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height * 0.25;
      self.mouse.x = clamp((e.clientX - cx) / (vw() / 2), -1, 1);
      self.mouse.y = clamp((e.clientY - cy) / (vh() / 2), -1, 1);
      if (self.clock) self.lastMouseMove = self.clock.elapsedTime;
      touch();
    }, { passive: true });
    window.addEventListener("keydown", touch);
    window.addEventListener("resize", function () { self._clampToScreen(); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && self.clock) self.clock.getDelta();
    });
  };

  Avatar.prototype.setEmotion = function (name, seconds) {
    this.emotion = name || "neutral";
    this.emotionUntil = (this.clock ? this.clock.elapsedTime : 0) + (seconds || 4);
  };

  /* ---- 位置 / 移動 ---- */
  Avatar.prototype.minX = function () { return -this.W * 0.3; };
  Avatar.prototype.maxX = function () { return vw() - this.W * 0.7; };
  Avatar.prototype.peekX = function (side) {
    return side === "left" ? -this.W * 0.66 : vw() - this.W * 0.34;
  };
  Avatar.prototype.homeX = function (side) {
    return side === "left" ? -this.W * 0.22 : vw() - this.W * 0.78;
  };
  Avatar.prototype.place = function (x, y) {
    this.x = x;
    this.y = y || 0;
    this.stage.style.transform = "translate(" + Math.round(this.x) + "px," + Math.round(-this.y) + "px)";
  };
  // 調整角色大小（s = 1 為原始大小），腳的位置保持不動
  Avatar.prototype.setScale = function (s) {
    s = clamp(s, 0.4, 2);
    var oldCenter = this.x + this.W / 2;
    this.scale = s;
    this.W = Math.round(this.baseW * s);
    this.H = Math.round(this.baseH * s);
    this.stage.style.width = this.W + "px";
    this.stage.style.height = this.H + "px";
    if (this.renderer) this.renderer.setSize(this.W, this.H);
    if (this.mode === "peek") this.place(this.peekX(this.side), 0);
    else this.place(clamp(oldCenter - this.W / 2, this.minX(), this.maxX()), this.y);
    this.onChange();
  };
  Avatar.prototype._clampToScreen = function () {
    if (this.mode === "peek") this.place(this.peekX(this.side), 0);
    else if (this.mode === "stand") this.place(clamp(this.x, this.minX(), this.maxX()), this.y);
    this.onChange();
  };
  Avatar.prototype._setMode = function (m) {
    this.mode = m;
    var c = this.stage.classList;
    c.toggle("peek-right", m === "peek" && this.side === "right");
    c.toggle("peek-left", m === "peek" && this.side === "left");
    c.toggle("walking", m === "walk");
    c.toggle("dragging", m === "drag");
    this.onChange();
  };

  // 走到某個位置（畫布左邊的 x）
  Avatar.prototype.walkTo = function (x, done) {
    if (this.current) this._backToIdle(0.3);
    this.stopGestures(0.25);
    this.targetX = x;
    this.onArrive = done || null;
    if (Math.abs(x - this.x) < 4) {
      this._setMode("stand");
      if (done) done();
      return;
    }
    this._setMode("walk");
  };

  Avatar.prototype.hide = function (side) {
    var self = this;
    if (this.mode === "peek") return;
    this.side = side || (this.x + this.W / 2 < vw() / 2 ? "left" : "right");
    this.walkTo(this.peekX(this.side), function () { self._setMode("peek"); });
  };

  Avatar.prototype.show = function (done) {
    var self = this;
    if (this.mode !== "peek") { if (done) done(); return; }
    this.walkTo(this.homeX(this.side), function () {
      self._setMode("stand");
      if (done) done();
    });
  };

  /* ---- 拖曳 ---- */
  Avatar.prototype.startDrag = function (px, py) {
    if (this.current) this._backToIdle(0.2);
    this.stopGestures(0.2);
    this.grabDX = px - this.x;
    this.grabDY = (vh() - py) - this.y;
    this.dragVX = 0;
    this.lastPX = px;
    this._setMode("drag");
    this.setEmotion("surprised", 2);
  };
  Avatar.prototype.dragTo = function (px, py, dt) {
    var nx = clamp(px - this.grabDX, -this.W * 0.6, vw() - this.W * 0.4);
    var ny = clamp((vh() - py) - this.grabDY, 0, vh() - this.H * 0.6);
    this.dragVX = this.dragVX * 0.7 + (nx - this.x) / Math.max(dt, 0.008) * 0.3;
    this.place(nx, ny);
  };
  Avatar.prototype.endDrag = function () {
    var nearLeft = this.x < this.minX() + 10;
    var nearRight = this.x > this.maxX() - 10;
    this.vy = 0;
    this.afterFall = nearLeft ? "left" : nearRight ? "right" : null;
    this._setMode("fall");
  };

  /* ---- 骨架工具：把骨頭往某個姿勢靠近（w = 0~1） ---- */
  Avatar.prototype._pose = function (bone, x, y, z, w) {
    if (!bone || w <= 0.001) return;
    this.tmpE.set(x, y, z);
    this.tmpQ.setFromEuler(this.tmpE);
    bone.quaternion.slerp(this.tmpQ, w);
  };
  Avatar.prototype._addRot = function (bone, x, y, z) {
    if (!bone) return;
    this.tmpE.set(x, y, z);
    this.tmpQ.setFromEuler(this.tmpE);
    bone.quaternion.multiply(this.tmpQ);
  };

  Avatar.prototype._loop = function () {
    var self = this;
    requestAnimationFrame(function () { self._loop(); });
    if (document.hidden || !this.vrm) return;

    var dt = Math.min(this.clock.getDelta(), 0.1);
    var t = this.clock.elapsedTime;
    var b = this.bones, em = this.vrm.expressionManager;
    var lerp = function (a, c, k) { return a + (c - a) * Math.min(1, dt * k); };

    this._updateMovement(dt, t);

    // 1) 動作（VRMA）或內建待機姿勢
    //    每幀先回到原始姿勢：動作檔沒控制到的骨頭（例如脖子）才不會因為疊加旋轉而越轉越多
    this.vrm.humanoid.resetNormalizedPose();
    this.mixer.update(dt);
    if (!this.idleAction && !this.current) {
      var breathe = Math.sin(t * 1.6);
      if (b.leftUpperArm) b.leftUpperArm.rotation.set(0, 0, -1.22 + breathe * 0.02);
      if (b.rightUpperArm) b.rightUpperArm.rotation.set(0, 0, 1.22 - breathe * 0.02);
      if (b.leftLowerArm) b.leftLowerArm.rotation.set(0, 0, -0.12);
      if (b.rightLowerArm) b.rightLowerArm.rotation.set(0, 0, 0.12);
      if (b.spine) b.spine.rotation.set(breathe * 0.015, 0, 0);
      if (b.chest) b.chest.rotation.set(breathe * 0.012, 0, 0);
      if (b.hips) b.hips.rotation.set(0, 0, Math.sin(t * 0.7) * 0.015);
    }

    // 1.5) 待機生命感：重心換腳、手肘微彎、頭轉向滑鼠＋歪頭、呼吸
    var calm = this.mode === "stand" && !(this.current && this.current.name !== "think");
    this.lifeBlend = lerp(this.lifeBlend, calm || this.mode === "peek" ? 1 : 0, 3);
    var lb = this.lifeBlend;
    if (t > this.nextWeight) {                      // 每 6～12 秒換一次重心
      this.weightSide = -this.weightSide;
      this.nextWeight = t + 6 + Math.random() * 6;
    }
    this.weightT = lerp(this.weightT, this.weightSide, 1.5);
    var ws = this.weightT;                          // -1 ~ 1：重心在左腳 / 右腳
    if (lb > 0.001 && this.mode !== "peek") {
      var br = Math.sin(t * 1.7);
      // 重心換腳：臀部往承重腳那邊移、微微傾斜（腳由 IK 固定在地上，不會滑）
      if (b.hips) {
        b.hips.position.x += ws * 0.03 * lb;
        b.hips.position.y -= (0.012 + Math.abs(ws) * 0.01) * lb;   // 膝蓋放鬆一點
      }
      this._addRot(b.hips, 0, ws * 0.04 * lb, -ws * 0.04 * lb);
      this._addRot(b.spine, br * 0.012 * lb, -ws * 0.03 * lb, -ws * 0.03 * lb);
      this._addRot(b.chest, br * 0.015 * lb, 0, -ws * 0.02 * lb);
      // 手臂靠近身體、手肘自然彎曲
      this._addRot(b.leftUpperArm, 0, 0, -0.08 * lb);
      this._addRot(b.rightUpperArm, 0, 0, 0.08 * lb);
      this._addRot(b.leftLowerArm, 0, -0.32 * lb, 0);
      this._addRot(b.rightLowerArm, 0, 0.32 * lb, 0);
    }
    // 視線：滑鼠在動就看滑鼠，滑鼠停太久就偶爾飄一下
    var lookX = this.mouse.x, lookY = this.mouse.y;
    if (t - this.lastMouseMove > 3) {
      if (t > this.glance.next) {
        this.glance = { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.3) * 0.6,
          until: t + 0.8 + Math.random() * 1.5, next: t + 3 + Math.random() * 4 };
      }
      if (t < this.glance.until) { lookX = this.glance.x; lookY = this.glance.y; }
      else { lookX = 0; lookY = 0; }
    }
    this.headLook.x = lerp(this.headLook.x, lookX, 4);
    this.headLook.y = lerp(this.headLook.y, lookY, 4);
    if (lb > 0.001) {
      var hx = this.headLook.x, hy = this.headLook.y;
      var tilt = Math.sin(t * 0.83) * 0.05 + Math.sin(t * 0.31) * 0.04 + ws * 0.04;
      this._addRot(b.neck, hy * 0.12 * lb, hx * 0.25 * lb, tilt * 0.5 * lb);
      this._addRot(b.head, hy * 0.12 * lb, hx * 0.2 * lb, tilt * 0.5 * lb);
    }

    // 2) 走路（程式產生，疊在動作上）
    this.walkBlend = lerp(this.walkBlend, this.mode === "walk" ? 1 : 0, 8);
    var wb = this.walkBlend;
    if (wb > 0.001) {
      if (this.mode === "walk") this.walkPhase += dt * 8.5;
      var p = this.walkPhase, s = Math.sin(p), c = Math.cos(p);
      this._pose(b.leftUpperLeg, -s * 0.5, 0, 0, wb);
      this._pose(b.rightUpperLeg, s * 0.5, 0, 0, wb);
      this._pose(b.leftLowerLeg, 0.1 + Math.max(0, c) * 0.7, 0, 0, wb);
      this._pose(b.rightLowerLeg, 0.1 + Math.max(0, -c) * 0.7, 0, 0, wb);
      this._pose(b.leftUpperArm, s * 0.35, 0, -1.25, wb);
      this._pose(b.rightUpperArm, -s * 0.35, 0, 1.25, wb);
      this._pose(b.leftLowerArm, 0, -0.25, 0, wb);
      this._pose(b.rightLowerArm, 0, 0.25, 0, wb);
      this._pose(b.spine, 0.05, -s * 0.06, 0, wb);
    }
    this.yawGroup.position.y = wb * Math.abs(Math.sin(this.walkPhase)) * 0.025;
    var gBlink = this._applyGestures(t);

    // 3) 被拖著：腳晃來晃去、身體跟著甩
    var dragging = this.mode === "drag" || this.mode === "fall";
    this.dragBlend = lerp(this.dragBlend, dragging ? 1 : 0, 10);
    var db = this.dragBlend;
    if (db > 0.001) {
      var sw = Math.sin(t * 6) * 0.15;
      this._pose(b.leftUpperLeg, -0.2 + sw, 0, 0.08, db);
      this._pose(b.rightUpperLeg, -0.1 - sw, 0, -0.08, db);
      this._pose(b.leftLowerLeg, 0.5, 0, 0, db);
      this._pose(b.rightLowerLeg, 0.3, 0, 0, db);
      this._pose(b.leftUpperArm, -0.25, 0, -1.05, db);
      this._pose(b.rightUpperArm, -0.25, 0, 1.05, db);
      this._pose(b.leftLowerArm, 0, -0.5, 0, db);
      this._pose(b.rightLowerArm, 0, 0.5, 0, db);
    }
    // 被拖時以胸口為軸擺動（像被抓住），平常以腳為軸
    var pivotY = db * ((this.headY || 1.4) - 0.35);
    this.leanGroup.position.y = pivotY;
    this.yawGroup.position.y -= pivotY;

    // 4) 探頭：整個人往畫面內傾，頭歪一邊，偶爾縮回去
    this.peekBlend = lerp(this.peekBlend, this.mode === "peek" ? 1 : 0, 5);
    var pb = this.peekBlend, dir = this.side === "left" ? -1 : 1;
    var bob = this.peekHover ? 0.03 : Math.sin(t * 1.3) * 0.02 + (Math.sin(t * 0.37) > 0.92 ? -0.07 : 0);
    var lean = pb * dir * (0.13 + bob) + (dragging ? clamp(-this.dragVX * 0.0004, -0.25, 0.25) * db : 0);
    this.leanGroup.rotation.z = lerp(this.leanGroup.rotation.z, lean, 10);
    if (pb > 0.001) {
      this._addRot(b.neck, 0, 0, -dir * 0.18 * pb);
    }

    // 轉身方向
    var yawGoal = 0;
    if (this.mode === "walk") yawGoal = this.targetX > this.x ? 1.3 : -1.3;
    else if (this.mode === "peek") yawGoal = -dir * 0.35;
    this.yaw = lerp(this.yaw, yawGoal, 7);
    this.yawGroup.rotation.y = this.yaw + (this.gYaw || 0);

    // 探頭時移動鏡頭，讓頭固定在畫布露出來的那一側（不同模型都適用）
    var camGoal = 0;
    if (pb > 0.01 && b.head) {
      if (!this.tmpV) this.tmpV = new this.THREE.Vector3();
      b.head.getWorldPosition(this.tmpV);
      var headX = this.tmpV.x;
      this.tmpV.project(this.camera);
      var want = -dir * 0.48;                // 頭的中心放在畫布 26% / 74% 的位置
      var halfW = Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect * this.camDist;
      camGoal = (headX - want * halfW) * pb;
    }
    this.camera.position.x = lerp(this.camera.position.x, camGoal, 6);

    // 5) 說話時點頭
    if (this.talking && b.neck) this._addRot(b.neck, Math.sin(t * 4.3) * 0.03, 0, Math.sin(t * 3.1) * 0.03);

    // 視線跟著滑鼠
    var lx = this.headLook.x, ly = this.headLook.y, gl = this.gLook;
    if (gl) { lx += (gl.x - lx) * gl.w; ly += (gl.y - ly) * gl.w; }
    this.lookTarget.position.set(lx * 1.2, -ly * 0.8, -1);

    if (em) {
      // 眨眼
      if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0;
      var blink = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        blink = Math.sin(Math.min(this.blinkT / 0.16, 1) * Math.PI);
        if (this.blinkT > 0.16) {
          this.blinkT = -1;
          // 偶爾連眨兩下
          this.nextBlink = t + (Math.random() < 0.2 ? 0.12 : 2 + Math.random() * 3.5);
        }
      }
      // 表情淡入淡出
      var target = t < this.emotionUntil || this.talking ? this.emotion : "neutral";
      for (var k in this.weights) {
        var goal = k === target ? (k === "happy" ? 0.7 : 0.6) : 0;
        if (target === "neutral" && k === "relaxed") goal = 0.35;   // 平常帶淺淺的微笑
        // 探頭時被滑鼠指到才輕輕笑一下（不用大笑，避免瞇眼張嘴的怪表情）
        if (target === "neutral" && this.mode === "peek" && this.peekHover && k === "happy") goal = 0.3;
        this.weights[k] = lerp(this.weights[k], goal, 6);
        em.setValue(k, this.weights[k]);
      }
      em.setValue("blink", Math.max(blink, gBlink) * (1 - this.weights.happy));
      // 嘴型
      var mouth = this.talking
        ? 0.35 + 0.35 * Math.abs(Math.sin(t * 13)) + 0.2 * Math.abs(Math.sin(t * 7.3)) : 0;
      if (dragging) mouth = Math.max(mouth, 0.35);
      em.setValue("aa", mouth * 0.8);
      em.setValue("oh", this.talking ? 0.15 * Math.abs(Math.sin(t * 5.1)) : 0);
    }

    // 腳部 IK：站著時把腳固定在地上、腳掌踩平
    var ikOn = (this.mode === "stand" || this.mode === "peek") &&
      !this.gestures.some(function (g) { return g.def.noIK; });
    this.ikBlend = lerp(this.ikBlend, ikOn ? 1 : 0, 8);
    if (this.ikBlend > 0.01) this._footIK(this.ikBlend, this.weightT);

    this.vrm.update(dt);
    if (this.visible) this.renderer.render(this.scene, this.camera);
  };

  /* ---- 腳部 IK（兩節骨頭解析解） ---- */
  Avatar.prototype._initFootIK = function () {
    var T = this.THREE, h = this.vrm.humanoid, self = this;
    this.ik = {};
    this.ikBlend = 0;
    this.vrm.scene.updateMatrixWorld(true);
    ["left", "right"].forEach(function (sd) {
      var up = h.getNormalizedBoneNode(sd + "UpperLeg"), lo = h.getNormalizedBoneNode(sd + "LowerLeg"),
        ft = h.getNormalizedBoneNode(sd + "Foot");
      if (!up || !lo || !ft) return;
      var rest = new T.Vector3();
      ft.getWorldPosition(rest);
      self.vrm.scene.worldToLocal(rest);     // 腳踝在模型座標中的原始位置
      self.ik[sd] = { up: up, lo: lo, ft: ft, rest: rest };
    });
    this._ikV = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
    this._ikQ = [new T.Quaternion(), new T.Quaternion(), new T.Quaternion(), new T.Quaternion(),
      new T.Quaternion(), new T.Quaternion(), new T.Quaternion()];
    this._ikX = new T.Vector3(1, 0, 0);
  };

  Avatar.prototype._footIK = function (w, ws) {
    if (!this.ik || !this.ik.left || !this.ik.right) return;
    this.leanGroup.updateMatrixWorld(true);
    var self = this, V = this._ikV, Q = this._ikQ;
    var rootQ = this.vrm.scene.getWorldQuaternion(Q[6]);
    ["left", "right"].forEach(function (sd) {
      var L = self.ik[sd], up = L.up, lo = L.lo, ft = L.ft;
      Q[0].copy(up.quaternion); Q[1].copy(lo.quaternion); Q[2].copy(ft.quaternion);
      // 目標：原始腳踝位置，雙腳稍微打開；不承重的腳往前、往外一點點
      var relax = sd === "left" ? Math.max(0, -ws) : Math.max(0, ws);
      var side = sd === "left" ? 1 : -1;
      var target = V[4].copy(L.rest);
      target.x = target.x * 1.12 + side * 0.015 * relax;
      target.z += 0.035 * relax;
      self.vrm.scene.localToWorld(target);

      var H = up.getWorldPosition(V[0]), K = lo.getWorldPosition(V[1]), A = ft.getWorldPosition(V[2]);
      var a = H.distanceTo(K), b = K.distanceTo(A);
      var d = clamp(H.distanceTo(target), Math.abs(a - b) + 1e-3, a + b - 1e-3);
      var bend = Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
      lo.quaternion.setFromAxisAngle(self._ikX, bend);          // 膝蓋只往前彎
      up.updateMatrixWorld(true);
      A = ft.getWorldPosition(V[2]);
      var from = V[3].copy(A).sub(H).normalize();
      var to = V[2].copy(target).sub(H).normalize();
      var qw = Q[3].setFromUnitVectors(from, to);
      var upW = up.getWorldQuaternion(Q[4]);
      var parInv = up.parent.getWorldQuaternion(Q[5]).invert();
      up.quaternion.copy(parInv.multiply(qw.multiply(upW)));
      up.updateMatrixWorld(true);
      // 腳掌踩平：腳的世界旋轉 = 身體基準方向
      var loInv = lo.getWorldQuaternion(Q[4]).invert();
      ft.quaternion.copy(loInv.multiply(rootQ));
      // 與原本姿勢混合
      up.quaternion.copy(Q[0].slerp(up.quaternion, w));
      lo.quaternion.copy(Q[1].slerp(lo.quaternion, w));
      ft.quaternion.copy(Q[2].slerp(ft.quaternion, w));
    });
  };

  Avatar.prototype._updateMovement = function (dt, t) {
    if (this.mode === "walk") {
      var d = this.targetX - this.x;
      var step = 120 * dt * Math.min(1, this.walkBlend * 1.5 + 0.2);
      if (Math.abs(d) <= step) {
        this.place(this.targetX, 0);
        this._setMode("stand");
        var cb = this.onArrive; this.onArrive = null;
        if (cb) cb();
      } else {
        this.place(this.x + Math.sign(d) * step, 0);
        this.onChange();
      }
    } else if (this.mode === "fall") {
      this.vy -= 2200 * dt;
      var ny = this.y + this.vy * dt;
      var nx = this.x + this.dragVX * dt * 0.3;
      this.dragVX *= 0.92;
      if (ny <= 0) {
        ny = 0;
        if (this.vy < -500) { this.vy = -this.vy * 0.25; }
        else {
          this.place(clamp(nx, this.minX(), this.maxX()), 0);
          var side = this.afterFall;
          this._setMode("stand");
          if (side) this.hide(side);
          else { this.play("surprised"); this.setEmotion("surprised", 2); }
          return;
        }
      }
      this.place(nx, ny);
      this.onChange();
    } else if (this.mode === "stand" && this.autonomy) {
      this.autonomy(t);
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. 助理主體
   * ------------------------------------------------------------------ */
  var instance = null;
  var EMOTION_ANIMS = {
    happy: ["clap", "jump", "wave", "nod"],
    sad: ["sad"], surprised: ["surprised"], angry: ["angry"],
    relaxed: ["present", "nod"], neutral: ["present", "present", "nod"]
  };

  function Assistant(opts) {
    this.opts = opts;
    this.ui = buildUI(opts);
    this.avatar = new Avatar(this.ui.stage, opts);
    this.bubbleTimer = null;
    this.speakToken = 0;
    this.pokes = [];
    this._wire();
  }

  Assistant.prototype._isOpen = function () { return this.ui.panel.classList.contains("open"); };

  Assistant.prototype._wire = function () {
    var self = this, ui = this.ui, av = this.avatar;

    // 拖曳 / 點擊
    var down = null;
    ui.hit.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), drag: false };
      ui.hit.setPointerCapture(e.pointerId);
    });
    ui.hit.addEventListener("pointermove", function (e) {
      if (av.mode === "peek") { av.peekHover = true; }
      if (!down) return;
      var now = performance.now();
      if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 && av.mode !== "peek" && av.vrm) {
        down.drag = true;
        av.startDrag(down.x, down.y);
      }
      if (down.drag) av.dragTo(e.clientX, e.clientY, (now - down.t) / 1000);
      down.t = now;
    });
    var up = function () {
      if (!down) return;
      var wasDrag = down.drag;
      down = null;
      if (wasDrag) { av.endDrag(); return; }
      self._onClick();
    };
    ui.hit.addEventListener("pointerup", up);
    ui.hit.addEventListener("pointercancel", up);
    ui.hit.addEventListener("pointerleave", function () { av.peekHover = false; });
    ui.hit.addEventListener("pointerenter", function () {
      if (av.mode === "peek" && !ui.bubble.classList.contains("show")) self._flashBubble("有什麼需要幫忙的嗎？");
    });
    ui.hit.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); self._onClick(); }
    });
    ui.hit.tabIndex = 0;

    // 右鍵選單：調整大小、聊天、躲起來、自己走動開關
    var menu = ui.menu;
    var syncMenu = function () {
      var pct = Math.round(av.scale * 100);
      ui.scale.value = pct;
      ui.scaleVal.textContent = pct + "%";
      menu.querySelector("[data-act=hide]").textContent = av.mode === "peek" ? "🚶 走出來" : "🙈 躲到旁邊";
      menu.querySelector("[data-act=wander]").textContent = (self.opts.wander ? "✅" : "⬜") + " 自己走來走去";
    };
    var closeMenu = function () { menu.classList.remove("open"); };
    ui.hit.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      syncMenu();
      menu.classList.add("open");
      var mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = clamp(e.clientX, 8, vw() - mw - 8) + "px";
      menu.style.top = clamp(e.clientY, 8, vh() - mh - 8) + "px";
    });
    ui.scale.addEventListener("input", function () {
      av.setScale(ui.scale.value / 100);
      ui.scaleVal.textContent = ui.scale.value + "%";
    });
    menu.addEventListener("click", function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (!act) return;
      if (act === "reset") { av.setScale(1); syncMenu(); return; }
      closeMenu();
      if (act === "chat") self.open();
      else if (act === "hide") { if (av.mode === "peek") self.show(false); else self.hide(); }
      else if (act === "wander") { self.opts.wander = !self.opts.wander; av.onChange(); }
    });
    document.addEventListener("pointerdown", function (e) {
      if (menu.classList.contains("open") && e.composedPath().indexOf(menu) < 0) closeMenu();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

    ui.hideBtn.addEventListener("click", function (e) { e.stopPropagation(); self.hide(); });
    ui.hide.addEventListener("click", function () { self.hide(); });
    ui.close.addEventListener("click", function () { self.close(); });
    ui.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = ui.input.value.trim();
      if (!text) return;
      ui.input.value = "";
      self.ask(text);
    });
    (this.opts.suggestions || []).forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", function () { self.ask(q); });
      ui.chips.appendChild(b);
    });

    // 角色移動時，聊天視窗跟著走；並記住位置
    av.onChange = function () {
      self._placePanel();
      ui.wrap.style.setProperty("--sh", Math.round(av.H * (1 - (av.headTop || 0.08))) + "px");
      store.set({ x: av.x, side: av.side, peek: av.mode === "peek", scale: av.scale, wander: self.opts.wander });
    };
    window.addEventListener("resize", function () { self._placePanel(); });

    // 自主行為：閒晃、小動作、打瞌睡
    av.autonomy = function (t) {
      if (av.talking || av.busy()) return;
      var idleFor = t - av.lastInteract;
      if (self.opts.wander && !self._isOpen() && t > av.nextWander) {
        av.nextWander = t + 25 + Math.random() * 30;
        var range = av.maxX() - av.minX() - av.W * 0.5;
        if (range > 200) {
          var nx = av.minX() + av.W * 0.25 + Math.random() * range;
          if (Math.abs(nx - av.x) > 120) { av.walkTo(nx); return; }
        }
      }
      if (t > av.nextGesture) {
        av.nextGesture = t + 15 + Math.random() * 20;
        var pick = idleFor > 60 ? "sleepy" : ["lookAround", "lookAround", "stretch"][Math.floor(Math.random() * 3)];
        av.play(pick);
      }
    };
  };

  Assistant.prototype._onClick = function () {
    var self = this, av = this.avatar;
    if (av.mode === "peek") { this.show(true); return; }
    if (av.mode !== "stand") return;
    // 連續戳三下會害羞
    var now = performance.now();
    this.pokes = this.pokes.filter(function (p) { return now - p < 1500; });
    this.pokes.push(now);
    if (this.pokes.length >= 3) {
      this.pokes = [];
      av.play("blush");
      self.say("不要一直戳我啦～", "happy");
      return;
    }
    if (this._isOpen()) this.close(); else this.open();
  };

  // 文字在角色的哪一邊：聊天視窗開著就看聊天視窗，否則看畫面中間（-1 左、1 右）
  Assistant.prototype._textDir = function () {
    var av = this.avatar, me = av.x + av.W / 2, target = vw() / 2;
    if (this._isOpen()) {
      var r = this.ui.panel.getBoundingClientRect();
      target = r.left + r.width / 2;
    }
    if (Math.abs(target - me) < 40) return av.side === "left" ? 1 : -1;
    return target < me ? -1 : 1;
  };

  // 對話泡泡對準頭，但不超出螢幕
  Assistant.prototype._placeBubble = function () {
    var bub = this.ui.bubble, av = this.avatar;
    var bw = bub.offsetWidth;
    if (!bw) return;
    var headX = av.x + av.W * (av.mode === "peek" ? (av.side === "left" ? 0.74 : 0.26) : 0.5);
    var left = clamp(headX - bw / 2, 8, vw() - bw - 8);
    bub.style.left = Math.round(left - av.x) + "px";
    bub.style.setProperty("--ax", clamp(headX - left, 16, bw - 16) + "px");
  };

  Assistant.prototype._placePanel = function () {
    this._placeBubble();
    var p = this.ui.panel, av = this.avatar;
    var pw = Math.min(340, vw() - 24);
    var center = av.x + av.W / 2;
    var left = clamp(center - pw / 2, 12, vw() - pw - 12);
    p.style.left = left + "px";
    var headPx = av.H * (1 - (av.headTop || 0.08)) - 10 + av.y;
    p.style.bottom = Math.max(12, headPx) + "px";
    if (headPx + 220 > vh()) p.style.bottom = "12px";
  };

  Assistant.prototype._flashBubble = function (text) {
    var ui = this.ui;
    clearTimeout(this.bubbleTimer);
    ui.bubble.textContent = text;
    this._placeBubble();
    ui.bubble.classList.add("show");
    this.bubbleTimer = setTimeout(function () { ui.bubble.classList.remove("show"); }, 2500);
  };

  Assistant.prototype.start = function () {
    var self = this, av = this.avatar;
    var saved = store.get();
    var startPeek = saved.peek !== undefined ? saved.peek : this.opts.start === "peek";
    if (saved.side) av.side = saved.side;
    if (typeof saved.wander === "boolean") this.opts.wander = saved.wander;
    var sc = typeof saved.scale === "number" ? saved.scale : this.opts.scale;
    if (sc && sc !== 1) av.setScale(sc);
    av.place(startPeek ? av.peekX(av.side)
      : (typeof saved.x === "number" ? clamp(saved.x, av.minX(), av.maxX()) : av.homeX(av.side)), 0);
    if (startPeek) av._setMode("peek");
    this._placePanel();

    var dataReady = window.VRMAssistantData ? Promise.resolve() : loadScript(this.opts.knowledge);
    var botReady = dataReady.then(function () {
      self.bot = new NaiveBayesBot(window.VRMAssistantData);
      api.bot = self.bot;
    }).catch(function (err) {
      console.error("[VRMAssistant]", err);
      self.bot = new NaiveBayesBot({ fallback: "（知識庫載入失敗）" });
      api.bot = self.bot;
    });

    var avatarReady = av.load().then(function () {
      self.ui.status.remove();
    }).catch(function (err) {
      console.error("[VRMAssistant] 角色載入失敗：", err);
      self.ui.status.remove();
      self.ui.fallback.style.display = "flex";
    });

    return Promise.all([botReady, avatarReady]).then(function () {
      if (av.mode === "peek") return;
      // 等待機動作載好再打招呼，揮手比較自然
      setTimeout(function () {
        if (self.opts.greeting) self.say(self.opts.greeting, "happy", { log: true, anim: "wave" });
      }, 600);
    });
  };

  Assistant.prototype.open = function () {
    var self = this;
    if (this.avatar.mode === "peek") { this.show(true); return; }
    this.ui.panel.classList.add("open");
    this.ui.stage.classList.add("chat-open");
    this._placePanel();
    setTimeout(function () { self.ui.input.focus(); }, 0);
  };
  Assistant.prototype.close = function () {
    this.ui.panel.classList.remove("open");
    this.ui.stage.classList.remove("chat-open");
  };
  Assistant.prototype.hide = function () {
    this.close();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    this.avatar.hide();
  };
  Assistant.prototype.show = function (openChat) {
    var self = this;
    this.avatar.show(function () {
      self.avatar.play("wave");
      self.avatar.setEmotion("happy", 3);
      if (openChat) self.open();
    });
  };

  Assistant.prototype._addMsg = function (who, text) {
    var el = document.createElement("div");
    el.className = "msg " + who;
    el.textContent = text;
    this.ui.log.appendChild(el);
    this.ui.log.scrollTop = this.ui.log.scrollHeight;
    return el;
  };

  Assistant.prototype.ask = function (text) {
    var self = this;
    this.open();
    this._addMsg("user", text);
    var typing = this._addMsg("bot typing", "…");
    this.avatar.setEmotion("neutral", 1);
    this.avatar.play("think", { speed: 1.4 });

    var answer = this.opts.api
      ? fetch(this.opts.api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
      : new Promise(function (resolve) {
          setTimeout(function () { resolve(self.bot.reply(text)); }, 600 + Math.random() * 400);
        });

    return answer.then(function (res) {
      typing.remove();
      self.say(res.reply, res.emotion || "neutral", { log: true });
      return res;
    }).catch(function (err) {
      typing.remove();
      console.error("[VRMAssistant]", err);
      self.say("抱歉，連線發生問題，請稍後再試。", "sad", { log: true });
    });
  };

  Assistant.prototype.say = function (text, emotion, o) {
    o = o || {};
    text = String(text || "");
    var self = this, ui = this.ui, avatar = this.avatar;
    var token = ++this.speakToken;
    var msgEl = o.log ? this._addMsg("bot", "") : null;

    emotion = emotion || "neutral";
    avatar.setEmotion(emotion, 4 + text.length * 0.08);
    var choices = EMOTION_ANIMS[emotion];
    var anim = o.anim !== undefined ? o.anim : choices && choices[Math.floor(Math.random() * choices.length)];
    if (anim) avatar.play(anim, { dir: this._textDir() });
    else if (avatar.isPlaying("think")) { avatar._backToIdle(0.5); avatar.stopGestures(0.5); }

    avatar.talking = true;
    clearTimeout(this.bubbleTimer);
    ui.bubble.textContent = "";
    ui.bubble.classList.add("show");

    var speaking = false;
    if (this.opts.voice && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = this.opts.lang;
      u.rate = 1.05;
      u.pitch = 1.2;
      speaking = true;
      u.onend = u.onerror = function () {
        speaking = false;
        if (token === self.speakToken) finish();
      };
      window.speechSynthesis.speak(u);
    }

    var i = 0, chars = Array.from(text), typed = false;
    (function step() {
      if (token !== self.speakToken) return;
      i++;
      var shown = chars.slice(0, i).join("");
      ui.bubble.textContent = shown;
      self._placeBubble();
      if (msgEl) { msgEl.textContent = shown; ui.log.scrollTop = ui.log.scrollHeight; }
      if (i < chars.length) setTimeout(step, /[，。！？,.!?]/.test(chars[i - 1]) ? 160 : 55);
      else { typed = true; if (!speaking) finish(); }
    })();

    function finish() {
      if (!typed || speaking) return;
      avatar.talking = false;
      self.bubbleTimer = setTimeout(function () {
        ui.bubble.classList.remove("show");
      }, 3500 + text.length * 60);
    }
  };

  /* ------------------------------------------------------------------ *
   * 6. 對外 API 與自動啟動
   * ------------------------------------------------------------------ */
  var api = {
    __loaded: true,
    NaiveBayesBot: NaiveBayesBot,
    tokenize: tokenize,
    bot: null,
    init: function (options) {
      if (instance) return api;
      var o = Object.assign({}, attrs, options || {});
      var small = vw() < 480 ? 0.78 : 1;
      var anims = o.animations || false;
      var opts = {
        model: resolveUrl(o.model || DEFAULT_MODEL),
        knowledge: resolveUrl(o.knowledge || BASE_URL + "chatbot-data.js"),
        name: o.name || "VRM 小助理",
        greeting: o.greeting === undefined ? "你好！我是你的小助理，點我就可以聊天喔～" : o.greeting,
        position: o.position || "right",
        framing: o.framing === "upper" ? "upper" : "full",
        width: Math.round((o.width || (o.framing === "upper" ? 260 : 320)) * small),
        height: Math.round((o.height || (o.framing === "upper" ? 360 : 520)) * small),
        autoWidth: !o.width && o.framing !== "upper",
        scale: +o.scale || 1,
        color: o.color || "#6c5ce7",
        voice: !!o.voice,
        lang: o.lang || "zh-TW",
        api: o.api || null,
        wander: o.wander !== false,
        start: o.start || "stand",
        animations: anims,
        suggestions: o.suggestions || ["你好", "我想查詢我的訂單", "如何申請退款？", "今天天氣如何？"]
      };
      var run = function () {
        instance = new Assistant(opts);
        instance.start();
      };
      if (document.body) run();
      else document.addEventListener("DOMContentLoaded", run);
      return api;
    },
    say: function (text, emotion) { if (instance) instance.say(text, emotion, { log: true }); },
    ask: function (text) { return instance ? instance.ask(text) : Promise.resolve(); },
    open: function () { if (instance) instance.open(); },
    close: function () { if (instance) instance.close(); },
    hide: function () { if (instance) instance.hide(); },
    show: function (openChat) { if (instance) instance.show(openChat); },
    walkTo: function (x) { if (instance) { var a = instance.avatar; a.walkTo(clamp(x - a.W / 2, a.minX(), a.maxX())); } },
    play: function (name, o) {
      if (!instance) return false;
      o = Object.assign({ dir: instance._textDir() }, o || {});
      return instance.avatar.play(name, o);
    },
    setExpression: function (name, seconds) { if (instance) instance.avatar.setEmotion(name, seconds || 5); },
    get instance() { return instance; }
  };
  window.VRMAssistant = api;

  var attrs = readAttrs(currentScript);
  if (attrs.auto !== "false") api.init();
})();
