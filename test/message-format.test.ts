import { describe, test, expect } from 'bun:test';

/**
 * Unit tests to verify AI SDK v5 message format compliance
 * 
 * This tests the exact format we use in session/handler.ts to ensure
 * it matches AI SDK v5 requirements.
 * 
 * Based on the validation errors, we know:
 * 1. tool-call content must use 'input' not 'args'
 * 2. tool-result content must use 'output' not 'result'  
 * 3. output must be an object, not a string
 * 4. The output object structure matters - it seems to expect certain formats
 */

// Simulate the conversation history item types from our protocol
interface ConversationItem {
  id: string;
  type: 'message' | 'function_call' | 'function_call_output';
  status?: 'in_progress' | 'completed' | 'incomplete';
  role?: 'user' | 'assistant' | 'system';
  content?: Array<{ type: string; text?: string; transcript?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

// This is the transformation logic from handler.ts
function transformToAISDKMessages(history: ConversationItem[]) {
  return history.map(item => {
    if (item.type === 'function_call') {
      return {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: item.call_id,
            toolName: item.name,
            input: JSON.parse(item.arguments || '{}'),
          }
        ],
      };
    } else if (item.type === 'function_call_output') {
      // AI SDK v5 requires output to be a discriminated union with 'type' field
      // Valid types: 'text', 'json', 'error-text', 'error-json', 'content'
      let outputValue: any;
      const outputStr = item.output || '';
      
      // Check if this is an error message
      const isError = outputStr.includes('error occurred') || 
                     outputStr.includes('Error:') || 
                     outputStr.includes('failed');
      
      try {
        // Try to parse as JSON first
        const parsed = outputStr ? JSON.parse(outputStr) : {};
        // Wrap in AI SDK v5 format
        outputValue = isError 
          ? { type: 'error-json', value: parsed }
          : { type: 'json', value: parsed };
      } catch {
        // If not valid JSON, treat as text or error-text
        outputValue = isError
          ? { type: 'error-text', value: outputStr }
          : { type: 'text', value: outputStr };
      }
      
      return {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: item.call_id,
            toolName: item.name || '',
            output: outputValue,
          }
        ],
      };
    }
    // Regular message content
    return {
      role: (item.role || 'user') as 'user' | 'system' | 'assistant',
      content: item.content?.map(c => c.text || c.transcript || '').join(' ') || '',
    };
  });
}

describe('AI SDK v5 Message Format Transformation', () => {
  
  test('transforms function_call to tool-call message', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_1',
        type: 'function_call',
        call_id: 'call_123',
        name: 'getGameContext',
        arguments: '{"playerId":"456"}',
      }
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe('tool-call');
    expect(messages[0].content[0].toolCallId).toBe('call_123');
    expect(messages[0].content[0].toolName).toBe('getGameContext');
    expect(messages[0].content[0].input).toEqual({ playerId: '456' });
  });
  
  test('transforms function_call_output with JSON string to tool-result', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_2',
        type: 'function_call_output',
        call_id: 'call_123',
        name: 'getGameContext',
        output: '{"location":"forest","wood":10}',
      }
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('tool');
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe('tool-result');
    expect(messages[0].content[0].toolCallId).toBe('call_123');
    expect(messages[0].content[0].toolName).toBe('getGameContext');
    // Output must be discriminated union: { type: 'json', value: ... }
    expect(messages[0].content[0].output).toEqual({
      type: 'json',
      value: {
        location: 'forest',
        wood: 10
      }
    });
    expect(messages[0].content[0].output.type).toBe('json');
  });
  
  test('transforms function_call_output with plain string to wrapped object', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_3',
        type: 'function_call_output',
        call_id: 'call_456',
        name: 'buildTrap',
        output: 'Success: trap built',
      }
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('tool');
    // Plain string output is wrapped as: { type: 'text', value: ... }
    expect(messages[0].content[0].output).toEqual({
      type: 'text',
      value: 'Success: trap built'
    });
    expect(messages[0].content[0].output.type).toBe('text');
  });
  
  test('transforms function_call_output with error message', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_error',
        type: 'function_call_output',
        call_id: 'call_error_123',
        name: 'buildTrap',
        output: 'An error occurred while running the tool. Please try again. Error: Error: Invalid JSON input for tool',
      }
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('tool');
    // Error messages should use 'error-text' type
    expect(messages[0].content[0].output).toEqual({
      type: 'error-text',
      value: 'An error occurred while running the tool. Please try again. Error: Error: Invalid JSON input for tool'
    });
    expect(messages[0].content[0].output.type).toBe('error-text');
  });
  
  test('transforms function_call_output with empty output', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_4',
        type: 'function_call_output',
        call_id: 'call_789',
        name: 'someAction',
        output: '',
      }
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(1);
    // Empty string is falsy, so `item.output ? JSON.parse(item.output) : {}`
    // returns {}, which is wrapped as { type: 'json', value: {} }
    expect(messages[0].content[0].output).toEqual({
      type: 'json',
      value: {}
    });
    expect(messages[0].content[0].output.type).toBe('json');
  });
  
  test('transforms complete conversation with tool call and result', () => {
    const history: ConversationItem[] = [
      {
        id: 'item_1',
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Build a trap' }],
      },
      {
        id: 'item_2',
        type: 'function_call',
        call_id: 'call_abc',
        name: 'buildTrap',
        arguments: '{"type":"spike"}',
      },
      {
        id: 'item_3',
        type: 'function_call_output',
        call_id: 'call_abc',
        name: 'buildTrap',
        output: '{"success":true,"trapId":"trap_123"}',
      },
    ];
    
    const messages = transformToAISDKMessages(history);
    
    expect(messages).toHaveLength(3);
    
    // User message
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Build a trap');
    
    // Tool call
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content[0].type).toBe('tool-call');
    expect(messages[1].content[0].input).toEqual({ type: 'spike' });
    
    // Tool result
    expect(messages[2].role).toBe('tool');
    expect(messages[2].content[0].type).toBe('tool-result');
    expect(messages[2].content[0].output).toEqual({
      type: 'json',
      value: {
        success: true,
        trapId: 'trap_123'
      }
    });
    expect(messages[2].content[0].output.type).toBe('json');
  });
});

