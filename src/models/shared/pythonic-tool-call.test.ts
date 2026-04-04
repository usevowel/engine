import { describe, expect, test } from 'bun:test';

import {
  extractPythonicToolCall,
  repairPythonicToolCall,
  serializePythonicToolCall,
} from './pythonic-tool-call';

describe('pythonic tool call helpers', () => {
  test('extracts LFM inline tool call arguments', () => {
    const parsed = extractPythonicToolCall(
      '<|tool_call_start|>[searchHotels(city="San Francisco", guests=2, flexible=true)]<|tool_call_end|>',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.toolName).toBe('searchHotels');
    expect(parsed?.args).toEqual({
      city: 'San Francisco',
      guests: 2,
      flexible: true,
    });
  });

  test('repairs incomplete tool calls', () => {
    const repaired = repairPythonicToolCall(
      '<|tool_call_start|>[checkBooking(bookingId="BK-123"',
    );

    expect(repaired.repaired).toContain('<|tool_call_end|>');
    expect(repaired.repaired).toContain('"])<|tool_call_end|>');
    expect(repaired.repairsApplied.length).toBeGreaterThan(0);
  });

  test('serializes pythonic arguments', () => {
    const serialized = serializePythonicToolCall('bookRoom', {
      hotelId: 'hotel_001',
      guests: 2,
      confirmed: true,
    });

    expect(serialized).toBe(
      '<|tool_call_start|>[bookRoom(hotelId="hotel_001", guests=2, confirmed=true)]<|tool_call_end|>',
    );
  });
});
