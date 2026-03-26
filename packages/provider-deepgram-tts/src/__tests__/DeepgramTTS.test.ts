/**
 * Deepgram TTS Provider Tests
 *
 * Tests for Deepgram TTS provider covering initialization, batch synthesis,
 * streaming synthesis, voice listing, capabilities, and error handling.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getEventSystem } from '../../../../src/events';
import { DeepgramTTS } from '../DeepgramTTS';

function createReadableStreamFromChunks(chunks: Uint8Array[]): Response['body'] {
  return {
    getReader() {
      let index = 0;
      return {
        async read() {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }

          const value = chunks[index];
          index += 1;
          return { done: false, value };
        },
      };
    },
  } as Response['body'];
}

function createWavBytes(payload: number[]): Uint8Array {
  const bytes = new Uint8Array(44 + payload.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set(payload, 44);
  return bytes;
}

describe('DeepgramTTS', () => {
  let provider: DeepgramTTS;
  const testApiKey = 'test-api-key-12345';
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const warnCalls: Array<Parameters<ReturnType<typeof getEventSystem>['warn']>> = [];
  const eventSystem = getEventSystem();
  const originalWarn = eventSystem.warn.bind(eventSystem);

  beforeEach(() => {
    provider = new DeepgramTTS(testApiKey);
    fetchCalls.length = 0;
    warnCalls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      const chunks = [
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
        new Uint8Array([13, 14, 15, 16]),
      ];

      return {
        ok: true,
        text: async () => 'ok',
        arrayBuffer: async () => new Uint8Array([21, 22, 23, 24]).buffer,
        body: createReadableStreamFromChunks(chunks),
      } as Response;
    }) as typeof fetch;
    eventSystem.warn = ((...args) => {
      warnCalls.push(args);
      return originalWarn(...args);
    }) as typeof eventSystem.warn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    eventSystem.warn = originalWarn;
  });

  describe('constructor', () => {
    test('creates instance with API key', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('deepgram');
      expect(provider.type).toBe('streaming');
    });

    test('uses default model when not specified', () => {
      const instance = new DeepgramTTS(testApiKey);
      expect(instance).toBeDefined();
      expect(instance.name).toBe('deepgram');
    });

    test('accepts custom model', () => {
      const instance = new DeepgramTTS(testApiKey, { model: 'aura-2-asteria-en' });
      expect(instance).toBeDefined();
    });

    test('accepts custom sample rate', () => {
      const instance = new DeepgramTTS(testApiKey, { sampleRate: 16000 });
      expect(instance).toBeDefined();
    });

    test('accepts custom encoding', () => {
      const instance = new DeepgramTTS(testApiKey, { encoding: 'opus' });
      expect(instance).toBeDefined();
    });

    test('accepts all config options together', () => {
      const instance = new DeepgramTTS(testApiKey, {
        model: 'aura-2-angus-en',
        sampleRate: 48000,
        encoding: 'linear16',
      });
      expect(instance).toBeDefined();
      expect(instance.name).toBe('deepgram');
    });
  });

  describe('initialization', () => {
    test('initializes successfully with valid API key', async () => {
      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });

    test('throws error without API key', async () => {
      const noKeyProvider = new DeepgramTTS('');
      await expect(noKeyProvider.initialize()).rejects.toThrow('Deepgram API key not configured');
    });

    test('isReady returns false before initialization', () => {
      const uninitialized = new DeepgramTTS(testApiKey);
      expect(uninitialized.isReady()).toBe(false);
    });

    test('dispose sets isReady to false', async () => {
      await provider.initialize();
      expect(provider.isReady()).toBe(true);

      await provider.dispose();
      expect(provider.isReady()).toBe(false);
    });

    test('can re-initialize after dispose', async () => {
      await provider.initialize();
      await provider.dispose();
      expect(provider.isReady()).toBe(false);

      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });
  });

  describe('capabilities', () => {
    test('reports correct capabilities', () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsVAD).toBe(false);
      expect(capabilities.supportsLanguageDetection).toBe(false);
      expect(capabilities.supportsMultipleVoices).toBe(true);
      expect(capabilities.requiresNetwork).toBe(true);
      expect(capabilities.supportsGPU).toBe(false);
    });
  });

  describe('getSampleRate', () => {
    test('returns default sample rate', () => {
      expect(provider.getSampleRate()).toBe(24000);
    });

    test('returns custom sample rate', () => {
      const customProvider = new DeepgramTTS(testApiKey, { sampleRate: 16000 });
      expect(customProvider.getSampleRate()).toBe(16000);
    });

    test('returns 48000 when configured', () => {
      const customProvider = new DeepgramTTS(testApiKey, { sampleRate: 48000 });
      expect(customProvider.getSampleRate()).toBe(48000);
    });
  });

  describe('getAvailableVoices', () => {
    test('returns list of available voices', async () => {
      const voices = await provider.getAvailableVoices();

      expect(Array.isArray(voices)).toBe(true);
      expect(voices.length).toBeGreaterThan(0);
      expect(voices).toContain('Aura-2-Thalia-en');
      expect(voices).toContain('Aura-2-Asteria-en');
      expect(voices).toContain('Aura-2-Angus-en');
      expect(voices).toContain('Aura-2-Orion-en');
    });

    test('returns exactly 4 voices', async () => {
      const voices = await provider.getAvailableVoices();
      expect(voices.length).toBe(4);
    });
  });

  describe('synthesize', () => {
    test('throws error when not initialized', async () => {
      await expect(provider.synthesize('Hello world')).rejects.toThrow('deepgram provider not initialized');
    });

    test('calls Deepgram API when initialized', async () => {
      await provider.initialize();

      const result = await provider.synthesize('Hello world');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);

      expect(fetchCalls).toHaveLength(1);
      const request = fetchCalls[0];
      const url = new URL(String(request.input));
      expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/speak');
      expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
      expect(url.searchParams.get('encoding')).toBe('linear16');
      expect(url.searchParams.get('sample_rate')).toBe('24000');
      expect(url.searchParams.get('container')).toBe('none');
      expect(request.init?.body).toBe(JSON.stringify({ text: 'Hello world' }));
    });

    test('accepts synthesize options', async () => {
      await provider.initialize();

      const result = await provider.synthesize('Hello world', {
        voice: 'Aura-2-Thalia-en',
        speed: 1.0,
        sampleRate: 24000,
      });

      expect(result.length).toBeGreaterThan(0);

      const request = fetchCalls[0];
      const url = new URL(String(request.input));
      expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
      expect(url.searchParams.get('sample_rate')).toBe('24000');
      expect(url.searchParams.get('container')).toBe('none');
      expect(request.init?.body).toBe(JSON.stringify({ text: 'Hello world' }));
    });

    test('falls back to default model for invalid voice values and warns', async () => {
      await provider.initialize();

      const result = await provider.synthesize('Hello world', {
        voice: 'Leo',
      });

      expect(result.length).toBeGreaterThan(0);

      const request = fetchCalls[0];
      const url = new URL(String(request.input));
      expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
      expect(url.searchParams.get('container')).toBe('none');
      expect(warnCalls.length).toBeGreaterThan(0);
      expect(warnCalls[0][1]).toContain('unsupported model/voice');
    });

    test('handles empty text', async () => {
      await provider.initialize();

      const result = await provider.synthesize('');
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('synthesizeStream', () => {
    test('returns async iterator that throws error when not initialized', async () => {
      const stream = await provider.synthesizeStream('Hello world');
      expect(stream).toBeDefined();

      try {
        await stream.next();
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('deepgram provider not initialized');
      }
    });

    test('returns async iterator when initialized', async () => {
      await provider.initialize();

      const stream = await provider.synthesizeStream('Hello world');
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      const firstChunk = await stream.next();
      expect(firstChunk.done).toBe(false);
      expect(firstChunk.value).toBeInstanceOf(Uint8Array);

      expect(fetchCalls).toHaveLength(1);
      const request = fetchCalls[0];
      const url = new URL(String(request.input));
      expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/speak');
      expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
      expect(url.searchParams.get('encoding')).toBe('linear16');
      expect(url.searchParams.get('sample_rate')).toBe('24000');
      expect(url.searchParams.get('container')).toBe('none');
      expect(request.init?.body).toBe(JSON.stringify({ text: 'Hello world' }));
      expect(firstChunk.value).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    });

    test('strips a split WAV header before yielding PCM audio', async () => {
      await provider.initialize();

      const wavBytes = createWavBytes([11, 12, 13, 14, 15, 16]);
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ input, init });
        return {
          ok: true,
          text: async () => 'ok',
          arrayBuffer: async () => wavBytes.buffer,
          body: createReadableStreamFromChunks([
            wavBytes.slice(0, 10),
            wavBytes.slice(10, 30),
            wavBytes.slice(30, 47),
            wavBytes.slice(47),
          ]),
        } as Response;
      }) as typeof fetch;

      const stream = await provider.synthesizeStream('Hello world');
      const chunks: Uint8Array[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([new Uint8Array([11, 12]), new Uint8Array([13, 14, 15, 16])]);
    });

    test('iterator has Symbol.asyncIterator', async () => {
      const stream = await provider.synthesizeStream('Hello world');
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
      const iterated = stream[Symbol.asyncIterator]();
      expect(iterated).toBe(stream);
    });
  });

  describe('dispose', () => {
    test('disposes provider and sets isReady to false', async () => {
      await provider.initialize();
      expect(provider.isReady()).toBe(true);

      await provider.dispose();
      expect(provider.isReady()).toBe(false);
    });
  });
});
