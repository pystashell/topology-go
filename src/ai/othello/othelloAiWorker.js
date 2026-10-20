/// <reference lib="webworker" />

/**
 * Module worker for the Topology Othello AI: plain JavaScript, no network.
 * Create it with
 *   new Worker(new URL("./othello/othelloAiWorker.js", import.meta.url), { type: "module" })
 * and speak the game-AI worker protocol (see othelloAiWorkerHandler.js).
 */

import { createOthelloAiWorkerHandler } from "./othelloAiWorkerHandler.js";

const handleMessage = createOthelloAiWorkerHandler((message) => self.postMessage(message));

self.addEventListener("message", (event) => handleMessage(event.data));
