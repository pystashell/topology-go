/// <reference lib="webworker" />

import { attachGameAiWorker } from "./gameAiWorkerHost.js";
import { chooseFallbackMove, fallbackEngineInfo } from "./fallbackAi.js";

// The fallback Gomoku/Othello AI as a module worker speaking the shared
// game-AI protocol (init / choose-move / cancel). It needs no WebAssembly.
attachGameAiWorker(self, {
  init: async () => fallbackEngineInfo(),
  choose: (position, settings, { signal }) => chooseFallbackMove(position, settings, { signal }),
});
