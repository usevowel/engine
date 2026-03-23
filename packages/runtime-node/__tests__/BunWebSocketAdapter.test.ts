/**
 * BunWebSocketAdapter Tests
 * 
 * Tests for the Bun WebSocket adapter.
 * 
 * @module __tests__
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { BunWebSocketAdapter } from '../src/adapters/BunWebSocketAdapter';
import type { RuntimeConfig } from '../../../src/config/RuntimeConfig';
import type { SessionData } from '../../../src/session/types';

// Mock ServerWebSocket
class MockServerWebSocket {
  public sentMessages: (string | ArrayBuffer | Uint8Array)[] = [];
  public closeCode?: number;
  public closeReason?: string;
  
  constructor(public data: SessionData) {}
  
  send(data: string | ArrayBuffer | Uint8Array): void {
    this.sentMessages.push(data);
  }
  
  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
  }
}

describe('BunWebSocketAdapter', () => {
  let mockWs: MockServerWebSocket;
  let adapter: BunWebSocketAdapter;
  
  const mockRuntimeConfig: RuntimeConfig = {
    llm: { provider: 'groq', model: 'test-model' },
    providers: {},
  };
  
  const mockSessionData: SessionData = {
    sessionId: 'test-session',
    model: 'test-model',
    config: {
      voice: 'Ashley',
      modalities: ['text', 'audio'],
      instructions: 'Test',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      turn_detection: { type: 'server_vad' },
      tools: [],
    },
    runtimeConfig: mockRuntimeConfig,
  } as SessionData;
  
  beforeEach(() => {
    mockWs = new MockServerWebSocket(mockSessionData);
    adapter = new BunWebSocketAdapter(mockWs as any);
  });

  describe('data accessor', () => {
    test('should return session data', () => {
      expect(adapter.data).toBe(mockSessionData);
      expect(adapter.data.sessionId).toBe('test-session');
    });
  });

  describe('runtimeConfig accessor', () => {
    test('should return runtime configuration', () => {
      expect(adapter.runtimeConfig).toBe(mockRuntimeConfig);
    });
  });

  describe('isOpen', () => {
    test('should return true by default', () => {
      expect(adapter.isOpen).toBe(true);
    });
  });

  describe('send', () => {
    test('should send string data', () => {
      const message = JSON.stringify({ type: 'test' });
      
      adapter.send(message);
      
      expect(mockWs.sentMessages).toHaveLength(1);
      expect(mockWs.sentMessages[0]).toBe(message);
    });
    
    test('should send Uint8Array', () => {
      const binary = new Uint8Array([1, 2, 3]);
      
      adapter.send(binary);
      
      expect(mockWs.sentMessages).toHaveLength(1);
      expect(mockWs.sentMessages[0]).toBe(binary);
    });
    
    test('should send ArrayBuffer', () => {
      const buffer = new ArrayBuffer(4);
      
      adapter.send(buffer);
      
      expect(mockWs.sentMessages).toHaveLength(1);
      expect(mockWs.sentMessages[0]).toBe(buffer);
    });
  });

  describe('sendBinary', () => {
    test('should send binary data', () => {
      const binary = new Uint8Array([0x00, 0x01]);
      
      adapter.sendBinary(binary);
      
      expect(mockWs.sentMessages).toHaveLength(1);
      expect(mockWs.sentMessages[0]).toBe(binary);
    });
  });

  describe('close', () => {
    test('should close with code and reason', () => {
      adapter.close(1000, 'Normal closure');
      
      expect(mockWs.closeCode).toBe(1000);
      expect(mockWs.closeReason).toBe('Normal closure');
    });
    
    test('should close without parameters', () => {
      adapter.close();
      
      expect(mockWs.closeCode).toBeUndefined();
      expect(mockWs.closeReason).toBeUndefined();
    });
  });
});
