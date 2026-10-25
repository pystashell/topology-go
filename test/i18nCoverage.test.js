import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateText } from "../src/i18n.js";
import { APP_SOURCE_FILES } from "./helpers/appSource.js";

// Guards the English UI against untranslated Chinese. Every Chinese string or
// template literal in the client sources below must render without Chinese
// in English, either through an exact dictionary entry or a pattern. Template
// placeholders are filled with representative values so patterns that wrap a
// captured term (a colour, a topology, an error) are exercised too.

const CJK = /[\u3400-\u9fff\uff01-\uff60\u3000-\u303f]/u;

const SOURCES = [
  ...APP_SOURCE_FILES,
  "src/multiplayer/roomClient.js",
  "src/multiplayer/lobbyClient.js",
];
// src/ui/gameUi.js composes its copy from typed inputs; test/gameUi.test.js
// renders every sentence it can produce in English instead.

// Literals that are only ever glued into a longer sentence; the full sentence
// is what the dictionary translates (each is noted where it is composed).
const FRAGMENTS = new Set([
  "；", // sgfImportWarningSummary joins compatibility notes
  "，提掉 ${} 子", // "...落子，提掉 N 子。" move announcements
  "（推理 ${} ms）", // "KataGo 已完成判断（推理 N ms），..."
  "（神经判断 ${} ms）", // "... 落子（神经判断 N ms）。"
  "（另有 ${} 项）", // "兼容提示：...（另有 N 项）。"
  " · ${} 人观战", // appended to the room hint
  " · ${}", // optional detail suffixes
  " · 贴目 ${}", // boardSettingsSummary komi segment
  "第 ${} 手 · ", // reviewStageText prefixes
  "${} · ",
  "整局分析 ${} / ${} · 第 ${} 手 · ",
]);

