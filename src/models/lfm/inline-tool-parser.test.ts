import { describe, expect, test } from 'bun:test';

import { LfmInlineToolParser } from './inline-tool-parser';
import { resolveModelDirective } from '..';

describe('LfmInlineToolParser', () => {
  test('streams safe text and extracts a tool call', () => {
    const parser = new LfmInlineToolParser();

    const first = parser.pushDelta('Searching now. <|tool_call_start|>[searchHotels(');
    const second = parser.pushDelta('city="Paris", guests=1)]<|tool_call_end|>');

    expect(first).toEqual([{ textDelta: 'Searching now. ' }]);
    expect(second).toHaveLength(1);
    expect(second[0]?.toolCall?.toolName).toBe('searchHotels');
    expect(second[0]?.toolCall?.args).toEqual({ city: 'Paris', guests: 1 });
  });

  test('keeps partial tool token prefix buffered', () => {
    const parser = new LfmInlineToolParser();

    const updates = parser.pushDelta('Hello <|tool_call_sta');

    expect(updates).toEqual([{ textDelta: 'Hello ' }]);
    expect(parser.flush()).toEqual([]);
  });
});

describe('model directive registry', () => {
  test('routes LFM openai-compatible models to inline parser strategy', () => {
    const directive = resolveModelDirective({
      provider: 'openai-compatible',
      model: 'lfm2.5-1.2b-instruct',
    });

    expect(directive.id).toBe('lfm');
    expect(directive.toolCallStrategy).toBe('inline-parser');
  });

  test('keeps Qwen on structured strategy by default', () => {
    const directive = resolveModelDirective({
      provider: 'openrouter',
      model: 'Qwen/Qwen3-8B',
    });

    expect(directive.id).toBe('qwen');
    expect(directive.toolCallStrategy).toBe('structured');
  });
});
