/**
 * Echo Cancellation
 *
 * Server-side residual-based echo cancellation for the standalone server Silero
 * VAD path and the client-side Silero VAD path. NOT used by integrated VAD
 * providers (e.g. Deepgram) which manage their own audio pipeline.
 *
 * Approach adapted from Mario Zechner's "shitty robot" / pibot write-up
 * (https://mariozechner.at/posts/2026-05-30-shitty-robot/):
 *   - Keep a ring buffer of recently transmitted TTS audio (PCM16 24kHz mono).
 *   - For each incoming mic chunk, cross-correlate it against the ring buffer
 *     over a range of candidate delays (20ms..420ms).
 *   - Pick the delay/scale that best explains the echo component and subtract
 *     the scaled reference from the mic to produce a residual.
 *   - The residual is what flows to VAD and STT, so genuine user speech is
 *     preserved while the echo component is removed. This restores barge-in
 *     (VAD can hear the user through the speaker) and keeps captions
 *     intelligible (STT receives full-volume residual, not -10dB attenuated).
 *
 * Hot path: called once per `input_audio_buffer.append` event (~every 100ms).
 * Target wall time: < 5ms per call. Plain `for` loops, no allocations in inner
 * loops. A single module-scoped Float32Array scratch buffer is reused across
 * calls (safe because JS is single-threaded and the function never awaits
 * between reads and writes of the scratch).
 */

/** Minimum candidate echo delay (ms) searched during cross-correlation. */
export const MIN_DELAY_MS = 20;
/** Maximum candidate echo delay (ms) searched during cross-correlation. */
export const MAX_DELAY_MS = 420;

/** Default ring buffer capacity: 3.0s @ 24kHz mono PCM16 = 72000 samples. */
export const MAX_PLAYBACK_SAMPLES = Math.ceil(3.0 * 24000);

/** Coarse delay search step in samples (~3.3ms at 24kHz). */
const DELAY_STEP_SAMPLES = 80;

/** Minimum echo energy required to actually subtract the echo estimate. */
const ECHO_ENERGY_FLOOR = 1e-6;

/** Minimum reference energy for a delay candidate to be considered valid. */
const REF_ENERGY_EPS = 1e-9;

// ---------------------------------------------------------------------------
// Module-scoped scratch buffers (single-threaded JS, no concurrency concerns).
// Reused across residualEchoCancel calls to avoid per-call allocation.
// ---------------------------------------------------------------------------
let micScratch: Float32Array | null = null;
let refScratch: Float32Array | null = null;

function ensureMicScratch(length: number): Float32Array {
  if (!micScratch || micScratch.length < length) {
    micScratch = new Float32Array(length);
  }
  return micScratch;
}

function ensureRefScratch(length: number): Float32Array {
  if (!refScratch || refScratch.length < length) {
    refScratch = new Float32Array(length);
  }
  return refScratch;
}

/**
 * Ring buffer of recently transmitted TTS audio in PCM16 little-endian,
 * 24kHz mono. Stores up to `maxSamples` samples; older samples are overwritten
 * once capacity is reached. Tracks an absolute sample counter so callers can
 * request arbitrary historical ranges by absolute offset.
 */
export class PlaybackRingBuffer {
  /** PCM16 LE bytes, length = maxSamples * 2. */
  private readonly bytes: Uint8Array;
  /** Write cursor in samples (mod maxSamples). */
  private writePos = 0;
  /** Total samples written since construction (absolute offset source). */
  private totalWritten = 0;
  /** Capacity in samples (not bytes). */
  private readonly maxSamples: number;

  /**
   * @param maxSamples Ring capacity in 16-bit samples. Defaults to
   *                   {@link MAX_PLAYBACK_SAMPLES} (~500ms at 24kHz).
   */
  constructor(maxSamples: number = MAX_PLAYBACK_SAMPLES) {
    if (maxSamples <= 0) {
      throw new Error(`PlaybackRingBuffer: maxSamples must be > 0, got ${maxSamples}`);
    }
    this.maxSamples = Math.floor(maxSamples);
    this.bytes = new Uint8Array(this.maxSamples * 2);
  }

