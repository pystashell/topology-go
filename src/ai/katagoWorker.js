/// <reference lib="webworker" />

import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgpu";
import pako from "pako";

import {
  chooseMonteCarloMoveAsync,
  SearchCancelledError,
} from "./mcts.js";
import { TOPOLOGY_TORUS } from "../game/goEngine.js";
import { attachKataGoWorkerRuntime } from "./katagoWorkerRuntime.js";
import { getAIModel } from "./modelCatalog.js";
import {
  buildCylinderFeatures,
  policyPriorsFromLogits,
} from "./katago/cylinderFeatures.js";
import { parseKataGoModelV8 } from "./katago/vendor/loadModelV8.ts";
import { KataGoModelV8Tf } from "./katago/vendor/modelV8.ts";

let modelPromise = null;
let loadingModelId = null;
let productionModeEnabled = false;

async function initializeBackend(model) {
  if (self.navigator?.gpu) {
    try {
      await tf.setBackend("webgpu");
      await tf.ready();
      if (tf.getBackend() !== "webgpu") {
        throw new Error("TensorFlow.js did not activate WebGPU");
      }
      return "webgpu";
    } catch {
      // WebGL is a broadly available and fast fallback for this compact model.
    }
  }
  if (model.requiresWebGPU) {
    throw new Error(
      `${model.name} 仅支持桌面端 WebGPU。当前浏览器无法启用 WebGPU，请改用 b10。`,
    );
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

async function downloadModel(model, postStatus) {
  if (model.parts.length === 1) {
    const response = await fetch(model.parts[0], { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`KataGo model download failed (${response.status})`);
    }
    const downloaded = new Uint8Array(await response.arrayBuffer());
    postStatus("loading_model", {
      modelId: model.id,
      loadedBytes: downloaded.byteLength,
      totalBytes: model.compressedBytes,
      partIndex: 1,
      partCount: 1,
    });
    return downloaded;
  }

  const downloaded = new Uint8Array(model.compressedBytes);
  let offset = 0;
  for (let index = 0; index < model.parts.length; index += 1) {
    const response = await fetch(model.parts[index], { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(
        `KataGo ${model.shortLabel} model part ${index + 1} download failed (${response.status})`,
      );
    }
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (offset + chunk.byteLength > downloaded.byteLength) {
      throw new Error(`KataGo ${model.shortLabel} model parts exceed the expected size`);
    }
    downloaded.set(chunk, offset);
    offset += chunk.byteLength;
    postStatus("loading_model", {
      modelId: model.id,
      loadedBytes: offset,
      totalBytes: model.compressedBytes,
      partIndex: index + 1,
      partCount: model.parts.length,
    });
  }
  if (offset !== downloaded.byteLength) {
    throw new Error(
      `KataGo ${model.shortLabel} model is incomplete (${offset}/${downloaded.byteLength} bytes)`,
    );
  }
  return downloaded;
}

async function loadModel(scope, id, modelId, postStatus) {
  const modelSpec = getAIModel(modelId);
  if (modelPromise) {
    if (loadingModelId !== modelSpec.id) {
      throw new Error("AI 模型已切换，请重新启动分析线程。");
    }
    return modelPromise;
  }
  loadingModelId = modelSpec.id;
  modelPromise = (async () => {
    postStatus("loading_model", {
      modelId: modelSpec.id,
      loadedBytes: 0,
      totalBytes: modelSpec.compressedBytes,
      partIndex: 0,
      partCount: modelSpec.parts.length,
    });
    const backend = await initializeBackend(modelSpec);
    if (!productionModeEnabled) {
      tf.enableProdMode();
      productionModeEnabled = true;
    }

    const downloaded = await downloadModel(modelSpec, postStatus);
    // Some static servers treat the .gz suffix as HTTP Content-Encoding and
    // transparently decompress the response before fetch exposes it. Other
    // hosts return the gzip bytes unchanged. Accept both behaviours.
    const isGzip = downloaded[0] === 0x1f && downloaded[1] === 0x8b;
    const raw = isGzip ? pako.ungzip(downloaded) : downloaded;
    const parsed = parseKataGoModelV8(raw);
    const model = new KataGoModelV8Tf(parsed);
    return {
      model,
      modelId: modelSpec.id,
      backend,
      modelName: parsed.modelName,
      compressedBytes: modelSpec.compressedBytes,
    };
  })().catch((error) => {
    modelPromise = null;
    loadingModelId = null;
    throw error;
  });
  return modelPromise;
}

async function neuralPolicy({ scope, id, modelId, state, signal, postStatus }) {
  const loaded = await loadModel(scope, id, modelId, postStatus);
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
    output = loaded.model.forwardPolicyValue(
      spatial,
      global,
      state.topology === TOPOLOGY_TORUS,
    );
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
      modelId: loaded.modelId,
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
