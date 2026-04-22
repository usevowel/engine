import { describe, expect, test } from 'bun:test';
import { sendResponseCancelled } from '../event-sender';

function createMockWebSocket() {
  const sent: unknown[] = [];

  return {
    sent,
    ws: {
      send: (payload: string) => {
        sent.push(JSON.parse(payload));
      },
    },
  };
}

describe('event-sender response cancellation', () => {
  test('emits OpenAI-compatible response.done with cancelled status', () => {
    const { ws, sent } = createMockWebSocket();

    sendResponseCancelled(ws as any, 'resp_123', 'turn_detected');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'response.done',
      response: {
        id: 'resp_123',
        object: 'realtime.response',
        status: 'cancelled',
        status_details: {
          type: 'cancelled',
          reason: 'turn_detected',
        },
        output: [],
        usage: null,
      },
    });
  });
});
