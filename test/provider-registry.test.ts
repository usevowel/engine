/**
 * Provider Registry Tests
 * 
 * Tests for the centralized provider registry system.
 */

import { describe, test, expect } from 'bun:test';
import {
  getProvider,
  getProviderNames,
  isValidProvider,
  registerWorkersAIBinding,
  type SupportedProvider,
} from '../src/services/providers/llm';

const mockWorkersAIBinding = {
  run: async () => ({ response: 'ok' }),
};

describe('Provider Registry', () => {
  describe('getProvider', () => {
    test('creates Groq provider instance', () => {
      const provider = getProvider('groq', { apiKey: 'test-key' });
      
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('function');
    });
    
    test('creates OpenRouter provider instance', () => {
      const provider = getProvider('openrouter', {
        apiKey: 'test-key',
        openrouterSiteUrl: 'https://example.com',
        openrouterAppName: 'Test App',
      });
      
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('function');
    });
    
    test('creates Cerebras provider instance', () => {
      const provider = getProvider('cerebras', { apiKey: 'test-key' });
      
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('function');
    });

    test('creates Workers AI provider instance when binding is registered', () => {
      registerWorkersAIBinding(mockWorkersAIBinding);
      const provider = getProvider('workers-ai', { apiKey: '' });

      expect(provider).toBeDefined();
      expect(typeof provider).toBe('function');
    });

    test('throws for Workers AI provider without binding', () => {
      registerWorkersAIBinding(null);

      expect(() => {
        getProvider('workers-ai', { apiKey: '' });
      }).toThrow('Cloudflare Workers AI binding not configured');
    });
    
    test('throws error for unknown provider', () => {
      expect(() => {
        getProvider('invalid' as any, { apiKey: 'test' });
      }).toThrow('Unknown provider: invalid');
    });
    
    test('error message includes supported providers', () => {
      try {
        getProvider('invalid' as any, { apiKey: 'test' });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('groq');
        expect((error as Error).message).toContain('openrouter');
      }
    });
  });
  
  describe('getProviderNames', () => {
    test('returns all registered providers', () => {
      const names = getProviderNames();
      
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('groq');
      expect(names).toContain('openrouter');
      expect(names).toContain('workers-ai');
    });
    
    test('returns correct number of providers', () => {
      const names = getProviderNames();
      
      expect(names.length).toBe(4);
    });
  });
  
  describe('isValidProvider', () => {
    test('returns true for valid providers', () => {
      expect(isValidProvider('groq')).toBe(true);
      expect(isValidProvider('openrouter')).toBe(true);
      expect(isValidProvider('cerebras')).toBe(true);
      expect(isValidProvider('workers-ai')).toBe(true);
    });
    
    test('returns false for invalid providers', () => {
      expect(isValidProvider('invalid')).toBe(false);
      expect(isValidProvider('anthropic')).toBe(false);
      expect(isValidProvider('openai')).toBe(false);
      expect(isValidProvider('')).toBe(false);
    });
    
    test('acts as type guard', () => {
      const provider: string = 'groq';
      
      if (isValidProvider(provider)) {
        // Type should be narrowed to SupportedProvider
        const typedProvider: SupportedProvider = provider;
        expect(typedProvider).toBe('groq');
      }
    });
  });
  
  describe('Type Safety', () => {
    test('SupportedProvider type includes all providers', () => {
      // This test verifies TypeScript compilation
      const groq: SupportedProvider = 'groq';
      const openrouter: SupportedProvider = 'openrouter';
      const workersAi: SupportedProvider = 'workers-ai';
      
      expect(groq).toBe('groq');
      expect(openrouter).toBe('openrouter');
      expect(workersAi).toBe('workers-ai');
      
      // @ts-expect-error - invalid provider should not compile
      // const invalid: SupportedProvider = 'invalid';
    });
  });
});
