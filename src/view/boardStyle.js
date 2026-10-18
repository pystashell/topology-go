import * as THREE from "three";

import { GAME_GO, GAME_GOMOKU, GAME_OTHELLO, isGameType } from "../game/gameTypes.js";

/**
 * Per-game board looks shared by every renderer. A missing or unknown style
 * is Go, so callers that never pass one keep the classic wooden Go board.
 */

/** @returns {{gameType: "go"|"gomoku"|"othello"}} */
export function normalizeBoardStyle(boardStyle = null) {
  const gameType = boardStyle?.gameType;
  return { gameType: isGameType(gameType) ? gameType : GAME_GO };
}

/** Othello is played on green felt; Go and Gomoku keep the wooden board. */
export function boardUsesFelt(boardStyle) {
  return boardStyle?.gameType === GAME_OTHELLO;
}

/** Othello pieces are flat two-sided discs rather than lens-shaped stones. */
export function boardUsesDiscs(boardStyle) {
  return boardStyle?.gameType === GAME_OTHELLO;
}

/** Hoshi along one side of a Go board (the established view logic). */
export function starIndices(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  const center = Math.floor(size / 2);
  if (size < 7) return [center];
  const offset = Math.max(2, Math.round(size * 0.28));
  return [center - offset, center, center + offset];
}

// The standard 15x15 Gomoku/Renju board marks tengen and the four 4-4 points.
const GOMOKU_15_STARS = Object.freeze([
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
]);

/**
 * Star points for a board, row-major. Go keeps the rows x columns product of
 * starIndices (unchanged order); Gomoku uses the five standard 15x15 points
 * and otherwise the Go logic; Othello has none.
 */
export function starPointsFor({ width, height, gameType = GAME_GO } = {}) {
  if (gameType === GAME_OTHELLO) return [];
  if (gameType === GAME_GOMOKU && width === 15 && height === 15) {
    return GOMOKU_15_STARS.map(([row, col]) => ({ row, col }));
  }
  const columns = starIndices(width);
  return starIndices(height).flatMap((row) =>
    columns.map((col) => ({ row, col })),
  );
}

/** Colours for the green felt Othello board (3D hex values and 2D CSS). */
export const FELT_STYLE = Object.freeze({
  surfaceColor: 0xe4f2e6,
  innerColor: 0x123a24,
  gridColor: 0x0b2416,
  flatGradient: Object.freeze(["#34965e", "#2a8150", "#1f6a40"]),
  flatGrid: "rgba(8, 34, 19, 0.82)",
  flatSpeckleDark: "rgba(6, 40, 20, 0.16)",
  flatSpeckleLight: "rgba(170, 236, 190, 0.1)",
});

/** Flat-view disc colours (top face and rim). */
export const DISC_STYLE = Object.freeze({
  black: Object.freeze({ face: "#191d1b", rim: "rgba(255, 255, 255, 0.14)", edge: "#050706" }),
  white: Object.freeze({ face: "#f3f1e8", rim: "rgba(0, 0, 0, 0.13)", edge: "#b9bdb6" }),
});

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A deterministic speckled green felt texture for the 3D surfaces. */
export function createFeltTexture(renderer, { repeat = [3, 3] } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, "#2f8f58");
  gradient.addColorStop(0.5, "#2a8551");
  gradient.addColorStop(1, "#257b4b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const random = seededRandom(0x0f17);
  for (let index = 0; index < 7000; index += 1) {
    context.fillStyle =
      random() < 0.55 ? FELT_STYLE.flatSpeckleDark : FELT_STYLE.flatSpeckleLight;
    context.fillRect(random() * 256, random() * 256, 1.4, 1.4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (renderer?.capabilities?.getMaxAnisotropy) {
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return texture;
}

/**
 * A unit-radius bevelled disc, symmetric about its mid-plane like the
 * flattened-sphere stones, so it drops into every stone transform (including
 * the two-sided Mobius placement). Scaled by a stone's half thickness it is a
 * little thinner than a Go stone.
 */
export function createDiscGeometry(segments = 48) {
  const profile = [
    [0, -0.8],
    [0.88, -0.8],
    [0.97, -0.74],
    [1, -0.58],
    [1, 0.58],
    [0.97, 0.74],
    [0.88, 0.8],
    [0, 0.8],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, segments);
}
