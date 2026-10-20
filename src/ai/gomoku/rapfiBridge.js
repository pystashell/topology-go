import { loadModelPart, openModelCache, purgeModel } from "../modelCache.js";

/**
 * Piskvork-protocol driver for Rapfi, a Gomoku/Renju engine by the Rapfi
 * developers (GPL-3.0-or-later, https://github.com/dhbloo/rapfi), built to
 * WebAssembly by scripts/build-rapfi.sh into public/engines/rapfi/ (see
 * SOURCE.md there). Weights are the CC0 mix9svq networks from
 * https://github.com/dhbloo/rapfi-networks.
 *
 * The build is single-threaded: every protocol command runs synchronously
 * inside sendCommand(), including a whole search. To stay cancellable the
 * driver searches in short node-limited slices and yields to the event loop
 * between them; Rapfi keeps its transposition table across BOARD commands,
 * so each slice resumes almost where the previous one stopped.
 *
 * Only flat square boards from 5 to 22 lines exist for Rapfi; callers map
 * topology boards onto such a board first (flatView.js).
 */

export const RAPFI_VERSION = "0.43.02";
export const RAPFI_COMMIT = "3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7";
export const RAPFI_LICENSE = "GPL-3.0-or-later";
export const RAPFI_SOURCE_URL = `https://github.com/dhbloo/rapfi/tree/${RAPFI_COMMIT}`;
export const RAPFI_ASSET_PATH = "/engines/rapfi/";
export const RAPFI_MIN_BOARD_SIZE = 5;
export const RAPFI_MAX_BOARD_SIZE = 22;
// Longest BOARD record (stones plus passes) a 22 x 22 Rapfi board can hold.
const MAX_RECORD_LENGTH = RAPFI_MAX_BOARD_SIZE * RAPFI_MAX_BOARD_SIZE;

const GLUE_FILE = "rapfi-single-simd128.mjs";
const WASM_FILE = "rapfi-single-simd128.wasm";
// Relative to this module in a source checkout (Node tests, scripts). Kept in
// a variable so bundlers leave it alone.
const NODE_ENGINE_DIR = "../../../public/engines/rapfi/";
const MEMFS_DIR = "/rapfi";
const CLASSICAL_MODEL = Object.freeze({ file: "model210901.bin", bytes: 30_109 });

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * NNUE networks per rule set. Each loads lazily, only when that rule is
 * played at a level that uses it and the flat board size is supported.
 */
export const RAPFI_NETWORKS = Object.freeze({
  freestyle: Object.freeze({
    id: "rapfi-mix9svq-freestyle",
    boardSizes: Object.freeze(range(13, 22)),
    files: Object.freeze([
      Object.freeze({ file: "mix9svqfreestyle_bsmix.bin.lz4", bytes: 10_030_398 }),
    ]),
    weights: Object.freeze([Object.freeze({ weight_file: "mix9svqfreestyle_bsmix.bin.lz4" })]),
  }),
  renju: Object.freeze({
    id: "rapfi-mix9svq-renju",
    boardSizes: Object.freeze([15]),
    files: Object.freeze([
      Object.freeze({ file: "mix9svqrenju_bs15_black.bin.lz4", bytes: 9_984_172 }),
      Object.freeze({ file: "mix9svqrenju_bs15_white.bin.lz4", bytes: 9_844_944 }),
    ]),
    weights: Object.freeze([Object.freeze({
      weight_file_black: "mix9svqrenju_bs15_black.bin.lz4",
      weight_file_white: "mix9svqrenju_bs15_white.bin.lz4",
    })]),
  }),
});

// Piskvork "INFO RULE" ids: 0 = five or more wins, 4 = Renju.
const RULE_IDS = Object.freeze({ freestyle: 0, renju: 4 });

/** Whether Rapfi has an NNUE network for this rule and flat board size. */
export function rapfiNetworkSupports(ruleSet, size) {
  return RAPFI_NETWORKS[ruleSet]?.boardSizes.includes(size) ?? false;
}

/** Total download in bytes of a rule set's network. */
export function rapfiNetworkBytes(ruleSet) {
  return RAPFI_NETWORKS[ruleSet]?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0;
}

// A minimal module whose only function returns i8x16.splat(i32.const 0).
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type: () -> v128
  0x03, 0x02, 0x01, 0x00, // one function of type 0
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x0b, // body
]);

/** Whether this runtime can run the SIMD128 build. */
export function wasmSimdSupported() {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export class RapfiUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RapfiUnavailableError";
  }
}

