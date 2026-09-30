import { performance } from "node:perf_hooks";
import { GoEngine } from "../src/game/goEngine.js";

// Deterministic mid/late-game positions with a full 32-entry undo window.
function fixture(size, moves) {
  const game = new GoEngine({ size, topology: "torus" });
  let seed = 42;
  let played = 0;
  for (let attempt = 0; played < moves && attempt < size * size * 100; attempt++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const point = seed % (size * size);
    if (game.play(Math.floor(point / size), point % size).ok) played++;
  }
  if (played !== moves) throw new Error("Could not construct benchmark position");
  return game;
}

function measure(create, iterations = 120) {
  for (let index = 0; index < 10; index++) create().pass();
  const start = performance.now();
  for (let index = 0; index < iterations; index++) create().pass();
  const msPerExpansion = (performance.now() - start) / iterations;
  // A retained batch after full GC is a heap estimate, not peak process memory.
  let retainedHeapBytesPerClone = null;
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    const retained = Array.from({ length: 40 }, create);
    global.gc();
    retainedHeapBytesPerClone = Math.round((process.memoryUsage().heapUsed - before) / retained.length);
  }
  return { msPerExpansion: Number(msPerExpansion.toFixed(3)), retainedHeapBytesPerClone };
}

const results = [];
for (const [size, moves] of [[19, 140], [19, 240], [25, 240], [25, 400]]) {
  const game = fixture(size, moves);
  results.push({ size, moves, historyPositions: game.positionHistory.size, undoEntries: game.undoHistory.length,
    previous: { stateBytes: Buffer.byteLength(JSON.stringify(game.exportState({ includeReplay: false }))),
      ...measure(() => GoEngine.fromState(game.exportState({ includeReplay: false }))) },
    search: { stateBytes: Buffer.byteLength(JSON.stringify(game.exportSearchState())),
      ...measure(() => GoEngine.fromSearchState(game.exportSearchState())) },
  });
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
  method: "120 clone-plus-pass expansions; 40 retained clones after GC; deterministic torus positions. Not whole-AI throughput or peak memory.", results }, null, 2));
