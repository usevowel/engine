/**
 * Debug Event Handlers
 * 
 * Handlers for debug events.
 */

import { ServerWebSocket } from 'bun';
import { sendDebugLatencyResponse } from '../utils/event-sender';
import type { SessionData } from '../types';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Handle debug.get_latency event
 * 
 * Returns stored latency metrics without sending messages during response generation.
 * This is a debug-only feature that avoids the overhead of fake tool call events.
 */
export async function handleDebugGetLatency(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const includeHistory = event.includeHistory !== false; // Default to true
  
  getEventSystem().debug(EventCategory.PERFORMANCE, `🐛 [Debug] Latency metrics requested (includeHistory: ${includeHistory})`);
  
  // Send metrics to client
  sendDebugLatencyResponse(
    ws,
    data.latencyMetrics?.currentResponse || null,
    includeHistory ? (data.latencyMetrics?.historical || []) : undefined
  );
  
  getEventSystem().debug(EventCategory.PERFORMANCE, `✅ [Debug] Latency metrics sent (current: ${!!data.latencyMetrics?.currentResponse}, historical: ${data.latencyMetrics?.historical?.length || 0})`);
}
