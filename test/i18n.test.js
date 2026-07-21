import assert from "node:assert/strict";
import test from "node:test";

import { ENGLISH_STATIC } from "../src/i18n/englishStatic.js";
import {
  LOCALE_CHINESE,
  LOCALE_ENGLISH,
  LOCALE_STORAGE_KEY,
  applyDocumentTranslations,
  getLocale,
  initializeI18n,
  resolveLocale,
  setLocale,
  subscribeLocale,
  translateText,
} from "../src/i18n.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value, childNodes: [] };
}

function element(tagName, attributes = {}, children = []) {
  const values = new Map(Object.entries(attributes));
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    hasAttribute(name) {
      return values.has(name);
    },
    getAttribute(name) {
      return values.get(name) ?? null;
    },
    setAttribute(name, value) {
      values.set(name, String(value));
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function fakeDocument(children) {
  const html = element("html", {}, children);
  html.lang = "";
  const documentValue = {
    nodeType: 9,
    documentElement: html,
    childNodes: [html],
  };
  html.ownerDocument = documentValue;
  return documentValue;
}

function dictionaryExample(excluded = null) {
  return Object.entries(ENGLISH_STATIC).find(
    ([source, target]) =>
      source !== excluded &&
      typeof source === "string" &&
      source.trim() &&
      typeof target === "string" &&
      target !== source,
  );
}

test("browser locale resolution is binary and a saved choice wins", () => {
  for (const locale of ["zh", "zh-CN", "zh-TW", "zh-HK"]) {
    assert.equal(resolveLocale({ languages: [locale] }), LOCALE_CHINESE);
  }
  for (const locale of ["en", "en-US", "fr-FR", ""]) {
    assert.equal(resolveLocale({ languages: [locale] }), LOCALE_ENGLISH);
  }
  assert.equal(
    resolveLocale({ savedLocale: "en", languages: ["zh-CN"] }),
    LOCALE_ENGLISH,
  );
  assert.equal(
    resolveLocale({ savedLocale: "zh-TW", languages: ["en-US"] }),
    LOCALE_CHINESE,
  );
  assert.equal(
    resolveLocale({ savedLocale: "corrupt", languages: ["zh-CN"] }),
    LOCALE_CHINESE,
  );
});

test("initialization safely reads storage and manual selection persists", () => {
  const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: "zh-CN" });
  const documentValue = fakeDocument([]);
  assert.equal(
    initializeI18n({
      storage,
      languages: ["en-US"],
      document: documentValue,
      observe: false,
    }),
    LOCALE_CHINESE,
  );
  assert.equal(documentValue.documentElement.lang, LOCALE_CHINESE);

  assert.equal(setLocale("en-US"), LOCALE_ENGLISH);
  assert.equal(storage.values.get(LOCALE_STORAGE_KEY), LOCALE_ENGLISH);
  assert.equal(documentValue.documentElement.lang, LOCALE_ENGLISH);

  const throwingStorage = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("disabled"); },
  };
  assert.doesNotThrow(() => initializeI18n({
    storage: throwingStorage,
    languages: ["zh-CN"],
    document: fakeDocument([]),
    observe: false,
  }));
  assert.doesNotThrow(() => setLocale("en"));
});

test("text translation supports exact copy, fallback and parameters", () => {
  const [source, english] = dictionaryExample();
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en"],
    document: fakeDocument([]),
    observe: false,
  });
  assert.equal(translateText(source), english);
  assert.equal(translateText("第 12 手"), "Move 12");
  assert.equal(
    translateText("unknown {count} / {missing}", { count: 0 }),
    "unknown 0 / {missing}",
  );
  setLocale("zh-CN", { persist: false });
  assert.equal(translateText(source), source);
});

