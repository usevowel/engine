/**
 * Deepgram STT Provider Tests
 *
 * Tests for Deepgram STT provider covering initialization, batch transcription,
 * streaming session lifecycle, capabilities, and error handling.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DeepgramSTT } from '../DeepgramSTT';

describe('DeepgramSTT', () => {
  let provider: DeepgramSTT;
  const testApiKey = 'test-api-key-12345';
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  class FakeWebSocket extends EventTarget {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = FakeWebSocket.OPEN;
    sentChunks: Uint8Array[] = [];

    constructor(_url: string, _protocols?: string | string[]) {
      super();
      queueMicrotask(() => {
        this.dispatchEvent(new Event('open'));
      });
    }

    send(chunk: Uint8Array) {
      this.sentChunks.push(chunk);
    }

    close(code = 1000, reason = 'closed') {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', { code, reason }));
    }
  }

  beforeEach(() => {
    provider = new DeepgramSTT(testApiKey);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('wss://')) {
        throw new Error('upgrade unsupported in tests');
      }

      return {
        ok: true,
        json: async () => ({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: 'hello world',
                    confidence: 0.98,
                    language: 'en-US',
                  },
                ],
              },
            ],
          },
          metadata: {
            duration: 1.25,
          },
        }),
        text: async () => 'ok',
      } as Response;
    }) as typeof fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  });

  describe('constructor', () => {
    test('creates instance with API key', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('deepgram');
      expect(provider.type).toBe('streaming');
    });

    test('uses default model when not specified', () => {
      const instance = new DeepgramSTT(testApiKey);
      expect(instance).toBeDefined();
      expect(instance.name).toBe('deepgram');
    });

    test('accepts custom model', () => {
      const instance = new DeepgramSTT(testApiKey, { model: 'nova-2' });
      expect(instance).toBeDefined();
    });

    test('accepts custom language', () => {
      const instance = new DeepgramSTT(testApiKey, { language: 'es-ES' });
      expect(instance).toBeDefined();
    });

    test('accepts custom sample rate', () => {
      const instance = new DeepgramSTT(testApiKey, { sampleRate: 16000 });
      expect(instance).toBeDefined();
    });

    test('accepts all config options together', () => {
      const instance = new DeepgramSTT(testApiKey, {
        model: 'nova-3',
        language: 'fr-FR',
        sampleRate: 24000,
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
      const noKeyProvider = new DeepgramSTT('');
      await expect(noKeyProvider.initialize()).rejects.toThrow('Deepgram API key not configured');
    });

    test('isReady returns false before initialization', () => {
      const uninitialized = new DeepgramSTT(testApiKey);
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
      expect(capabilities.supportsLanguageDetection).toBe(true);
      expect(capabilities.supportsMultipleVoices).toBe(false);
      expect(capabilities.requiresNetwork).toBe(true);
      expect(capabilities.supportsGPU).toBe(false);
    });
  });

  describe('transcribe', () => {
    test('throws error when not initialized', async () => {
      const audioBuffer = new Uint8Array([1, 2, 3, 4]);
      await expect(provider.transcribe(audioBuffer)).rejects.toThrow('deepgram provider not initialized');
    });

    test('calls Deepgram API with correct parameters when initialized', async () => {
      await provider.initialize();

      const audioBuffer = new Uint8Array([1, 2, 3, 4]);
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('hello world');
      expect(result.language).toBe('en-US');
    });

    test('accepts transcribe options', async () => {
      await provider.initialize();
      const audioBuffer = new Uint8Array([1, 2, 3, 4]);

      const result = await provider.transcribe(audioBuffer, {
        language: 'en-US',
        sampleRate: 16000,
        channels: 1,
      });

      expect(result.text).toBe('hello world');
    });
  });

  describe('startStream', () => {
    test('creates streaming session when initialized', async () => {
      await provider.initialize();

      const callbacks = {
        onPartial: () => {},
        onFinal: () => {},
        onError: () => {},
      };

      const session = await provider.startStream(callbacks);
      await session.waitForConnection?.();

      expect(session).toBeDefined();
      expect(typeof session.sendAudio).toBe('function');
      expect(typeof session.end).toBe('function');
      expect(typeof session.stop).toBe('function');
      expect(typeof session.isActive).toBe('function');
    });

    test('throws error when not initialized', async () => {
      const callbacks = {
        onPartial: () => {},
        onFinal: () => {},
      };

      await expect(provider.startStream(callbacks)).rejects.toThrow('deepgram provider not initialized');
    });

    test('session has required methods', async () => {
      await provider.initialize();

      const callbacks = {
        onFinal: () => {},
      };

      const session = await provider.startStream(callbacks);
      await session.waitForConnection?.();

      expect(typeof session.sendAudio).toBe('function');
      expect(typeof session.end).toBe('function');
      expect(typeof session.stop).toBe('function');
      expect(typeof session.isActive).toBe('function');
    });

    test('session can be stopped', async () => {
      await provider.initialize();

      const callbacks = {
        onFinal: () => {},
      };

      const session = await provider.startStream(callbacks);
      await session.waitForConnection?.();

      await session.stop();
      expect(session.isActive()).toBe(false);
    });

    test('session accepts optional callbacks', async () => {
      await provider.initialize();

      const callbacks = {
        onFinal: () => {},
        onPartial: () => {},
        onError: () => {},
        onVADEvent: () => {},
      };

      const session = await provider.startStream(callbacks);
      await session.waitForConnection?.();
      expect(session).toBeDefined();
      await session.stop();
    });

    test('sendAudio throws when session is stopped', async () => {
      await provider.initialize();

      const callbacks = {
        onFinal: () => {},
      };

      const session = await provider.startStream(callbacks);
      await session.waitForConnection?.();
      await session.stop();

      const audioChunk = new Uint8Array([1, 2, 3, 4]);
      await expect(session.sendAudio(audioChunk)).rejects.toThrow('Deepgram STT session not active');
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
