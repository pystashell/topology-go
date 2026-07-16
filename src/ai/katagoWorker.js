/// <reference lib="webworker" />

import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgpu";
import pako from "pako";

import {
  chooseMonteCarloMoveAsync,
  SearchCancelledError,
} from "./mcts.js";
import { attachKataGoWorkerRuntime } from "./katagoWorkerRuntime.js";
import {
  buildCylinderFeatures,
  policyPriorsFromLogits,
} from "./katago/cylinderFeatures.js";
import { parseKataGoModelV8 } from "./katago/vendor/loadModelV8.ts";
import { KataGoModelV8Tf } from "./katago/vendor/modelV8.ts";

const MODEL_URL = "/models/katago-b10c128.bin.gz";
let modelPromise = null;
let productionModeEnabled = false;

async function initializeBackend() {
  if (self.navigator?.gpu) {
    try {
      await tf.setBackend("webgpu");
      await tf.ready();
      return tf.getBackend();
    } catch {
      // WebGL is a broadly available and fast fallback for this compact model.
    }
  }
  try {
    await tf.setBackend("webgl");
    await tf.ready();
  } catch {
    await tf.setBackend("cpu");
    await tf.ready();
  }
  return tf.getBackend();
}

async function loadModel(scope, id, postStatus) {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    postStatus("loading_model");
    const backend = await initializeBackend();
    if (!productionModeEnabled) {
      tf.enableProdMode();
      productionModeEnabled = true;
    }

    const response = await fetch(MODEL_URL, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`KataGo model download failed (${response.status})`);
    }
    const downloaded = new Uint8Array(await response.arrayBuffer());
    // Some static servers treat the .gz suffix as HTTP Content-Encoding and
    // transparently decompress the response before fetch exposes it. Other
    // hosts return the gzip bytes unchanged. Accept both behaviours.
    const isGzip = downloaded[0] === 0x1f && downloaded[1] === 0x8b;
    const raw = isGzip ? pako.ungzip(downloaded) : downloaded;
    const parsed = parseKataGoModelV8(raw);
    const model = new KataGoModelV8Tf(parsed);
    return {
      model,
      backend,
      modelName: parsed.modelName,
      compressedBytes:
        Number(response.headers.get("content-length")) || downloaded.byteLength,
    };
  })().catch((error) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

async function neuralPolicy({ scope, id, state, signal, postStatus }) {
  const loaded = await loadModel(scope, id, postStatus);
  if (signal.aborted) throw new SearchCancelledError();
  postStatus("neural_inference", { backend: loaded.backend });
  const features = buildCylinderFeatures(state);
  const startedAt = performance.now();
  const spatial = tf.tensor4d(features.spatial, [
    1,
    features.size,
    features.size,
    22,
  ]);
  const global = tf.tensor2d(features.global, [1, 19]);
  let output = null;
  try {
    output = loaded.model.forwardPolicyValue(spatial, global);
    const [policy, pass] = await Promise.all([
      output.policy.data(),
      output.policyPass.data(),
    ]);
    if (signal.aborted) throw new SearchCancelledError();
    return {
      priors: policyPriorsFromLogits({
        policy,
        pass,
        gameOrState: state,
        policyChannels: loaded.model.policyOutChannels,
      }),
      inferenceMs: performance.now() - startedAt,
      backend: loaded.backend,
      modelName: loaded.modelName,
      compressedBytes: loaded.compressedBytes,
    };
  } finally {
    spatial.dispose();
    global.dispose();
    output?.policy.dispose();
    output?.policyPass.dispose();
    output?.value.dispose();
    output?.scoreValue.dispose();
  }
}

export function attachKataGoWorker(scope) {
  return attachKataGoWorkerRuntime(scope, {
    neuralPolicy,
    chooseMove: chooseMonteCarloMoveAsync,
    isCancellationError(error) {
      return (
        error instanceof SearchCancelledError || error?.name === "AbortError"
      );
    },
  });
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  attachKataGoWorker(self);
}