export class RapfiCancelledError extends Error {
  constructor() {
    super("Rapfi search cancelled");
    this.name = "AbortError";
    this.code = "CANCELLED";
  }
}

function isNodeRuntime() {
  return typeof process === "object" && Boolean(process.versions?.node) &&
    typeof globalThis.WorkerGlobalScope === "undefined" && typeof globalThis.window === "undefined";
}

/** Directory URL holding the engine files for this runtime. */
export function defaultRapfiBaseUrl() {
  if (isNodeRuntime()) return new URL(NODE_ENGINE_DIR, import.meta.url);
  return new URL(RAPFI_ASSET_PATH, globalThis.location?.href ?? "http://localhost/");
}

async function defaultLoadBytes(url) {
  if (url.protocol === "file:") {
    const fsModule = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ fsModule);
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url.href);
  if (!response.ok) {
    throw new Error(`Rapfi download failed (${response.status}): ${url.pathname}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Network weights in the browser come through Cache Storage (modelCache.js),
 * so a 10-20 MB download happens once; file URLs read straight from disk.
 */
function createWeightLoader(loadBytes) {
  let cachePromise = null;
  return async function loadWeight(network, file, url) {
    if (url.protocol === "file:") return loadBytes(url);
    cachePromise ??= openModelCache();
    const cache = await cachePromise;
    const model = {
      id: network.id,
      shortLabel: network.id,
      compressedBytes: file.bytes,
      parts: [url.pathname],
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { bytes, cached } = await loadModelPart(model, url.pathname, {
        cache,
        baseUrl: url.href,
        label: `Rapfi network ${file.file}`,
      });
      if (bytes.byteLength === file.bytes) return bytes;
      if (!cached) break;
      await purgeModel(cache, model, url.href);
    }
    throw new Error(`Rapfi network ${file.file} has an unexpected size`);
  };
}

function configToml(network) {
  const lines = [
    "[requirement]",
    "min_version = [0,43,1]",
    "[general]",
    "reload_config_each_move = false",
    "clear_hash_after_config_loaded = false",
    "default_thread_num = 1",
    'message_mode = "brief"',
    'coord_conversion_mode = "none"',
    'default_candidate_range = "square3_line4"',
    "memory_reserved_mb = 0",
    "default_tt_size_kb = 16384",
    "[model]",
    `binary_file = "${MEMFS_DIR}/${CLASSICAL_MODEL.file}"`,
  ];
  if (network) {
    lines.push(
      "[model.evaluator]",
      'type = "mix9svq"',
      "draw_black_winrate = 0.5",
      "draw_ratio = 1.0",
    );
    for (const entry of network.weights) {
      lines.push("[[model.evaluator.weights]]");
      for (const [key, file] of Object.entries(entry)) {
        lines.push(`${key} = "${MEMFS_DIR}/${file}"`);
      }
    }
  }
  lines.push(
    "[search]",
    "aspiration_window = true",
    "num_iteration_after_mate = 24",
    "num_iteration_after_singular_root = 24",
    "max_search_depth = 99",
    "[search.timectl]",
    "match_space = 21.0",
    "match_space_min = 7.0",
    "average_branch_factor = 1.7",
    "advanced_stop_ratio = 0.9",
    "move_horizon = 64",
    "",
  );
  return lines.join("\n");
}

const NODE_SUFFIX = { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** Parse the "MESSAGE Speed .. | Depth d-s | Eval v | Node n | Time t" line. */
function parseStats(line) {
  const match = /Depth (\d+)-(\d+) \| Eval (\S+) \| Node (\d+)([KMGT]?)/.exec(line);
  if (!match) return null;
  const evalText = match[3];
  const mate = /^([+-])M(\d+)$/.exec(evalText);
  return {
    depth: Number(match[1]),
    selDepth: Number(match[2]),
    score: mate ? null : Number.parseInt(evalText, 10),
    mate: mate ? (mate[1] === "+" ? 1 : -1) * Number(mate[2]) : null,
    nodes: Number(match[4]) * NODE_SUFFIX[match[5]],
  };
}

function parseSearchOutput(lines) {
  let move = null;
  let stats = null;
  let bestline = null;
  const errors = [];
  for (const raw of lines) {
    const line = raw.trim();
    const coords = /^(-?\d+),(-?\d+)$/.exec(line);
    if (coords) {
      move = { x: Number(coords[1]), y: Number(coords[2]) };
    } else if (line.startsWith("MESSAGE Speed")) {
      stats = parseStats(line) ?? stats;
    } else if (line.startsWith("MESSAGE Bestline ")) {
      bestline = line.slice("MESSAGE Bestline ".length);
    } else if (line.startsWith("ERROR")) {
      errors.push(line);
    }
  }
  return { move, stats, bestline, errors };
}

/**
 * The BOARD record for a position: Black's entry first (Rapfi takes the
 * first entry as Black), colours alternating with explicit passes where one
 * colour has no stone left, ending with the side to move on turn. Never two
 * passes in a row. Stones keep the caller's order within each colour.
 */
export function boardRecord(stones, toMove) {
  const byColor = {
    black: stones.filter((stone) => stone.color === "black"),
    white: stones.filter((stone) => stone.color === "white"),
  };
  const next = { black: 0, white: 0 };
  const record = [];
  let turn = "black";
  while (next.black < byColor.black.length || next.white < byColor.white.length) {
    const stone = byColor[turn][next[turn]];
    if (stone) {
      record.push({ x: stone.x, y: stone.y, color: turn });
      next[turn] += 1;
    } else {
      record.push({ pass: true, color: turn });
    }
    turn = turn === "black" ? "white" : "black";
  }
  if (turn !== toMove) record.push({ pass: true, color: turn });
  return record;
}

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal) {
  if (signal?.aborted) throw new RapfiCancelledError();
}

/**
 * One Rapfi WebAssembly instance and its protocol state. Searches are
 * serialized; think() may be awaited from several callers.
 */
export class RapfiEngine {
  #module;
  #sink;
  #queue = Promise.resolve();
  #baseUrl;
  #loadBytes;
  #loadWeight;
  #networkPromises = new Map();
  #readyNetworks = new Set();
  #configName = null;
  #boardKey = null;
  #options = new Map();
  #broken = null;
  // Last measured search speed (nodes per millisecond) per evaluator.
  #speed = new Map();

  /** @private Use RapfiEngine.load(). */
  constructor(module, sink, { baseUrl, loadBytes, loadWeight }) {
    this.#module = module;
    this.#sink = sink;
    this.#baseUrl = baseUrl;
    this.#loadBytes = loadBytes;
    this.#loadWeight = loadWeight;
    this.version = RAPFI_VERSION;
  }

  /**
   * Instantiate the engine (glue + wasm, about 1.3 MB) and its tiny classical
   * evaluation model. Networks load later, per rule set.
   *
   * @param {object} [options]
   * @param {URL|string} [options.baseUrl] Directory holding the engine files.
   * @param {(url: URL) => Promise<Uint8Array>} [options.loadBytes]
   * @param {(network: object, file: object, url: URL) => Promise<Uint8Array>} [options.loadWeight]
   * @returns {Promise<RapfiEngine>}
   */
  static async load({ baseUrl = defaultRapfiBaseUrl(), loadBytes = defaultLoadBytes, loadWeight } = {}) {
    if (!wasmSimdSupported()) {
      throw new RapfiUnavailableError("This browser cannot run WebAssembly SIMD, which Rapfi needs");
    }
    const base = new URL(baseUrl);
    const sink = { lines: [] };
    let module;
    try {
      const [glue, wasmBinary, classical] = await Promise.all([
        import(/* @vite-ignore */ new URL(GLUE_FILE, base).href),
        loadBytes(new URL(WASM_FILE, base)),
        loadBytes(new URL(CLASSICAL_MODEL.file, base)),
      ]);
      module = await glue.default({
        wasmBinary,
        locateFile: (path) => new URL(path, base).href,
        onReceiveStdout: (line) => sink.lines.push(line),
        onReceiveStderr: (line) => sink.lines.push(line),
        onExit: () => {},
        print: (line) => sink.lines.push(line),
        printErr: (line) => sink.lines.push(line),
      });
      module.FS.mkdir(MEMFS_DIR);
      module.FS.writeFile(`${MEMFS_DIR}/${CLASSICAL_MODEL.file}`, classical);
    } catch (error) {
      throw new RapfiUnavailableError(`Rapfi failed to start: ${error?.message ?? error}`, { cause: error });
    }
    const engine = new RapfiEngine(module, sink, {
      baseUrl: base,
      loadBytes,
      loadWeight: loadWeight ?? createWeightLoader(loadBytes),
    });
    engine.#useConfig(null);
    return engine;
  }

  /** Whether the instance has crashed and must be replaced. */
  get broken() {
    return this.#broken !== null;
  }

  /** Run `task` after every earlier exclusive task has settled. */
  exclusive(task) {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => {});
    return run;
  }

  /**
   * Send one protocol command (with its data lines) and return the lines it
   * printed. Rapfi runs the command to completion before this returns.
   */
  command(text) {
    if (this.#broken) throw this.#broken;
    this.#sink.lines = [];
    try {
      this.#module.sendCommand(text);
    } catch (error) {
      this.#broken = new RapfiUnavailableError(`Rapfi stopped: ${error?.message ?? error}`, { cause: error });
      throw this.#broken;
    }
    const lines = this.#sink.lines;
    this.#sink.lines = [];
    return lines;
  }

  /** Whether the rule set's network is in the engine's file system. */
  networkReady(ruleSet) {
    return this.#readyNetworks.has(ruleSet);
  }

  /**
   * Download (or read from Cache Storage) a rule set's network and copy it
   * into the engine. Idempotent; a failed load may be retried later.
   *
   * @param {'freestyle'|'renju'} ruleSet
   * @param {{onProgress?: (info: object) => void}} [options]
   */
  loadNetwork(ruleSet, { onProgress } = {}) {
    const network = RAPFI_NETWORKS[ruleSet];
    if (!network) return Promise.reject(new TypeError(`No Rapfi network for ${ruleSet}`));
    if (this.#readyNetworks.has(ruleSet)) return Promise.resolve();
    let promise = this.#networkPromises.get(ruleSet);
    if (!promise) {
      promise = (async () => {
        const totalBytes = rapfiNetworkBytes(ruleSet);
        let loadedBytes = 0;
        const files = await Promise.all(network.files.map(async (file) => {
          const bytes = await this.#loadWeight(network, file, new URL(file.file, this.#baseUrl));
          loadedBytes += bytes.byteLength;
          onProgress?.({ ruleSet, loadedBytes, totalBytes });
          return { file, bytes };
        }));
        for (const { file, bytes } of files) {
          this.#module.FS.writeFile(`${MEMFS_DIR}/${file.file}`, bytes);
        }
        this.#readyNetworks.add(ruleSet);
      })();
      this.#networkPromises.set(ruleSet, promise);
      promise.catch(() => this.#networkPromises.delete(ruleSet));
    }
    return promise;
  }

  #useConfig(ruleSet) {
    const name = ruleSet ?? "classical";
    if (this.#configName === name) return;
    const path = `${MEMFS_DIR}/config-${name}.toml`;
    this.#module.FS.writeFile(path, configToml(ruleSet ? RAPFI_NETWORKS[ruleSet] : null));
    const output = this.command(`RELOADCONFIG ${path}`);
    if (output.some((line) => line.startsWith("ERROR"))) {
      throw new RapfiUnavailableError(`Rapfi rejected its configuration: ${output.join(" | ")}`);
    }
    this.#configName = name;
  }

  #setOption(name, value) {
    if (this.#options.get(name) === value) return;
    this.command(`INFO ${name} ${value}`);
    this.#options.set(name, value);
  }

  #useBoard(size, ruleSet) {
    const key = `${size}:${ruleSet}`;
    if (this.#boardKey === key) return;
    this.#setOption("RULE", RULE_IDS[ruleSet]);
    const output = this.command(`START ${size}`);
    if (!output.includes("OK")) {
      throw new RapfiUnavailableError(`Rapfi could not start a ${size}x${size} board`);
    }
    this.#boardKey = key;
  }

  #usesNetwork({ network, ruleSet, size }) {
    return Boolean(network) && this.networkReady(ruleSet) && rapfiNetworkSupports(ruleSet, size);
  }

  /**
   * One synchronous search slice. See think() for the request fields.
   * @returns {{move: {x: number, y: number}|null, stats: object|null, bestline: string|null, errors: string[], finished: boolean, ms: number, evaluator: string}}
   */
  searchSlice({ size, ruleSet, network, stones, toMove, blocks = [], maxNodes, maxDepth = 99, strength = 100 }) {
    if (!(size >= RAPFI_MIN_BOARD_SIZE && size <= RAPFI_MAX_BOARD_SIZE)) {
      throw new RangeError(`Rapfi boards are ${RAPFI_MIN_BOARD_SIZE}-${RAPFI_MAX_BOARD_SIZE} lines`);
    }
    if (!(ruleSet in RULE_IDS)) throw new TypeError(`Unknown rule set: ${ruleSet}`);
    const record = boardRecord(stones, toMove);
    if (record.length > MAX_RECORD_LENGTH) {
      throw new RangeError("Position record is too long for Rapfi");
    }
    const useNetwork = this.#usesNetwork({ network, ruleSet, size });
    this.#useConfig(useNetwork ? ruleSet : null);
    this.#useBoard(size, ruleSet);
    this.#setOption("TIMEOUT_TURN", 0);
    this.#setOption("TIMEOUT_MATCH", 0);
    this.#setOption("MAX_NODE", Math.max(1, Math.round(maxNodes)));
    this.#setOption("MAX_DEPTH", Math.max(2, Math.round(maxDepth)));
    this.#setOption("STRENGTH", Math.max(0, Math.min(100, Math.round(strength))));
    this.command("YXBLOCKRESET");
    if (blocks.length > 0) {
      this.command(`YXBLOCK\n${blocks.map(({ x, y }) => `${x},${y}`).join("\n")}\nDONE`);
    }
    const lines = record.map((entry) => {
      const side = entry.color === toMove ? 1 : 2;
      return entry.pass ? `-1,-1,${side}` : `${entry.x},${entry.y},${side}`;
    });
    const started = performance.now();
    const output = this.command(`BOARD\n${lines.length ? `${lines.join("\n")}\n` : ""}DONE`);
    const ms = performance.now() - started;
    const result = parseSearchOutput(output);
    // A slice that stopped well short of its node budget ended on its own:
    // depth cap, a proven result, or a trivial move.
    const finished = result.stats === null || result.stats.nodes < 0.9 * maxNodes;
    return { ...result, finished, ms, evaluator: useNetwork ? "mix9svq" : "classical" };
  }

  /**
   * Search a flat position until the deadline, in node-limited slices that
   * yield to the event loop so `signal` can stop the search promptly.
   *
   * @param {object} request
   * @param {number} request.size Flat board side (5..22).
   * @param {'freestyle'|'renju'} request.ruleSet
   * @param {boolean} [request.network] Use the NNUE network when loaded.
   * @param {Array<{x: number, y: number, color: 'black'|'white'}>} request.stones
   *   Stones in play order (the latest move last).
   * @param {'black'|'white'} request.toMove
   * @param {Array<{x: number, y: number}>} [request.blocks] Root moves Rapfi
   *   must not choose (YXBLOCK).
   * @param {number} request.deadline performance.now() at which to stop.
   * @param {number} [request.maxDepth]
   * @param {number} [request.strength] 0..100 (Rapfi's skill handicap).
   * @param {number} [request.sliceMs=120]
   * @param {AbortSignal} [request.signal]
   * @param {(info: object) => void} [request.onProgress]
   */
  think(request) {
    return this.exclusive(async () => {
      const { deadline, signal, onProgress, sliceMs = 120 } = request;
      throwIfAborted(signal);
      // Nodes per millisecond, refined after every slice. Without an earlier
      // measurement the first slice is short and only calibrates.
      const speedKey = this.#usesNetwork(request) ? request.ruleSet : "classical";
      let speed = this.#speed.get(speedKey) ?? (speedKey === "classical" ? 200 : 30);
      let calibrated = this.#speed.has(speedKey);
      let best = null;
      let depth = 0;
      let totalNodes = 0;
      let slices = 0;
      let evaluator = null;
      for (;;) {
        const remaining = deadline - performance.now();
        if (best && remaining < 10) break;
        const budget = Math.max(10, Math.min(calibrated ? sliceMs : 40, remaining));
        const slice = this.searchSlice({ ...request, maxNodes: Math.max(200, speed * budget) });
        slices += 1;
        evaluator = slice.evaluator;
        if (slice.move) {
          best = slice;
          depth = Math.max(depth, slice.stats?.depth ?? 0);
          totalNodes += slice.stats?.nodes ?? 0;
        }
        if (slice.stats && slice.ms > 5 && !slice.finished) {
          speed = Math.max(1, Math.min(5000, slice.stats.nodes / slice.ms));
          this.#speed.set(slice.evaluator === "classical" ? "classical" : request.ruleSet, speed);
          calibrated = true;
        }
        onProgress?.({ depth, nodes: totalNodes, evaluator });
        if (!slice.move || slice.finished) break;
        await yieldToEventLoop();
        throwIfAborted(signal);
      }
      if (!best?.move) return null;
      return {
        move: best.move,
        depth,
        nodes: totalNodes,
        score: best.stats?.score ?? null,
        mate: best.stats?.mate ?? null,
        bestline: best.bestline,
        evaluator,
        slices,
      };
    });
  }
}
