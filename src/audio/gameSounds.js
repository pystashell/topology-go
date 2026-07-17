const MIN_GAIN = 0.0001;
const DEFAULT_VOLUME = 0.72;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * Return a deterministic description of the short, wooden stone-placement
 * sound. `variation` may be supplied in the range -1..1 to keep consecutive
 * moves from sounding mechanically identical.
 */
export function createStoneSoundPlan(at = 0, variation = 0) {
  const startAt = Math.max(0, finiteNumber(at));
  const pitchVariation = clamp(finiteNumber(variation), -1, 1);
  const pitchScale = 1 + pitchVariation * 0.045;

  return Object.freeze({
    kind: "stone",
    at: startAt,
    duration: 0.072,
    noise: Object.freeze({
      startOffset: 0,
      duration: 0.038,
      gain: 0.115,
      frequency: 1120 * pitchScale,
      q: 0.82,
    }),
    tones: Object.freeze([
      Object.freeze({
        type: "triangle",
        startOffset: 0,
        duration: 0.066,
        gain: 0.105,
        startFrequency: 228 * pitchScale,
        endFrequency: 88 * pitchScale,
      }),
      Object.freeze({
        type: "sine",
        startOffset: 0.001,
        duration: 0.029,
        gain: 0.035,
        startFrequency: 690 * pitchScale,
        endFrequency: 355 * pitchScale,
      }),
    ]),
  });
}

/**
 * Return a bounded description of the brighter capture sound. Capturing more
 * stones adds at most two closely spaced clicks and a small pitch lift, so a
 * large group never produces an excessively loud or long effect.
 */
export function createCaptureSoundPlan(count, at = 0) {
  const captured = Math.floor(finiteNumber(count));
  if (captured <= 0) return null;

  const startAt = Math.max(0, finiteNumber(at));
  const pulseCount = captured >= 6 ? 3 : captured >= 2 ? 2 : 1;
  const countLift = Math.min(260, Math.log2(captured + 1) * 68);
  const baseFrequency = 1030 + countLift;
  const tones = [];

  for (let pulse = 0; pulse < pulseCount; pulse += 1) {
    const startOffset = pulse * 0.034;
    const pulsePitch = 1 + pulse * 0.055;
    tones.push(
      Object.freeze({
        type: "triangle",
        startOffset,
        duration: 0.074,
        gain: 0.058,
        startFrequency: baseFrequency * 1.36 * pulsePitch,
        endFrequency: baseFrequency * pulsePitch,
      }),
      Object.freeze({
        type: "sine",
        startOffset: startOffset + 0.002,
        duration: 0.032,
        gain: 0.027,
        startFrequency: baseFrequency * 2.15 * pulsePitch,
        endFrequency: baseFrequency * 1.52 * pulsePitch,
      }),
    );
  }

  return Object.freeze({
    kind: "capture",
    count: captured,
    at: startAt,
    duration: 0.078 + (pulseCount - 1) * 0.034,
    noise: Object.freeze({
      startOffset: 0,
      duration: 0.046 + (pulseCount - 1) * 0.026,
      gain: 0.058,
      frequency: 2380 + countLift,
      q: 1.18,
    }),
    tones: Object.freeze(tones),
  });
}

function defaultContextFactory() {
  const AudioContextClass =
    globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}

/**
 * Small, self-contained Web Audio sound player for game events.
 *
 * Call `unlock()` from the first pointer/keyboard gesture. Playback methods are
 * still safe before that point: they try to resume the context and simply
 * return false if browser autoplay policy does not allow it yet.
 */
export class GameSounds {
  constructor({
    contextFactory = defaultContextFactory,
    enabled = true,
    volume = DEFAULT_VOLUME,
    random = Math.random,
  } = {}) {
    this.contextFactory = contextFactory;
    this.enabled = Boolean(enabled);
    this.volume = clamp(finiteNumber(volume, DEFAULT_VOLUME), 0, 1);
    this.random = typeof random === "function" ? random : Math.random;
    this.context = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.destroyed = false;
    this.unlockPromise = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.#setMasterGain(this.enabled ? this.volume : 0);
    return this.enabled;
  }

