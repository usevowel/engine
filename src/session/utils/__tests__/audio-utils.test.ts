import { describe, expect, test } from 'bun:test';
import { synthesizeTextWithProvider } from '../audio-utils';
import type { SessionProviders } from '../../SessionManager';

function createStubProviders(overrides?: {
  synthesizeStream?: (text: string, options?: unknown) => AsyncIterableIterator<Uint8Array>;
  synthesize?: (text: string, options?: unknown) => Promise<Uint8Array>;
}): SessionProviders {
  const defaultCapabilities = {
    supportsStreaming: true,
    supportsVAD: false,
    supportsLanguageDetection: false,
    supportsMultipleVoices: true,
    requiresNetwork: true,
    supportsGPU: false,
  };

  const tts = {
    name: 'deepgram',
    type: 'streaming' as const,
    initialize: async () => {},
    synthesize: overrides?.synthesize ?? (async () => new Uint8Array([1, 2, 3])),
    synthesizeStream:
      overrides?.synthesizeStream ??
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      }),
    getSampleRate: () => 24000,
    getAvailableVoices: async () => ['Aura-2-Thalia-en'],
    isReady: () => true,
    dispose: async () => {},
    getCapabilities: () => defaultCapabilities,
  };

  const stt = {
    name: 'stub-stt',
    type: 'batch' as const,
    initialize: async () => {},
    transcribe: async () => ({ text: '' }),
    startStream: async () => ({
      sendAudio: async () => {},
      end: async () => {},
      stop: async () => {},
      isActive: () => true,
    }),
    isReady: () => true,
    dispose: async () => {},
    getCapabilities: () => defaultCapabilities,
  };

  return {
    tts,
    stt,
    vad: null,
  } as SessionProviders;
}

describe('synthesizeTextWithProvider regression coverage', () => {
  test('skips provider call when markdown cleanup leaves blank text', async () => {
    const providers = createStubProviders({
      synthesizeStream: async function* () {
        throw new Error('synthesizeStream should not be called for markdown-only text');
      },
    });

    const result = await synthesizeTextWithProvider(providers, '**__~~###---***___~~**', 'Aura-2-Thalia-en');

    expect(result).toEqual([]);
  });

  test('skips provider call when cleaned text is whitespace-only', async () => {
    const providers = createStubProviders({
      synthesizeStream: async function* () {
        throw new Error('synthesizeStream should not be called for whitespace-only text');
      },
    });

    const result = await synthesizeTextWithProvider(providers, '   \n\t   ', 'Aura-2-Thalia-en');

    expect(result).toEqual([]);
  });

  test('still synthesizes when markdown cleanup leaves speakable text', async () => {
    const calls: string[] = [];
    const providers = createStubProviders({
      synthesizeStream: async function* (text: string) {
        calls.push(text);
        yield new Uint8Array([9, 8, 7]);
      },
    });

    const result = await synthesizeTextWithProvider(providers, '**Hello** _world_', 'Aura-2-Thalia-en');

    expect(calls).toEqual(['Hello world']);
    expect(result).toEqual([new Uint8Array([9, 8, 7])]);
  });
});