// Representative values for template placeholders, matched on the
// expression's source text. The first matching rule wins.
const SAMPLES = [
  [/colorName\(.*\)\.replace\(/u, "黑"],
  [/colorName\(|^roleText$/u, "黑方"],
  [/sanitizeRoomCode\(/u, "AB23CD"],
  [/^inferenceDetail$/u, "（推理 120 ms）"],
  [/^detail$/u, "b10 · WEBGL · 搜索 120 次"],
  [/topology(?:Surface)?Name\(|lobbyTopologyLabel\(/u, "竹筒"],
  [/formatResult\(/u, "白方胜 · 黑方认输"],
  [/currentAIName\(\)/u, "KataGo b10 竹筒混合 AI"],
  [/\.shortLabel$/u, "b10"],
  [/\.downloadLabel$/u, "约 11 MB"],
  [/(?:getAIModel\([^)]*\)|model)\.name$/u, "KataGo b10"],
  [/formatReviewMove\(/u, "D4"],
  [/lobbyUpdatedLabel\(/u, "3 分钟前"],
  [/boardDimensionLabel\(|^dimensions$/u, "9 × 9"],
  [/localizedErrorMessage\(|^message$|^reason$|\.message$/u, "等待服务器确认超时。"],
  [/^stagePrefix$/u, "第 3 手 · "],
  [/^rule$/u, "中国规则"],
  [/^komiLabel$/u, " · 贴目 7.5"],
  [/clockSettingsLabel\(/u, "不计时"],
  [/^coordinate$/u, "D4"],
  [/seamNotes\.join\(/u, "A列与末列相邻"],
  [/^progress$/u, " · 1.0 / 10.6 MB"],
  [/^detailText$/u, "只导入了主分支"],
  [/^(?:warningSummary|replayNote)$/u, " 可随时切换平面或立体视图。"],
  [/^availableViewCopy$/u, "平面或立体视图"],
  [/^(?:topologyNote)$/u, "普通 SGF 阅读器可读取棋步；异形接缝保存在 X* 扩展属性中。"],
  [/^(?:scoringNote|captured|captureMessage|neuralDetail)$/u, ""],
  [/^recordedResultAtEnd$/u, "B+R"],
  [/^(?:link)$/u, "https://example.test/online/AB23CD"],
  [/(?:Name|name|label|Label|\.code|roomCode|RoomCode|pending|code|emoji|filename|file\.name)$/u, "AB23CD"],
];

function sampleFor(expression) {
  const expr = expression.trim();
  // Already translated at runtime.
  if (expr.startsWith("translateText(")) return "Black";
  const ternary = /^[^?]+\?\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*:/u.exec(expr);
  if (ternary) return renderLiteral(ternary[1]);
  const fallback = /\|\|\s*("(?:[^"\\]|\\.)*")\s*$/u.exec(expr);
  if (fallback && !SAMPLES.some(([rule]) => rule.test(expr))) return renderLiteral(fallback[1]);
  for (const [rule, value] of SAMPLES) if (rule.test(expr)) return value;
  return "7";
}

function renderLiteral(literal) {
  if (literal.startsWith("`")) {
    return literal.slice(1, -1).replace(/\$\{([^}]*)\}/gu, (_, inner) => sampleFor(inner));
  }
  return JSON.parse(literal);
}

/** Minimal JavaScript lexer: string and template literals outside comments. */
export function literalsIn(source) {
  const found = [];
  let index = 0;
  let previous = "";
  const length = source.length;
  const readString = (quote) => {
    let value = "";
    index += 1;
    while (index < length && source[index] !== quote) {
      if (source[index] === "\\") {
        value += JSON.parse(`"${source.slice(index, index + 2).replace(/^\\'/u, "'")}"`);
        index += 2;
        continue;
      }
      value += source[index];
      index += 1;
    }
    index += 1;
    return value;
  };
  const readTemplate = () => {
    const parts = [""];
    const expressions = [];
    index += 1;
    while (index < length && source[index] !== "`") {
      if (source[index] === "\\") {
        parts[parts.length - 1] += source[index + 1];
        index += 2;
        continue;
      }
      if (source[index] === "$" && source[index + 1] === "{") {
        index += 2;
        const start = index;
        let depth = 1;
        while (index < length) {
          const char = source[index];
          if (char === "'" || char === '"') { readString(char); continue; }
          if (char === "`") { found.push({ kind: "template", ...readTemplate() }); continue; }
          if (char === "{") depth += 1;
          if (char === "}" && (depth -= 1) === 0) break;
          index += 1;
        }
        expressions.push(source.slice(start, index));
        parts.push("");
        index += 1;
        continue;
      }
      parts[parts.length - 1] += source[index];
      index += 1;
    }
    index += 1;
    return { parts, expressions };
  };
  while (index < length) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2) + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      found.push({ kind: "string", value: readString(char) });
      previous = "literal";
      continue;
    }
    if (char === "`") {
      found.push({ kind: "template", ...readTemplate() });
      previous = "literal";
      continue;
    }
    if (char === "/" && /^(?:[(,=:[!&|?{};]|return|typeof|)$/u.test(previous)) {
      // A regular expression literal.
      index += 1;
      let inClass = false;
      while (index < length) {
        const current = source[index];
        if (current === "\\") { index += 2; continue; }
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        index += 1;
      }
      index += 1;
      previous = "literal";
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(char)) {
      let word = "";
      while (index < length && /[A-Za-z0-9_$.]/u.test(source[index])) word += source[index++];
      previous = word;
      continue;
    }
    if (!/\s/u.test(char)) previous = char;
    index += 1;
  }
  return found;
}

function untranslatedLiterals(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const failures = [];
  for (const literal of literalsIn(source)) {
    const key = literal.kind === "string" ? literal.value : literal.parts.join("${}");
    if (FRAGMENTS.has(key)) continue;
    const sample = literal.kind === "string"
      ? literal.value
      : literal.parts.reduce((text, part, index) =>
        `${text}${part}${index < literal.expressions.length ? sampleFor(literal.expressions[index]) : ""}`, "");
    // A template can be all placeholders yet still render Chinese words
    // (e.g. "9 × 9 竹筒"), so check what it renders, not only its source.
    if (!CJK.test(key) && !CJK.test(sample)) continue;
    const english = translateText(sample.trim(), {}, "en");
    if (CJK.test(english)) failures.push(`${key}\n      sample: ${sample.trim()}\n      english: ${english}`);
  }
  return failures;
}

for (const path of SOURCES) {
  test(`every Chinese literal in ${path} has English copy`, () => {
    const failures = untranslatedLiterals(path);
    assert.deepEqual(failures, [], `untranslated literals:\n  ${failures.join("\n  ")}`);
  });
}

test("every Chinese text and attribute in index.html has English copy", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
    .replace(/<script[\s\S]*?<\/script>/gu, "");
  const texts = new Set();
  for (const match of html.matchAll(/>([^<>]+)</gu)) {
    const text = match[1].replace(/\s+/gu, " ").trim();
    if (CJK.test(text)) texts.add(text);
  }
  for (const match of html.matchAll(/\s(?:aria-label|title|placeholder|content|data-[a-z-]+-label|data-[a-z-]+-hint)="([^"]*)"/gu)) {
    if (CJK.test(match[1])) texts.add(match[1]);
  }
  // The language switch names Chinese in Chinese on purpose (lang="zh-CN").
  texts.delete("中文");
  const failures = [...texts].filter((text) => CJK.test(translateText(text, {}, "en")));
  assert.ok(texts.size > 200);
  assert.deepEqual(failures, []);
});

test("the literal scanner sees templates, fragments and comments correctly", () => {
  const literals = literalsIn([
    "// 注释里的中文不会被检查",
    "const a = `你好 ${colorName(x)} · ${y ? \"甲\" : \"乙\"}`;",
    "const b = /\"[^\"]*\"/u.test(c) ? '黑方' : \"白方\";",
  ].join("\n"));
  assert.deepEqual(
    literals.map((literal) => literal.kind === "string" ? literal.value : literal.parts.join("${}")),
    ["你好 ${} · ${}", "黑方", "白方"],
  );
  assert.equal(sampleFor('y ? "甲" : "乙"'), "甲");
  assert.equal(sampleFor("colorName(game.currentPlayer)"), "黑方");
});