  setVolume(volume) {
    this.volume = clamp(finiteNumber(volume, DEFAULT_VOLUME), 0, 1);
    if (this.enabled) this.#setMasterGain(this.volume);
    return this.volume;
  }

  async unlock() {
    if (!this.enabled || this.destroyed) return false;
    const context = this.#ensureContext();
    if (!context) return false;
    if (context.state === "closed") return false;
    if (context.state === "running") return true;
    if (this.unlockPromise) return this.unlockPromise;

    // Calling resume immediately is important: unlock() is normally invoked
    // inside a trusted user gesture, before any await yields that activation.
    try {
      const resumeResult = context.resume?.();
      this.unlockPromise = Promise.resolve(resumeResult)
        .then(() => context.state !== "closed")
        .catch(() => false)
        .finally(() => {
          this.unlockPromise = null;
        });
      return this.unlockPromise;
    } catch {
      return false;
    }
  }

  playStone() {
    const variation = clamp(finiteNumber(this.random() * 2 - 1), -1, 1);
    return this.#play((at) => createStoneSoundPlan(at, variation));
  }

  playCapture(count) {
    if (Math.floor(finiteNumber(count)) <= 0) return Promise.resolve(false);
    return this.#play((at) => createCaptureSoundPlan(count, at));
  }

  async destroy() {
    if (this.destroyed) return false;
    this.destroyed = true;
    this.enabled = false;
    const context = this.context;
    this.context = null;
    this.noiseBuffer = null;
    try {
      this.masterGain?.disconnect?.();
    } catch {
      // Already disconnected.
    }
    this.masterGain = null;
    if (!context || context.state === "closed") return true;
    try {
      await context.close?.();
    } catch {
      // Page teardown must never be interrupted by an audio driver failure.
    }
    return true;
  }

  async #play(createPlan) {
    if (!this.enabled || this.destroyed) return false;
    const context = this.#ensureContext();
    if (!context) return false;

    if (context.state !== "running") {
      const unlocked = await this.unlock();
      if (!unlocked || context.state === "closed") return false;
    }

    try {
      const plan = createPlan(context.currentTime + 0.004);
      if (!plan) return false;
      this.#schedulePlan(plan);
      return true;
    } catch {
      // Web Audio can disappear during tab suspension or page teardown. Sound
      // is optional and must never prevent a legal move from being processed.
      return false;
    }
  }

  #ensureContext() {
    if (this.context || this.destroyed) return this.context;
    try {
      this.context = this.contextFactory?.() ?? null;
    } catch {
      this.context = null;
    }
    if (!this.context) return null;

    try {
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.enabled ? this.volume : 0;
      this.masterGain.connect(this.context.destination);
    } catch {
      try {
        this.context.close?.();
      } catch {
        // Ignore partial context construction failure.
      }
      this.context = null;
      this.masterGain = null;
    }
    return this.context;
  }

  #setMasterGain(value) {
    const parameter = this.masterGain?.gain;
    if (!parameter || !this.context || this.context.state === "closed") return;
    const now = this.context.currentTime;
    try {
      parameter.cancelScheduledValues(now);
      parameter.setTargetAtTime(value, now, 0.008);
    } catch {
      parameter.value = value;
    }
  }

  #noiseBufferForContext() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const context = this.context;
    const length = Math.max(1, Math.ceil(context.sampleRate * 0.24));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = this.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  #schedulePlan(plan) {
    this.#scheduleNoise(plan.noise, plan.at);
    for (const tone of plan.tones) this.#scheduleTone(tone, plan.at);
  }

  #scheduleNoise(noise, at) {
    const context = this.context;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const startAt = at + noise.startOffset;
    const endAt = startAt + noise.duration;

    source.buffer = this.#noiseBufferForContext();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(noise.frequency, startAt);
    filter.Q.setValueAtTime(noise.q, startAt);
    gain.gain.setValueAtTime(noise.gain, startAt);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, endAt);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(startAt, 0, noise.duration);
  }

  #scheduleTone(tone, at) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = at + tone.startOffset;
    const endAt = startAt + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(
      tone.endFrequency,
      endAt,
    );
    gain.gain.setValueAtTime(tone.gain, startAt);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, endAt);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.003);
  }
}

export function createGameSounds(options) {
  return new GameSounds(options);
}
