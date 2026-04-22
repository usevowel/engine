import { describe, expect, test } from 'bun:test';
import type { CoreMessage } from 'ai';
import { repairToolMessageSequence } from './agentUtils';

describe('repairToolMessageSequence', () => {
  test('keeps adjacent tool-call and tool-result messages', () => {
    const messages: CoreMessage[] = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'search',
            input: { query: 'vowel' },
          } as any,
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'search',
            output: { type: 'text', value: 'result' },
          } as any,
        ],
      },
      { role: 'user', content: 'thanks' },
    ];

    expect(repairToolMessageSequence(messages)).toEqual(messages);
  });

  test('removes tool calls whose results are separated by system messages', () => {
    const repaired = repairToolMessageSequence([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'search',
            input: { query: 'vowel' },
          } as any,
        ],
      },
      { role: 'system', content: 'diagnostic update' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'search',
            output: { type: 'text', value: 'late result' },
          } as any,
        ],
      },
      { role: 'user', content: 'continue' },
    ]);

    expect(repaired).toEqual([
      { role: 'system', content: 'diagnostic update' },
      { role: 'user', content: 'continue' },
    ]);
  });

  test('preserves non-tool assistant content while removing only invalid tool calls', () => {
    const repaired = repairToolMessageSequence([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking that now.' } as any,
          {
            type: 'tool-call',
            toolCallId: 'call_valid',
            toolName: 'lookup',
            input: {},
          } as any,
          {
            type: 'tool-call',
            toolCallId: 'call_missing',
            toolName: 'lookup',
            input: {},
          } as any,
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_valid',
            toolName: 'lookup',
            output: { type: 'json', value: { ok: true } },
          } as any,
        ],
      },
    ]);

    expect(repaired).toHaveLength(2);
    expect((repaired[0].content as any[]).map(part => part.type)).toEqual(['text', 'tool-call']);
    expect((repaired[0].content as any[])[1].toolCallId).toBe('call_valid');
    expect((repaired[1].content as any[])[0].toolCallId).toBe('call_valid');
  });
});
