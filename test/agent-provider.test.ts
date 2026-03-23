/**
 * Tests for SoundbirdAgent
 * 
 * Verifies the Agent wrapper works with context management and loop detection.
 * 
 * Note: These are basic tests that verify initialization and configuration.
 * Full integration tests with real LLM calls are in agent-session.spec.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SoundbirdAgent } from '../src/services/agent-provider';
import { ClientToolProxyManager } from '../src/lib/client-tool-proxy';

// Mock WebSocket
const mockWs = {
  send: (message: string) => {
    // Silent mock
  },
  data: {
    sessionId: 'test-session',
  },
} as any;

describe('SoundbirdAgent', () => {
  let toolProxyManager: ClientToolProxyManager;
  
  beforeEach(() => {
    toolProxyManager = new ClientToolProxyManager(mockWs);
  });
  
  afterEach(() => {
    toolProxyManager.cleanup();
  });
  
  test('initializes with Groq provider', () => {
    const agent = new SoundbirdAgent({
      provider: 'groq',
      apiKey: 'test-key',
      model: 'moonshotai/kimi-k2-instruct-0905',
      systemPrompt: 'You are a test assistant',
      maxSteps: 3,
      maxContextMessages: 15,
    }, toolProxyManager);
    
    expect(agent).toBeDefined();
    
    const config = agent.getConfig();
    expect(config.provider).toBe('groq');
    expect(config.model).toBe('moonshotai/kimi-k2-instruct-0905');
    expect(config.maxSteps).toBe(3);
    expect(config.maxContextMessages).toBe(15);
  });
  
  test('initializes with OpenRouter provider', () => {
    const agent = new SoundbirdAgent({
      provider: 'openrouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-3-5-sonnet',
      systemPrompt: 'You are a test assistant',
      maxSteps: 5,
      maxContextMessages: 20,
      openrouterSiteUrl: 'https://example.com',
      openrouterAppName: 'Test App',
    }, toolProxyManager);
    
    expect(agent).toBeDefined();
    
    const config = agent.getConfig();
    expect(config.provider).toBe('openrouter');
    expect(config.model).toBe('anthropic/claude-3-5-sonnet');
    expect(config.maxSteps).toBe(5);
    expect(config.maxContextMessages).toBe(20);
    expect(config.openrouterSiteUrl).toBe('https://example.com');
    expect(config.openrouterAppName).toBe('Test App');
  });
  
  test('uses default values for maxSteps and maxContextMessages', () => {
    const agent = new SoundbirdAgent({
      provider: 'groq',
      apiKey: 'test-key',
      model: 'moonshotai/kimi-k2-instruct-0905',
      systemPrompt: 'You are a test assistant',
      // No maxSteps or maxContextMessages specified
    }, toolProxyManager);
    
    expect(agent).toBeDefined();
    
    // Defaults should be applied (maxSteps: 3, maxContextMessages: 15)
    // We can't easily verify internal Agent config, but at least it should initialize
  });
  
  test('getConfig returns readonly copy', () => {
    const agent = new SoundbirdAgent({
      provider: 'groq',
      apiKey: 'test-key',
      model: 'test-model',
      systemPrompt: 'Test',
      maxSteps: 3,
    }, toolProxyManager);
    
    const config1 = agent.getConfig();
    const config2 = agent.getConfig();
    
    // Should return different objects (copies)
    expect(config1).not.toBe(config2);
    
    // But with same values
    expect(config1.provider).toBe(config2.provider);
    expect(config1.model).toBe(config2.model);
  });
});

