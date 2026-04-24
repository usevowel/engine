/**
 * Response turn scope — coordinates cancellation of the active assistant turn via
 * {@link SessionData.responseTurnAbort} and deduplicated `response.done` cancel events.
 */

import { ServerWebSocket } from 'bun';
import type { SessionData } from '../types';
import { sendResponseCancelled } from '../utils/event-sender';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Emits a single `response.done(cancelled)` for `responseId` if one was not already sent
 * (e.g. VAD and the stream loop can both notice the same turn ending).
 *
 * @param ws - Active session WebSocket
 * @param responseId - Response id to cancel
 * @param reason - OpenAI Realtime–style cancel reason
 * @returns true if this call emitted the event, false if it was a duplicate
 */
export function tryEmitResponseCancelled(
  ws: ServerWebSocket<SessionData>,
  responseId: string,
  reason: 'turn_detected' | 'client_cancelled',
): boolean {
  const data = ws.data;
  if (!data.responseCancelEventSentForIds) {
    data.responseCancelEventSentForIds = new Set();
  }
  if (data.responseCancelEventSentForIds.has(responseId)) {
    return false;
  }
  data.responseCancelEventSentForIds.add(responseId);
  sendResponseCancelled(ws, responseId, reason);
  getEventSystem().info(
    EventCategory.SESSION,
    `📤 Sent response.done(cancelled) for ${responseId}`,
  );
  return true;
}

/**
 * Aborts the active turn (if any), clears session turn pointers, and emits cancel once.
 * Used by VAD, integrated VAD, and client `response.cancel`.
 *
 * @param ws - Active session WebSocket
 * @param reason - Source of cancellation for the client event
 */
export function cancelActiveResponseTurn(
  ws: ServerWebSocket<SessionData>,
  reason: 'turn_detected' | 'client_cancelled',
): void {
  const data = ws.data;
  if (!data.currentResponseId) {
    return;
  }
  const id = data.currentResponseId;
  getEventSystem().info(
    EventCategory.SESSION,
    `⚡ Cancelling active response turn ${id} (${reason})`,
  );
  if (data.pendingInterrupt?.confirmTimer) {
    clearTimeout(data.pendingInterrupt.confirmTimer);
  }
  if (data.pendingInterrupt?.maxTimer) {
    clearTimeout(data.pendingInterrupt.maxTimer);
  }
  data.pendingInterrupt = null;
  data.responseTurnAbort?.abort();
  data.responseTurnAbort = null;
  data.currentResponseId = null;
  tryEmitResponseCancelled(ws, id, reason);
}
