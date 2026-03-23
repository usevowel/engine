/**
 * Tests for ClientToolProxyManager
 * 
 * Verifies the Promise-based tool proxy pattern works correctly.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { ClientToolProxyManager, convertSessionToolsToProxyTools } from '../src/lib/client-tool-proxy';

// Mock WebSocket
const mockWs = {
  send: (message: string) => {
    console.log('[Mock WS] Sent:', JSON.parse(message).type);
  },
  data: {
    sessionId: 'test-session',
  },
} as any;

describe('ClientToolProxyManager', () => {
  let manager: ClientToolProxyManager;
  
  beforeEach(() => {
    manager = new ClientToolProxyManager(mockWs);
  });
  
  afterEach(() => {
    manager.cleanup();
  });
  
  test('creates proxy tool that returns pending Promise', () => {
    const navigateTool = manager.createProxyTool(
      'navigate',
      'Navigate to a page',
      z.object({ path: z.string() })
    );
    
    expect(navigateTool).toBeDefined();
    expect(navigateTool.description).toBe('Navigate to a page');
  });
  
  test('tool execution waits for client response', async () => {
    const navigateTool = manager.createProxyTool(
      'navigate',
      'Navigate to a page',
      z.object({ path: z.string() })
    );
    
    // Start execution (will be pending)
    const resultPromise = navigateTool.execute({ path: '/products' });
    
    // Verify it's pending
    expect(manager.getPendingCount()).toBe(1);
    expect(manager.getPendingToolNames()).toContain('navigate');
    
    // Simulate client response after delay
    setTimeout(() => {
      // In real code, we'd extract call_id from WebSocket message
      // For test, we'll use the first pending call
      const toolCallId = Array.from((manager as any).pendingCalls.keys())[0];
      manager.resolveToolCall(toolCallId, { success: true, path: '/products' });
    }, 100);
    
    // Should resolve with result
    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.path).toBe('/products');
    expect(manager.getPendingCount()).toBe(0);
  });
  
  test('times out if client does not respond', async () => {
    // Create manager with short timeout for testing
    const shortTimeoutManager = new ClientToolProxyManager(mockWs);
    (shortTimeoutManager as any).TOOL_TIMEOUT_MS = 200;  // 200ms timeout
    
    const navigateTool = shortTimeoutManager.createProxyTool(
      'navigate',
      'Navigate to a page',
      z.object({ path: z.string() })
    );
    
    // Start execution, never resolve
    try {
      await navigateTool.execute({ path: '/products' });
      throw new Error('Should have timed out');
    } catch (error: any) {
      expect(error.message).toContain('timeout');
    }
    
    // Should have cleaned up
    expect(shortTimeoutManager.getPendingCount()).toBe(0);
    
    shortTimeoutManager.cleanup();
  }, { timeout: 5000 });
  
  test('rejects tool call on error', async () => {
    const navigateTool = manager.createProxyTool(
      'navigate',
      'Navigate to a page',
      z.object({ path: z.string() })
    );
    
    // Start execution
    const resultPromise = navigateTool.execute({ path: '/invalid' });
    
    // Simulate client error response
    setTimeout(() => {
      const toolCallId = Array.from((manager as any).pendingCalls.keys())[0];
      manager.rejectToolCall(toolCallId, 'Navigation failed: Page not found');
    }, 100);
    
    // Should reject with error
    try {
      await resultPromise;
      throw new Error('Should have rejected');
    } catch (error: any) {
      expect(error.message).toContain('Navigation failed');
    }
    
    expect(manager.getPendingCount()).toBe(0);
  });
  
  test('cleanup rejects all pending calls', async () => {
    const navigateTool = manager.createProxyTool(
      'navigate',
      'Navigate to a page',
      z.object({ path: z.string() })
    );
    
    // Start multiple executions
    const promise1 = navigateTool.execute({ path: '/page1' });
    const promise2 = navigateTool.execute({ path: '/page2' });
    
    expect(manager.getPendingCount()).toBe(2);
    
    // Cleanup (simulates disconnect)
    manager.cleanup();
    
    // All should reject
    try {
      await promise1;
      throw new Error('Should have rejected');
    } catch (error: any) {
      expect(error.message).toContain('Session disconnected');
    }
    
    try {
      await promise2;
      throw new Error('Should have rejected');
    } catch (error: any) {
      expect(error.message).toContain('Session disconnected');
    }
    
    expect(manager.getPendingCount()).toBe(0);
  });
});

describe('convertSessionToolsToProxyTools', () => {
  let manager: ClientToolProxyManager;
  
  beforeEach(() => {
    manager = new ClientToolProxyManager(mockWs);
  });
  
  afterEach(() => {
    manager.cleanup();
  });
  
  test('converts OpenAI tool format to proxy tools', () => {
    const sessionTools = [
      {
        name: 'navigate',
        description: 'Navigate to a page',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to navigate to',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'search',
        description: 'Search for items',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum results',
            },
          },
          required: ['query'],
        },
      },
    ];
    
    const proxyTools = convertSessionToolsToProxyTools(sessionTools, manager);
    
    expect(Object.keys(proxyTools)).toHaveLength(2);
    expect(proxyTools.navigate).toBeDefined();
    expect(proxyTools.search).toBeDefined();
    expect(proxyTools.navigate.description).toBe('Navigate to a page');
    expect(proxyTools.search.description).toBe('Search for items');
  });
  
  test('handles optional parameters correctly', () => {
    const sessionTools = [
      {
        name: 'addToCart',
        description: 'Add item to cart',
        parameters: {
          type: 'object',
          properties: {
            productId: {
              type: 'string',
              description: 'Product ID',
            },
            quantity: {
              type: 'number',
              description: 'Quantity',
            },
          },
          required: ['productId'],  // quantity is optional
        },
      },
    ];
    
    const proxyTools = convertSessionToolsToProxyTools(sessionTools, manager);
    
    expect(proxyTools.addToCart).toBeDefined();
    
    // Should accept without optional parameter
    // (We can't easily test Zod schema validation here, but the tool should be created)
  });
  
  test('skips tools with missing name or description', () => {
    const sessionTools = [
      {
        name: 'goodTool',
        description: 'A good tool',
        parameters: { type: 'object', properties: {} },
      },
      {
        // Missing name
        description: 'Bad tool 1',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'badTool2',
        // Missing description
        parameters: { type: 'object', properties: {} },
      },
    ];
    
    const proxyTools = convertSessionToolsToProxyTools(sessionTools, manager);
    
    expect(Object.keys(proxyTools)).toHaveLength(1);
    expect(proxyTools.goodTool).toBeDefined();
  });
});