  /** Append PCM16 LE samples to the ring, overwriting oldest data on wrap. */
  push(pcm16Samples: Uint8Array): void {
    if (pcm16Samples.length === 0) return;

    // If the input is larger than the entire ring, only the last maxSamples
    // samples matter — copy them in a single contiguous write.
    if (pcm16Samples.length >= this.bytes.length) {
      const srcStart = pcm16Samples.length - this.bytes.length;
      this.bytes.set(pcm16Samples.subarray(srcStart));
      this.writePos = 0;
      this.totalWritten += pcm16Samples.length / 2;
      return;
    }

    const byteLen = pcm16Samples.length;
    const startByte = this.writePos * 2;
    const capacityBytes = this.bytes.length;

    if (startByte + byteLen <= capacityBytes) {
      // Single contiguous copy.
      this.bytes.set(pcm16Samples, startByte);
    } else {
      // Wrap-around: two copies.
      const firstLen = capacityBytes - startByte;
      this.bytes.set(pcm16Samples.subarray(0, firstLen), startByte);
      this.bytes.set(pcm16Samples.subarray(firstLen), 0);
    }

    this.writePos = (this.writePos + byteLen / 2) % this.maxSamples;
    this.totalWritten += byteLen / 2;
  }

  /**
   * Read `lengthSamples` samples starting at absolute sample offset
   * `startSampleAbs` as a Float32Array in [-1, 1].
   *
   * @returns Float32Array of length `lengthSamples`, or `null` if the
   *          requested range is not fully available (either never written or
   *          evicted from the ring).
   */
  getRange(startSampleAbs: number, lengthSamples: number): Float32Array | null {
    if (lengthSamples <= 0) return new Float32Array(0);
    if (startSampleAbs < 0) return null;
    if (this.totalWritten < startSampleAbs + lengthSamples) return null;

    // Oldest still-available sample's absolute offset.
    const oldest = Math.max(0, this.totalWritten - this.maxSamples);
    if (startSampleAbs < oldest) return null;

    const out = new Float32Array(lengthSamples);
    // Position of startSampleAbs in the ring (in samples).
    const ringStart = (this.writePos + startSampleAbs - this.totalWritten + this.maxSamples) % this.maxSamples;

    for (let i = 0; i < lengthSamples; i++) {
      const ringIdx = (ringStart + i) % this.maxSamples;
      const byteIdx = ringIdx * 2;
      const lo = this.bytes[byteIdx];
      const hi = this.bytes[byteIdx + 1];
      let sample = (hi << 8) | lo;
      if (sample >= 0x8000) sample -= 0x10000;
      out[i] = sample / 0x8000;
    }
    return out;
  }

  /** Total samples written since construction (absolute offset source). */
  getTotalWritten(): number {
    return this.totalWritten;
  }

  /** Ring capacity in samples. */
  getCapacity(): number {
    return this.maxSamples;
  }

  /** Reset the ring (clears write cursor and total counter). */
  clear(): void {
    this.writePos = 0;
    this.totalWritten = 0;
  }
}

/**
 * Result of residual echo cancellation.
 *
 * @property residual  Mic audio with the estimated echo component subtracted
 *                     (PCM16 LE bytes, same length as input). When no echo
 *                     estimate is available, this is the original mic input.
 * @property echoEnergy  Sum-of-squares of the subtracted echo component
 *                       (Float64). 0 when nothing was subtracted.
 * @property micEnergy   Sum-of-squares of the original mic input (Float64).
 *                       Always computed, even when no subtraction happens.
 */
export interface ResidualEchoCancelResult {
  residual: Uint8Array;
  echoEnergy: number;
  micEnergy: number;
}

/**
 * Residual-based echo cancellation.
 *
 * Cross-correlates the mic chunk against the recent TTS playback history at
 * candidate delays in [MIN_DELAY_MS, MAX_DELAY_MS], picks the best-fit Wiener
 * scale, and subtracts the scaled reference from the mic to produce a
 * residual. The residual preserves genuine user speech while removing the
 * echo component, restoring barge-in detection and caption quality.
 *
 * @param micPcm16      Incoming mic audio (PCM16 LE, 24kHz mono).
 * @param ringBuffer    Ring buffer of recently played TTS audio. When null/
 *                      undefined or empty, the mic is returned unchanged.
 * @param sampleRateHz  Sample rate of the mic audio (default 24000).
 * @returns {@link ResidualEchoCancelResult} with residual + energy metrics.
 */
