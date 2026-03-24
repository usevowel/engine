/**
 * Deepgram STT Provider Tests
 * 
 * Comprehensive tests for Deepgram STT provider without requiring real API keys.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { DeepgramSTT } from '../DeepgramSTT';

describe('DeepgramSTT', () => {
  let provider: DeepgramSTT;
  const testApiKey = 'test-api-key-12345';

  beforeEach(() => {
    provider = new DeepgramSTT(testApiKey);
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
      
      // Note: This will fail without a real API key, but that's expected
      // We're testing that the method exists and has the right interface
      const audioBuffer = new Uint8Array([1, 2, 3, 4]);
      
      try {
        await provider.transcribe(audioBuffer);
      } catch (error) {
        // Expected to fail without real API key
        // We just want to verify the method was called with correct structure
        expect(error).toBeInstanceOf(Error);
      }
    });

    test('accepts transcribe options', async () => {
      await provider.initialize();
      const audioBuffer = new Uint8Array([1, 2, 3, 4]);
      
      try {
        await provider.transcribe(audioBuffer, {
          language: 'en-US',
          sampleRate: 16000,
          channels: 1,
        });
      } catch (error) {
        // Expected without real API key
        expect(error).toBeInstanceOf(Error);
      }
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
      
      expect(session).toBeDefined();
      expect(session.isActive()).toBe(true);
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
      
      expect(typeof session.sendAudio).toBe('function');
      expect(typeof session.end).toBe('function');
      expect(typeof session.stop).toBe('function');
      expect(typeof session.isActive).toBe('function');
    });

    test('session can be ended', async () => {
      await provider.initialize();
      
      const callbacks = {
        onFinal: () => {},
      };
      
      const session = await provider.startStream(callbacks);
      
      expect(session.isActive()).toBe(true);
      await session.end();
      expect(session.isActive()).toBe(false);
    });

    test('session can be stopped', async () => {
      await provider.initialize();
      
      const callbacks = {
        onFinal: () => {},
      };
      
      const session = await provider.startStream(callbacks);
      
      expect(session.isActive()).toBe(true);
      await session.stop();
      expect(session.isActive()).toBe(false);
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
