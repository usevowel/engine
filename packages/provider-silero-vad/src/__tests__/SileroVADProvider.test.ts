import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { SileroVADProvider } from '../SileroVADProvider';
import { SileroVAD } from '../../../../src/services/vad';

describe('SileroVADProvider', () => {
  let provider: SileroVADProvider;
  let originalInitialize: typeof SileroVAD.prototype.initialize;
  let originalDetectSpeech: typeof SileroVAD.prototype.detectSpeech;
  let originalGetState: typeof SileroVAD.prototype.getState;
  let originalResetState: typeof SileroVAD.prototype.resetState;

  beforeEach(() => {
    originalInitialize = SileroVAD.prototype.initialize;
    originalDetectSpeech = SileroVAD.prototype.detectSpeech;
    originalGetState = SileroVAD.prototype.getState;
    originalResetState = SileroVAD.prototype.resetState;

    SileroVAD.prototype.initialize = async function mockedInitialize() {
      return;
    };

    SileroVAD.prototype.detectSpeech = async function mockedDetectSpeech() {
      return 'speech_start';
    };

    SileroVAD.prototype.getState = function mockedGetState() {
      return {
        isSpeaking: true,
        speechStartMs: 100,
        speechEndMs: null,
        lastSpeechProbability: 0.91,
      };
    };

    SileroVAD.prototype.resetState = async function mockedResetState() {
      return;
    };

    provider = new SileroVADProvider();
  });

  afterEach(() => {
    SileroVAD.prototype.initialize = originalInitialize;
    SileroVAD.prototype.detectSpeech = originalDetectSpeech;
    SileroVAD.prototype.getState = originalGetState;
    SileroVAD.prototype.resetState = originalResetState;
  });

  test('initializes successfully with default config', async () => {
    await provider.initialize();

    expect(provider.isReady()).toBe(true);
    expect(provider.name).toBe('silero-vad');
    expect(provider.mode).toBe('local');
  });

  test('reports local VAD capabilities', () => {
    const capabilities = provider.getCapabilities();

    expect(capabilities.supportsStreaming).toBe(false);
    expect(capabilities.supportsVAD).toBe(true);
    expect(capabilities.requiresNetwork).toBe(false);
    expect(capabilities.supportsGPU).toBe(true);
  });

  test('delegates speech detection to Silero service', async () => {
    await provider.initialize();

    const event = await provider.detectSpeech(new Float32Array(512), 1234);
    expect(event).toBe('speech_start');
  });

  test('returns current VAD state', async () => {
    await provider.initialize();

    const state = provider.getState();
    expect(state.isSpeaking).toBe(true);
    expect(state.lastSpeechProbability).toBe(0.91);
  });

  test('resetState delegates to underlying Silero service', async () => {
    await provider.initialize();
    await expect(provider.resetState()).resolves.toBeUndefined();
  });

  test('throws before initialization', async () => {
    await expect(provider.detectSpeech(new Float32Array(512), 1234)).rejects.toThrow('silero-vad provider not initialized');
  });

  test('dispose resets readiness', async () => {
    await provider.initialize();
    await provider.dispose();

    expect(provider.isReady()).toBe(false);
  });
});
