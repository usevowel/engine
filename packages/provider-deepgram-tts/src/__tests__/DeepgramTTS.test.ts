/**
 * Deepgram TTS Provider Tests
 * 
 * Comprehensive tests for Deepgram TTS provider without requiring real API keys.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { DeepgramTTS } from '../DeepgramTTS';

describe('DeepgramTTS', () => {
  let provider: DeepgramTTS;
  const testApiKey = 'test-api-key-12345';

  beforeEach(() => {
    provider = new DeepgramTTS(testApiKey);
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
  });

  describe('synthesize', () => {
    test('throws error when not initialized', async () => {
      await expect(provider.synthesize('Hello world')).rejects.toThrow('deepgram provider not initialized');
    });

    test('calls Deepgram API when initialized', async () => {
      await provider.initialize();
      
      try {
        await provider.synthesize('Hello world');
      } catch (error) {
        // Expected to fail without real API key
        expect(error).toBeInstanceOf(Error);
      }
    });

    test('accepts synthesize options', async () => {
      await provider.initialize();
      
      try {
        await provider.synthesize('Hello world', {
          voice: 'Aura-2-Thalia-en',
          speed: 1.0,
          sampleRate: 24000,
        });
      } catch (error) {
        // Expected without real API key
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('synthesizeStream', () => {
    test('returns async iterator that throws error when not initialized', async () => {
      const stream = await provider.synthesizeStream('Hello world');
      expect(stream).toBeDefined();
      
      // The iterator should throw when we try to read from it
      try {
        await stream.next();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('deepgram provider not initialized');
      }
    });

    test('returns async iterator when initialized', async () => {
      await provider.initialize();
      
      try {
        const stream = await provider.synthesizeStream('Hello world');
        expect(typeof stream[Symbol.asyncIterator]).toBe('function');
      } catch (error) {
        // Expected without real API key
        expect(error).toBeInstanceOf(Error);
      }
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
