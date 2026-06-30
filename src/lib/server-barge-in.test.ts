import { describe, test, expect } from 'bun:test';
import {
  ServerBargeInDetector,
  DEFAULT_MIC_THRESHOLD,
  DEFAULT_RESIDUAL_THRESHOLD,
  DEFAULT_TRIGGER_FRAMES,
} from './server-barge-in';
import type { ResidualEchoCancelResult } from './echo-cancellation';

function makeResult(opts: {
  residual?: Uint8Array;
  echoEnergy?: number;
  micEnergy?: number;
}): ResidualEchoCancelResult {
  // Default: empty residual (silence)
  const residual = opts.residual ?? new Uint8Array(0);
  return {
    residual,
    echoEnergy: opts.echoEnergy ?? 0,
    micEnergy: opts.micEnergy ?? 0,
  };
}

/** Generate a residual Uint8Array (PCM16 LE) with given RMS amplitude. */
function pcm16WithRms(rms: number, numSamples: number = 1024): Uint8Array {
  const out = new Uint8Array(numSamples * 2);
  const amplitude = rms * 32768;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude);
    out[i * 2] = sample & 0xff;
    out[i * 2 + 1] = (sample >> 8) & 0xff;
  }
  return out;
}

describe('ServerBargeInDetector', () => {
  test('passes through when no energy', () => {
    const det = new ServerBargeInDetector();
    const r = makeResult({ micEnergy: 0, echoEnergy: 0, residual: new Uint8Array(0) });
    expect(det.observe(r, 24000, 0).triggered).toBe(false);
    expect(det.observe(r, 24000, 100).triggered).toBe(false);
  });

  test('pure echo (high echoEnergy, low residual) does not trigger', () => {
    const det = new ServerBargeInDetector();
    // Large micEnergy, but echoEnergy is 90% of it — residual is small (silence)
    for (let i = 0; i < 10; i++) {
      const r = makeResult({
        residual: pcm16WithRms(0.005), // RMS below threshold
        micEnergy: 100,
        echoEnergy: 90,
      });
      expect(det.observe(r, 24000, i * 100).triggered).toBe(false);
    }
  });

  test('real speech (low echoEnergy, high residual) triggers after 5 frames', () => {
    const det = new ServerBargeInDetector();
    for (let i = 0; i < DEFAULT_TRIGGER_FRAMES - 1; i++) {
      const r = makeResult({
        residual: pcm16WithRms(0.05), // RMS well above threshold
        micEnergy: 100,
        echoEnergy: 5, // residual ratio = 95/100 = 0.95
      });
      expect(det.observe(r, 24000, i * 100).triggered).toBe(false);
    }
    const r = makeResult({
      residual: pcm16WithRms(0.05),
      micEnergy: 100,
      echoEnergy: 5,
    });
    expect(det.observe(r, 24000, (DEFAULT_TRIGGER_FRAMES - 1) * 100).triggered).toBe(true);
  });

  test('hysteresis: 4 triggers then 1 non-trigger does not fire', () => {
    const det = new ServerBargeInDetector();
    const speech = () =>
      makeResult({
        residual: pcm16WithRms(0.05),
        micEnergy: 100,
        echoEnergy: 5,
      });
    const silence = () =>
      makeResult({
        residual: pcm16WithRms(0.001),
        micEnergy: 100,
        echoEnergy: 5, // ratio still high, but RMS below threshold
      });
    for (let i = 0; i < 4; i++) {
      expect(det.observe(speech(), 24000, i * 100).triggered).toBe(false);
    }
    // 1 non-trigger decrements counter to 3
    expect(det.observe(silence(), 24000, 400).triggered).toBe(false);
    // 2 more triggers → counter goes 4, 5 → fires on the 2nd
    expect(det.observe(speech(), 24000, 500).triggered).toBe(false);
    expect(det.observe(speech(), 24000, 600).triggered).toBe(true);
  });

  test('reset clears hysteresis state', () => {
    const det = new ServerBargeInDetector();
    const speech = () =>
      makeResult({
        residual: pcm16WithRms(0.05),
        micEnergy: 100,
        echoEnergy: 5,
      });
    for (let i = 0; i < 4; i++) {
      det.observe(speech(), 24000, i * 100);
    }
    det.reset();
    // After reset, need 5 more triggers to fire
    for (let i = 0; i < 4; i++) {
      expect(det.observe(speech(), 24000, (5 + i) * 100).triggered).toBe(false);
    }
    expect(det.observe(speech(), 24000, 9 * 100).triggered).toBe(true);
  });

  test('micEnergy floor prevents division-by-zero', () => {
    const det = new ServerBargeInDetector();
    const r = makeResult({
      residual: pcm16WithRms(0.05),
      micEnergy: 1e-10, // below 1e-7 floor
      echoEnergy: 0,
    });
    const result = det.observe(r, 24000, 0);
    expect(result.metrics.residualRatio).toBe(0);
    expect(result.triggered).toBe(false);
  });

  test('isArmed reflects counter state', () => {
    const det = new ServerBargeInDetector();
    expect(det.isArmed()).toBe(false);
    const speech = makeResult({
      residual: pcm16WithRms(0.05),
      micEnergy: 100,
      echoEnergy: 5,
    });
    det.observe(speech, 24000, 0);
    expect(det.isArmed()).toBe(true);
    det.reset();
    expect(det.isArmed()).toBe(false);
  });

  test('emits metrics on every observe call', () => {
    const det = new ServerBargeInDetector();
    const r = makeResult({
      residual: pcm16WithRms(0.05),
      micEnergy: 100,
      echoEnergy: 5,
    });
    const result = det.observe(r, 24000, 0);
    expect(result.metrics.micRms).toBeCloseTo(0.05, 2);
    expect(result.metrics.residualRatio).toBeCloseTo(0.95, 2);
    expect(result.metrics.micEnergy).toBe(100);
    expect(result.metrics.echoEnergy).toBe(5);
  });

  test('custom thresholds are respected', () => {
    const det = new ServerBargeInDetector({
      micThreshold: 0.1, // very high
      triggerFrames: 3,
    });
    const r = makeResult({
      residual: pcm16WithRms(0.05), // below custom threshold
      micEnergy: 100,
      echoEnergy: 5,
    });
    for (let i = 0; i < 5; i++) {
      expect(det.observe(r, 24000, i * 100).triggered).toBe(false);
    }
  });

  test('defaults are exported and match pibot calibration', () => {
    expect(DEFAULT_MIC_THRESHOLD).toBe(0.018);
    expect(DEFAULT_RESIDUAL_THRESHOLD).toBe(0.62);
    expect(DEFAULT_TRIGGER_FRAMES).toBe(5);
  });

  test('firing resets the counter so next fire requires N more frames', () => {
    const det = new ServerBargeInDetector();
    const speech = () =>
      makeResult({
        residual: pcm16WithRms(0.05),
        micEnergy: 100,
        echoEnergy: 5,
      });
    // First fire
    for (let i = 0; i < 4; i++) {
      expect(det.observe(speech(), 24000, i * 100).triggered).toBe(false);
    }
    expect(det.observe(speech(), 24000, 400).triggered).toBe(true);
    // Immediately after fire, counter is 0 — need 5 more frames
    for (let i = 0; i < 4; i++) {
      expect(det.observe(speech(), 24000, (5 + i) * 100).triggered).toBe(false);
    }
    expect(det.observe(speech(), 24000, 900).triggered).toBe(true);
  });

  test('silence (zero residual) does not arm the detector', () => {
    const det = new ServerBargeInDetector();
    const r = makeResult({
      residual: new Uint8Array(2048), // all zeros
      micEnergy: 100,
      echoEnergy: 5,
    });
    for (let i = 0; i < 10; i++) {
      const result = det.observe(r, 24000, i * 100);
      expect(result.triggered).toBe(false);
      expect(result.metrics.micRms).toBe(0);
    }
    expect(det.isArmed()).toBe(false);
  });

  test('residualRatio is clamped to 0 when echoEnergy exceeds micEnergy', () => {
    const det = new ServerBargeInDetector();
    const r = makeResult({
      residual: pcm16WithRms(0.05),
      micEnergy: 10,
      echoEnergy: 50, // echo > mic (over-subtraction edge case)
    });
    const result = det.observe(r, 24000, 0);
    expect(result.metrics.residualRatio).toBe(0);
    expect(result.triggered).toBe(false);
  });
});