export function residualEchoCancel(
  micPcm16: Uint8Array,
  ringBuffer: PlaybackRingBuffer | undefined | null,
  sampleRateHz: number = 24000,
): ResidualEchoCancelResult {
  const N = micPcm16.length / 2;

  // Always compute mic energy (cheap, useful for callers' telemetry).
  let micEnergy = 0;
  {
    const mic = ensureMicScratch(N);
    for (let i = 0; i < N; i++) {
      const lo = micPcm16[i * 2];
      const hi = micPcm16[i * 2 + 1];
      let sample = (hi << 8) | lo;
      if (sample >= 0x8000) sample -= 0x10000;
      mic[i] = sample / 0x8000;
      micEnergy += mic[i] * mic[i];
    }
  }

  // No echo possible yet — pass mic through unchanged.
  if (!ringBuffer || ringBuffer.getTotalWritten() === 0 || N === 0) {
    return { residual: micPcm16, echoEnergy: 0, micEnergy };
  }

  const totalWritten = ringBuffer.getTotalWritten();
  const minDelay = Math.floor(sampleRateHz * (MIN_DELAY_MS / 1000));
  const maxDelay = Math.floor(sampleRateHz * (MAX_DELAY_MS / 1000));

  let bestEchoEnergy = 0;
  let bestAlpha = 0;
  let bestDelay = -1;

  const mic = micScratch!; // populated above

  // Coarse delay sweep. For each candidate delay, compute the Wiener scale
  // alpha = cc / refEnergy and the captured echo energy = alpha * cc.
  for (let delay = minDelay; delay <= maxDelay; delay += DELAY_STEP_SAMPLES) {
    const refStart = totalWritten - delay - N;
    if (refStart < 0) continue;

    const ref = ringBuffer.getRange(refStart, N);
    if (!ref) continue;

    // Reuse scratch for ref so we don't allocate per delay candidate.
    const refBuf = ensureRefScratch(N);
    refBuf.set(ref);

    let cc = 0;
    let refEnergy = 0;
    for (let i = 0; i < N; i++) {
      cc += mic[i] * refBuf[i];
      refEnergy += refBuf[i] * refBuf[i];
    }

    if (refEnergy <= REF_ENERGY_EPS) continue;

    const alpha = cc / refEnergy;
    if (alpha <= 0) continue;

    const echoEnergy = alpha * cc;
    if (echoEnergy > bestEchoEnergy) {
      bestEchoEnergy = echoEnergy;
      bestAlpha = alpha;
      bestDelay = delay;
    }
  }

  // Nothing worth subtracting — return mic unchanged.
  if (bestDelay < 0 || bestEchoEnergy < ECHO_ENERGY_FLOOR) {
    return { residual: micPcm16, echoEnergy: 0, micEnergy };
  }

  // Build the residual: mic - alpha * ref_best, encoded back to PCM16 LE.
  const refStart = totalWritten - bestDelay - N;
  const refBest = ringBuffer.getRange(refStart, N);
  if (!refBest) {
    // Should not happen since we just read it, but be defensive.
    return { residual: micPcm16, echoEnergy: 0, micEnergy };
  }

  const residual = new Uint8Array(micPcm16.length);
  for (let i = 0; i < N; i++) {
    const lo = micPcm16[i * 2];
    const hi = micPcm16[i * 2 + 1];
    let micSample = (hi << 8) | lo;
    if (micSample >= 0x8000) micSample -= 0x10000;

    const micFloat = micSample / 0x8000;
    const residualFloat = micFloat - bestAlpha * refBest[i];

    // Clamp and convert back to int16.
    let out = Math.round(Math.max(-1, Math.min(1, residualFloat)) * 0x7FFF);
    if (out < 0) out += 0x10000;
    residual[i * 2] = out & 0xff;
    residual[i * 2 + 1] = (out >> 8) & 0xff;
  }

  return { residual, echoEnergy: bestEchoEnergy, micEnergy };
}