test("lobby lifecycle and rectangular preview copy is available in English", () => {
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en-US"],
    document: fakeDocument([]),
    observe: false,
  });
  assert.equal(translateText("邀请对局"), "Invite Game");
  assert.equal(translateText("棋盘设置"), "Board Settings");
  assert.equal(translateText("邀请对局后开始"), "Starts after you invite a game");
  assert.equal(
    translateText("房间预览已更新为 30 × 20；邀请对局时会使用这套设置。"),
    "Room preview updated to 30 × 20. The invitation will use these settings.",
  );
  assert.equal(
    translateText("30 × 20 · 甜甜圈 · 中国规则 · 不计时"),
    "30 × 20 · Torus · Chinese rules · No clock",
  );
  assert.equal(
    translateText("13 × 19 · 莫比乌斯 · 日本规则 · 5 分钟 + 3×30 秒"),
    "13 × 19 · Möbius · Japanese rules · 5 min + 3×30 sec",
  );
  assert.equal(
    translateText("你将以黑方认输，对方立即获胜；不需要对方确认，此操作不能撤销。"),
    "You will resign as Black. Your opponent wins immediately; no approval is required and this cannot be undone.",
  );
  assert.equal(
    translateText("你将以白方向 KataGo b10 认输；AI 立即获胜，此操作不能撤销。"),
    "You will resign as White against KataGo b10. The AI wins immediately and this cannot be undone.",
  );
  assert.equal(
    translateText("黑方将认输，白方立即获胜；此操作不能撤销。"),
    "Black will resign. White wins immediately, and this cannot be undone.",
  );
  assert.equal(
    translateText("你执黑 · AI 执白"),
    "You play Black · AI plays White",
  );
  assert.equal(
    translateText("AI · 黑方 · b10"),
    "AI · Black · b10",
  );
  assert.equal(
    translateText("AI 对局已开始：你执黑，KataGo b10 执白。"),
    "AI game started. You play Black; KataGo b10 plays White.",
  );
  assert.equal(
    translateText("已加入房间 ABC123，你是白方。"),
    "Joined room ABC123 as White.",
  );
  assert.equal(
    translateText("轮到你了。 · 2 人观战"),
    "Your turn. · 2 spectators",
  );
  assert.equal(translateText("正在提交认输…"), "Submitting resignation…");
  assert.equal(
    translateText("白方胜 · 黑方认输。"),
    "White wins · Black resigned.",
  );
  assert.equal(
    translateText("黑方胜 · 白方超时。"),
    "Black wins · White timed out.",
  );
  assert.equal(
    translateText("本局已结束；可以直接进行下一局，或先调整下一局设置；成员和聊天记录都会保留。"),
    "This game is over. Start the next game immediately or adjust its settings first; room members and chat history will be kept.",
  );
  assert.equal(
    translateText("系统已保守预标较明确的死棋；点击棋子可修改整块棋的死活判断。"),
    "Clearly dead groups are pre-marked conservatively. Select a stone to revise its entire group's status.",
  );
  assert.equal(translateText("直接进行下一局"), "Start next game now");
  assert.equal(translateText("调整下一局设置"), "Adjust next-game settings");
  assert.equal(translateText("退出房间"), "Leave Room");
  assert.equal(
    translateText("使用当前设置开始下一局"),
    "Start next game with these settings",
  );
});

test("long AI, SGF, replay and scoring status sentences translate before generic patterns", () => {
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en-US"],
    document: fakeDocument([]),
    observe: false,
  });
  const cases = [
    ["KataGo b10 正在思考…", "KataGo b10 is thinking…"],
    ["KataGo b10 正在房主浏览器中思考…", "KataGo b10 is thinking in the host browser…"],
    [
      "现在轮到 KataGo b10 思考；你仍然可以旋转和切换棋盘视图。",
      "It is KataGo b10's turn to think. You can still rotate or change board views.",
    ],
    [
      "KataGo 已完成判断（推理 200 ms），正在由服务器验证并同步…",
      "KataGo finished evaluating (200 ms inference). The server is validating and syncing the move…",
    ],
    [
      "黑方 KataGo b10 落子，提掉 2 子（神经判断 200 ms）。",
      "Black KataGo b10 plays and captures 2 stones (200 ms neural evaluation).",
    ],
    ["KataGo b10 停一手，轮到你落子。", "KataGo b10 passes. Your turn."],
    ["D4 · 胜率 55% · 访问 20%", "D4 · win rate 55% · visits 20%"],
    ["选", "Pick"],
    [
      "已导出 game.sgf。普通 SGF 阅读器可读取棋步；异形接缝保存在 X* 扩展属性中。",
      "Exported game.sgf. Standard SGF readers can read the moves; unusual-board seams are stored in X* extension properties.",
    ],
    [
      "已导入 game.sgf，共 20 手；可播放、切换视图或做 AI 分析。",
      "Imported game.sgf with 20 moves. You can replay, change views, or run AI analysis.",
    ],
    [
      "已导入 game.sgf：原谱未写异形拓扑，按当前选择的甜甜圈复盘。",
      "Imported game.sgf. The SGF did not specify an unusual-board topology, so it will be replayed as the selected Torus.",
    ],
    [
      "复盘结束：黑方胜 · 白方认输。认输结果已还原。",
      "Replay finished: Black wins · White resigned. The resignation result was restored.",
    ],
    [
      "第 3 手：黑方落子，提掉 2 子。可随时切换平面或立体视图。",
      "Move 3: Black plays and captures 2 stones. You can switch to flat or 3D views at any time.",
    ],
    ["点目完成：黑方胜 2.5 目。", "Scoring complete: Black wins by 2.5 points."],
    ["黑方这块棋已标为死子。", "Black's group was marked dead."],
    [
      "双方连续停一手，已进入点目。系统已预标明确死棋并显示黑白领地，请核对。",
      "Both players passed. Clearly dead groups are pre-marked and Black and White territory is shown for review.",
    ],
    [
      "19 × 19 甜甜圈在线棋盘已准备好，黑方先行。",
      "19 × 19 Torus online board is ready. Black plays first.",
    ],
  ];
  for (const [source, expected] of cases) {
    assert.equal(translateText(source), expected, source);
  }
});

