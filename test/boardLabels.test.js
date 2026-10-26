import assert from "node:assert/strict";
import test from "node:test";

import { translateText } from "../src/i18n.js";
import { boardGameName, boardViewLabel } from "../src/view/boardStyle.js";
import { FlatBoard } from "../src/view/FlatBoard.js";

/*
 * Board views and the board area are labelled for screen readers with the
 * board's shape and the game it shows (they used to say Go for every game),
 * in Chinese and in English.
 */

const KINDS = ["flat-cylinder", "flat-torus", "flat-mobius", "arc", "3d-cylinder", "3d-torus", "3d-mobius"];
const GAMES = [["go", "围棋", "Go"], ["gomoku", "五子棋", "Gomoku"], ["othello", "黑白棋", "Othello"]];
const CJK = /[㐀-鿿]/u;

test("every view label names the game shown, in Chinese and English", () => {
  assert.equal(boardGameName(), "围棋", "no style is Go");
  assert.equal(boardGameName({ gameType: "chess" }), "围棋");
  for (const [gameType, chinese, english] of GAMES) {
    assert.equal(boardGameName({ gameType }), chinese);
    for (const kind of KINDS) {
      const label = boardViewLabel(kind, { gameType });
      assert.ok(label.includes(chinese), `${kind}: ${label}`);
      for (const [, other] of GAMES) {
        if (other !== chinese) assert.ok(!label.includes(other), `${kind} names only ${chinese}`);
      }
      const translated = translateText(label, {}, "en");
      assert.ok(!CJK.test(translated), `${kind} ${gameType}: ${translated}`);
      assert.ok(translated.includes(english), `${kind} ${gameType}: ${translated}`);
      assert.ok(!/Baduk/u.test(translated), "the old name is gone");
    }
  }
});

test("the page's board-area labels translate for every game and shape", () => {
  for (const [, chinese, english] of GAMES) {
    for (const label of [
      `左右相连的竹筒${chinese}棋盘区域`,
      `上下左右相连的甜甜圈${chinese}棋盘区域`,
      `左右反向相连、上下保留边界的莫比乌斯${chinese}棋盘区域`,
      `可旋转的3D竹筒${chinese}棋盘`,
      `可旋转的3D甜甜圈${chinese}棋盘`,
      `可旋转的3D莫比乌斯${chinese}棋盘`,
    ]) {
      const translated = translateText(label, {}, "en");
      assert.ok(!CJK.test(translated) && translated.includes(english), translated);
    }
  }
});

test("the flat view relabels itself for the game and the shape", () => {
  const attributes = {};
  const flat = Object.assign(Object.create(FlatBoard.prototype), {
    canvas: { setAttribute: (name, value) => { attributes[name] = value; } },
    wrapRows: false,
    isMobius: true,
    boardStyle: { gameType: "othello" },
  });
  flat.updateAriaLabel();
  // In the page's current language.
  assert.equal(attributes["aria-label"], translateText(boardViewLabel("flat-mobius", { gameType: "othello" })));
  flat.wrapRows = true;
  flat.isMobius = false;
  flat.boardStyle = { gameType: "gomoku" };
  flat.refreshLanguage();
  assert.equal(attributes["aria-label"], translateText(boardViewLabel("flat-torus", { gameType: "gomoku" })));
});
