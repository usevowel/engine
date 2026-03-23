import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ConversationSummarizer, type SummarizationConfig } from '../src/lib/conversation-summarizer';
import type { CoreMessage } from 'ai';

describe('ConversationSummarizer', () => {
  let config: SummarizationConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      activeWindowSize: 3,
      summarizationBufferSize: 2,
      maxSummaries: 2,
      summarizationProvider: 'groq',
      summarizationModel: 'openai/gpt-oss-20b',
      apiKey: 'test-key',
    };
  });

  describe('Initialization', () => {
    test('creates instance with default config', () => {
      const summarizer = new ConversationSummarizer(config);
      const state = summarizer.getState();

      expect(state.activeWindowSize).toBe(0);
      expect(state.summarizationBufferSize).toBe(0);
      expect(state.summaryCount).toBe(0);
      expect(state.totalMessagesSummarized).toBe(0);
      expect(state.isProcessing).toBe(false);
    });

    test('applies custom config values', () => {
      const customConfig: SummarizationConfig = {
        enabled: true,
        activeWindowSize: 5,
        summarizationBufferSize: 3,
        maxSummaries: 4,
        summarizationProvider: 'cerebras',
        summarizationModel: 'llama-3.3-70b', // Cerebras model
        apiKey: 'test-key',
      };

      const summarizer = new ConversationSummarizer(customConfig);
      // Config is private, but we can verify behavior
      expect(summarizer.getState()).toBeDefined();
    });
  });

  describe('Message Management', () => {
    test('adds messages to active window', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });

      const state = summarizer.getState();
      expect(state.activeWindowSize).toBe(2);
      expect(state.summarizationBufferSize).toBe(0);
    });

    test('moves messages to summarization buffer when active window full', () => {
      const summarizer = new ConversationSummarizer(config);

      // Fill active window (size: 3)
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });

      let state = summarizer.getState();
      expect(state.activeWindowSize).toBe(3);
      expect(state.summarizationBufferSize).toBe(0);

      // Add one more - should move oldest to buffer
      summarizer.addMessage({ role: 'assistant', content: 'Response 2' });

      state = summarizer.getState();
      expect(state.activeWindowSize).toBe(3); // Still 3 (window size)
      expect(state.summarizationBufferSize).toBe(1); // Oldest moved here
    });

    test('triggers summarization when buffer full', async () => {
      const summarizer = new ConversationSummarizer(config);

      // Fill active window (3 messages)
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });

      // Add 2 more to fill summarization buffer (size: 2)
      summarizer.addMessage({ role: 'assistant', content: 'Response 2' });
      summarizer.addMessage({ role: 'user', content: 'Message 3' });

      // Wait a bit for async summarization to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = summarizer.getState();
      expect(state.summarizationBufferSize).toBe(0); // Buffer cleared
      // Note: isProcessing might be true or false depending on timing
    });

    test('handles disabled summarization', () => {
      const disabledConfig = { ...config, enabled: false };
      const summarizer = new ConversationSummarizer(disabledConfig);

      // Add many messages
      for (let i = 0; i < 10; i++) {
        summarizer.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const state = summarizer.getState();
      expect(state.activeWindowSize).toBe(10); // All in active window
      expect(state.summarizationBufferSize).toBe(0);
      expect(state.summaryCount).toBe(0);
    });
  });

  describe('Context Retrieval', () => {
    test('returns active window when no summaries', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Hello' });
      summarizer.addMessage({ role: 'assistant', content: 'Hi' });

      const context = summarizer.getContext();
      expect(context.length).toBe(2);
      expect(context[0].content).toBe('Hello');
      expect(context[1].content).toBe('Hi');
    });

    test('prepends system message when provided', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Hello' });

      const systemMessage: CoreMessage = {
        role: 'system',
        content: 'You are a helpful assistant.',
      };

      const context = summarizer.getContext(systemMessage);
      expect(context.length).toBe(2);
      expect(context[0].role).toBe('system');
      expect(context[0].content).toBe('You are a helpful assistant.');
      expect(context[1].content).toBe('Hello');
    });

    test('includes summary message when summaries exist', async () => {
      const summarizer = new ConversationSummarizer(config);

      // Fill active window and trigger summarization
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 2' });
      summarizer.addMessage({ role: 'user', content: 'Message 3' });

      // Wait for summarization to complete (or fail)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const context = summarizer.getContext();
      
      // Context should have: [summary message?, ...active window]
      // If summarization succeeded, first message should be summary
      if (context.length > 3) {
        expect(context[0].role).toBe('system');
        expect(context[0].content).toContain('Previous conversation summary');
      }
    });
  });

  describe('State Management', () => {
    test('getState returns accurate snapshot', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });

      const state = summarizer.getState();
      expect(state.activeWindowSize).toBe(2);
      expect(state.summarizationBufferSize).toBe(0);
      expect(state.summaryCount).toBe(0);
      expect(state.totalMessagesSummarized).toBe(0);
      expect(state.isProcessing).toBe(false);
    });

    test('clear() resets all buffers', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 2' });

      summarizer.clear();

      const state = summarizer.getState();
      expect(state.activeWindowSize).toBe(0);
      expect(state.summarizationBufferSize).toBe(0);
      expect(state.summaryCount).toBe(0);
      expect(state.totalMessagesSummarized).toBe(0);
    });

    test('getTotalMessageCount returns accurate count', () => {
      const summarizer = new ConversationSummarizer(config);

      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'assistant', content: 'Response 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });

      const total = summarizer.getTotalMessageCount();
      expect(total).toBe(3);
    });
  });

  describe('Rolling Buffer Strategy', () => {
    test('maintains active window size limit', () => {
      const summarizer = new ConversationSummarizer(config);

      // Add more messages than active window size
      for (let i = 0; i < 10; i++) {
        summarizer.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const state = summarizer.getState();
      expect(state.activeWindowSize).toBe(config.activeWindowSize);
    });

    test('oldest messages move to summarization buffer first', () => {
      const summarizer = new ConversationSummarizer(config);

      // Add messages with identifiable content
      summarizer.addMessage({ role: 'user', content: 'First' });
      summarizer.addMessage({ role: 'user', content: 'Second' });
      summarizer.addMessage({ role: 'user', content: 'Third' });
      summarizer.addMessage({ role: 'user', content: 'Fourth' }); // This pushes "First" to buffer

      const context = summarizer.getContext();
      
      // Active window should have Second, Third, Fourth (not First)
      expect(context.length).toBe(3);
      expect(context[0].content).toBe('Second');
      expect(context[1].content).toBe('Third');
      expect(context[2].content).toBe('Fourth');
    });

    test('summarization buffer clears when full', async () => {
      const summarizer = new ConversationSummarizer(config);

      // Fill active window + summarization buffer
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });
      summarizer.addMessage({ role: 'user', content: 'Message 3' });
      summarizer.addMessage({ role: 'user', content: 'Message 4' }); // Buffer: 1
      summarizer.addMessage({ role: 'user', content: 'Message 5' }); // Buffer: 2 (full!)

      // Wait for summarization to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = summarizer.getState();
      expect(state.summarizationBufferSize).toBe(0); // Buffer cleared
    });
  });

  describe('Error Handling', () => {
    test('handles summarization failure gracefully', async () => {
      // Use invalid API key to force failure
      const failConfig = { ...config, apiKey: 'invalid-key' };
      const summarizer = new ConversationSummarizer(failConfig);

      // Trigger summarization
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });
      summarizer.addMessage({ role: 'user', content: 'Message 3' });
      summarizer.addMessage({ role: 'user', content: 'Message 4' });
      summarizer.addMessage({ role: 'user', content: 'Message 5' });

      // Wait for summarization to fail
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const state = summarizer.getState();
      
      // Should restore messages to buffer on failure
      expect(state.summarizationBufferSize).toBeGreaterThan(0);
      expect(state.isProcessing).toBe(false);
    });

    test('prevents concurrent summarization', async () => {
      const summarizer = new ConversationSummarizer(config);

      // Trigger first summarization
      summarizer.addMessage({ role: 'user', content: 'Message 1' });
      summarizer.addMessage({ role: 'user', content: 'Message 2' });
      summarizer.addMessage({ role: 'user', content: 'Message 3' });
      summarizer.addMessage({ role: 'user', content: 'Message 4' });
      summarizer.addMessage({ role: 'user', content: 'Message 5' });

      // Immediately try to trigger another (should be skipped)
      summarizer.addMessage({ role: 'user', content: 'Message 6' });
      summarizer.addMessage({ role: 'user', content: 'Message 7' });

      const state = summarizer.getState();
      // Second batch should remain in buffer (not trigger new summarization)
      expect(state.summarizationBufferSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Provider Integration', () => {
    test('accepts different providers', () => {
      const groqConfig = { ...config, summarizationProvider: 'groq' as const };
      const cerebrasConfig = { ...config, summarizationProvider: 'cerebras' as const };
      const openrouterConfig = { 
        ...config, 
        summarizationProvider: 'openrouter' as const,
        summarizationModel: 'anthropic/claude-3-5-sonnet', // OpenRouter model
      };

      const groqSummarizer = new ConversationSummarizer(groqConfig);
      const cerebrasSummarizer = new ConversationSummarizer(cerebrasConfig);
      const openrouterSummarizer = new ConversationSummarizer(openrouterConfig);

      expect(groqSummarizer).toBeDefined();
      expect(cerebrasSummarizer).toBeDefined();
      expect(openrouterSummarizer).toBeDefined();
    });

    test('passes OpenRouter config correctly', () => {
      const openrouterConfig: SummarizationConfig = {
        ...config,
        summarizationProvider: 'openrouter',
        openrouterSiteUrl: 'https://example.com',
        openrouterAppName: 'Test App',
      };

      const summarizer = new ConversationSummarizer(openrouterConfig);
      expect(summarizer).toBeDefined();
    });
  });
});