test("the mutation observer translates later application updates", () => {
  const [source, english] = dictionaryExample();
  class FakeMutationObserver {
    static instance = null;

    constructor(callback) {
      this.callback = callback;
      FakeMutationObserver.instance = this;
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }

    disconnect() {}
  }

  const container = element("div");
  const documentValue = fakeDocument([container]);
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en"],
    document: documentValue,
    MutationObserver: FakeMutationObserver,
  });
  const dynamicText = textNode(source);
  dynamicText.parentElement = container;
  container.childNodes.push(dynamicText);
  FakeMutationObserver.instance.callback([{
    type: "childList",
    target: container,
    addedNodes: [dynamicText],
  }]);
  assert.equal(dynamicText.nodeValue, english);
  assert.equal(FakeMutationObserver.instance.target, documentValue.documentElement);
  assert.equal(FakeMutationObserver.instance.options.characterData, true);
});

test("DOM translation retains Chinese sources across repeated switching", () => {
  const [firstSource, firstEnglish] = dictionaryExample();
  const [secondSource, secondEnglish] = dictionaryExample(firstSource);
  const text = textNode(`  ${firstSource}\n`);
  const button = element("button", {
    "aria-label": firstSource,
    title: firstSource,
  }, [text]);
  const meta = element("meta", { content: firstSource });
  const documentValue = fakeDocument([button, meta]);

  initializeI18n({
    storage: memoryStorage(),
    languages: ["en-US"],
    document: documentValue,
    observe: false,
  });
  assert.equal(text.nodeValue, `  ${firstEnglish}\n`);
  assert.equal(button.getAttribute("aria-label"), firstEnglish);
  assert.equal(button.getAttribute("title"), firstEnglish);
  assert.equal(meta.getAttribute("content"), firstEnglish);

  setLocale("zh", { persist: false });
  assert.equal(text.nodeValue, `  ${firstSource}\n`);
  assert.equal(button.getAttribute("aria-label"), firstSource);
  assert.equal(meta.getAttribute("content"), firstSource);

  setLocale("en", { persist: false });
  text.nodeValue = secondSource;
  button.setAttribute("aria-label", secondSource);
  applyDocumentTranslations(documentValue);
  assert.equal(text.nodeValue, secondEnglish);
  assert.equal(button.getAttribute("aria-label"), secondEnglish);
  setLocale("zh", { persist: false });
  assert.equal(text.nodeValue, secondSource);
  assert.equal(button.getAttribute("aria-label"), secondSource);
});

test("script/style and explicitly ignored subtrees are not translated", () => {
  const [source] = dictionaryExample();
  const scriptText = textNode(source);
  const styleText = textNode(source);
  const ignoredText = textNode(source);
  const documentValue = fakeDocument([
    element("script", {}, [scriptText]),
    element("style", {}, [styleText]),
    element("div", { "data-i18n-ignore": "" }, [ignoredText]),
  ]);
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en"],
    document: documentValue,
    observe: false,
  });
  assert.equal(scriptText.nodeValue, source);
  assert.equal(styleText.nodeValue, source);
  assert.equal(ignoredText.nodeValue, source);
});

test("locale subscriptions fire only for an actual language change", () => {
  initializeI18n({
    storage: memoryStorage(),
    languages: ["en"],
    document: fakeDocument([]),
    observe: false,
  });
  const changes = [];
  const unsubscribe = subscribeLocale((next, previous) => {
    changes.push([next, previous]);
  });
  setLocale("en", { persist: false });
  setLocale("zh-CN", { persist: false });
  unsubscribe();
  setLocale("en", { persist: false });
  assert.deepEqual(changes, [[LOCALE_CHINESE, LOCALE_ENGLISH]]);
  assert.equal(getLocale(), LOCALE_ENGLISH);
});
