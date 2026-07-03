/**
 * Server-Side Barge-In Detector
 *
 * Classifies whether the mic is mostly user speech vs mostly TTS echo.
 * Runs AFTER `residualEchoCancel` which has already subtracted the echo
 * component. We compute:
 *   - micRms: RMS of the residual signal (after echo subtraction)
 *   - residualRatio: (micEnergy - echoEnergy) / micEnergy = fraction of mic
 *     energy that is NOT explained by the echo
 *
 * Triggers barge-in when both exceed thresholds for N consecutive frames
 * (hysteresis). The engine then calls `handleInterruptSpeechStart` to feed
 * the existing `confirm_before_cancel` interrupt pipeline.
 *
 * Reuses `residualEchoCancel` for cross-correlation — this class only does
 * classification on the residual + energy metrics.
 *
 * Defaults match the pibot calibration (micThreshold=0.018, residualThreshold=0.62,
 * triggerFrames=5) but may need re-tuning for post-residualEchoCancel audio
 * (see plan Failure Mode #3).
 */

import type { ResidualEchoCancelResult } from './echo-cancellation';

/** Default mic RMS threshold for the residual signal (after echo cancellation).
 *  Pure echo residual stays below 0.05; user speech residual is typically 0.06-0.11.
 *  Raised from pibot's 0.018 (which was calibrated on raw mic, not post-cancellation). */
export const DEFAULT_MIC_THRESHOLD = 0.05;

/** Default residual ratio threshold (fraction of original mic energy NOT explained by echo).
 *  Lowered from pibot's 0.62 — that value blocks mixed echo+speech because the echo
 *  component drives the ratio down even when speech is present in the residual.
 *  0.10 keeps a minimal floor to filter imperfect-cancellation artifacts. */
export const DEFAULT_RESIDUAL_THRESHOLD = 0.10;
/** Default consecutive frames before barge-in fires. */
export const DEFAULT_TRIGGER_FRAMES = 5;

/** Energy floor below which the mic is considered silent (avoids division-by-zero). */
const MIC_ENERGY_FLOOR = 1e-7;

export interface ServerBargeInOptions {
  micThreshold?: number;
  residualThreshold?: number;
  triggerFrames?: number;
}

export interface ServerBargeInMetrics {
  micRms: number;
  residualRatio: number;
  echoEnergy: number;
  micEnergy: number;
  consecutiveFrames: number;
}

export interface ServerBargeInResult {
  triggered: boolean;
  metrics: ServerBargeInMetrics;
}

export class ServerBargeInDetector {
  private consecutiveFrames = 0;
  private readonly micThreshold: number;
  private readonly residualThreshold: number;
  private readonly triggerFrames: number;

  constructor(options?: ServerBargeInOptions) {
    this.micThreshold = options?.micThreshold ?? DEFAULT_MIC_THRESHOLD;
    this.residualThreshold = options?.residualThreshold ?? DEFAULT_RESIDUAL_THRESHOLD;
    this.triggerFrames = options?.triggerFrames ?? DEFAULT_TRIGGER_FRAMES;
  }

  /**
   * Observe one mic chunk + its echo-cancellation result. Returns
   * `triggered=true` on the frame that crosses the hysteresis threshold.
   * Caller should call `handleInterruptSpeechStart(ws, 'server_barge_in', ts)`
   * when triggered (DO NOT call `handleInterruptSpeechEnd` here — that
   * would reject the interrupt before the transcript arrives; the
   * `confirm_before_cancel` pipeline handles confirmation).
   *
   * @param result        Output of `residualEchoCancel` for this chunk.
   * @param sampleRateHz  Sample rate of the mic audio (kept for API symmetry).
   * @param totalAudioMs  Absolute mic offset in ms (kept for telemetry/logging).
   */
  observe(
    result: ResidualEchoCancelResult,
    sampleRateHz: number,
    totalAudioMs: number,
  ): ServerBargeInResult {
    // 1. Compute RMS of residual (after echo subtraction).
    //    result.residual is PCM16 LE bytes; convert to amplitude in [-1, 1].
    const samples = result.residual.length / 2;
    const sumSquares = samples > 0 ? sumOfSquaresPCM16(result.residual) : 0;
    const micRms = Math.sqrt(sumSquares / Math.max(1, samples));

    // 2. Compute residual ratio: fraction of mic energy NOT explained by echo.
    //    If micEnergy is near zero, ratio is 0 (nothing to detect).
    const residualRatio =
      result.micEnergy < MIC_ENERGY_FLOOR
        ? 0
        : Math.max(0, result.micEnergy - result.echoEnergy) / result.micEnergy;

    // 3. Hysteresis: increment on trigger, decrement on non-trigger.
    const triggered =
      micRms >= this.micThreshold && residualRatio >= this.residualThreshold;
    this.consecutiveFrames = triggered
      ? this.consecutiveFrames + 1
      : Math.max(0, this.consecutiveFrames - 1);

    const fired = this.consecutiveFrames >= this.triggerFrames;
    if (fired) {
      this.consecutiveFrames = 0; // reset so next fire requires N more frames
    }

    return {
      triggered: fired,
      metrics: {
        micRms,
        residualRatio,
        echoEnergy: result.echoEnergy,
        micEnergy: result.micEnergy,
        consecutiveFrames: this.consecutiveFrames,
      },
    };
  }

  /** Reset hysteresis state. Call after a confirmed interrupt or when outputAudioActive flips to false. */
  reset(): void {
    this.consecutiveFrames = 0;
  }

  /** Whether the detector is currently counting toward a trigger. */
  isArmed(): boolean {
    return this.consecutiveFrames > 0;
  }
}

// ---------------------------------------------------------------------------
// Module-scoped helpers (no per-call allocation in hot path).
// ---------------------------------------------------------------------------

/**
 * Compute the sum of squares of a PCM16 little-endian byte buffer.
 * Each sample is read as a signed int16, normalized to [-1, 1] via /0x8000,
 * and squared. Returns the raw sum (caller divides by sample count for RMS).
 */
function sumOfSquaresPCM16(pcm16: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < pcm16.length; i += 2) {
    let sample = (pcm16[i + 1] << 8) | pcm16[i];
    if (sample >= 0x8000) sample -= 0x10000;
    const normalized = sample / 0x8000;
    sum += normalized * normalized;
  }
  return sum;
}