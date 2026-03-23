/**
 * Duration Utilities
 * 
 * Duration limit checking utilities for session handling.
 */

import { ServerWebSocket } from 'bun';
import { generateEventId } from '../../lib/protocol';
import type { SessionData } from '../types';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Check call duration limits and disconnect if exceeded
 * 
 * Checks:
 * - Maximum call duration (total time since connection)
 * - Maximum idle duration (time since last detected speech)
 * 
 * @param ws WebSocket connection
 * @returns true if should disconnect, false otherwise
 */
export function checkDurationLimits(ws: ServerWebSocket<SessionData>): boolean {
  const now = Date.now();
  const data = ws.data;
  
  // Check max call duration
  if (data.connectionStartTime && data.maxCallDurationMs) {
    const callDuration = now - data.connectionStartTime;
    if (callDuration >= data.maxCallDurationMs) {
      getEventSystem().info(EventCategory.PERFORMANCE, `⏱️  Max call duration reached (${callDuration / 1000}s / ${data.maxCallDurationMs / 1000}s)`);
      getEventSystem().info(EventCategory.SESSION, `⏱️  Closing connection cleanly...`);
      
      // Clear the interval immediately to prevent further checks
      cleanupDurationCheck(data);
      
      // Send a final message before closing (Cloudflare Workers workaround for close event not firing)
      // This ensures the client receives notification before WebSocket closes
      const closeMessage = {
        type: 'error',
        error: {
          type: 'session_timeout',
          code: 'max_call_duration_exceeded',
          message: `Session ended: Maximum call duration of ${Math.floor(data.maxCallDurationMs / 1000)} seconds reached`,
          param: null,
          event_id: generateEventId(),
        },
      };
      
      try {
        ws.send(JSON.stringify(closeMessage));
        getEventSystem().info(EventCategory.SESSION, `⏱️  Sent close notification to client`);
      } catch (e) {
        getEventSystem().error(EventCategory.SESSION, `⏱️  Failed to send close notification:`, e);
      }
      
      // Wait a moment for message to be delivered, then close
      // This is necessary because Cloudflare Workers Hibernation WebSockets
      // don't reliably trigger close events on the client side
      const maxCallDuration = data.maxCallDurationMs; // Capture for closure
      setTimeout(() => {
        ws.close(1000, `Session ended: Maximum call duration of ${Math.floor(maxCallDuration / 1000)} seconds reached`);
        getEventSystem().info(EventCategory.SESSION, `⏱️  WebSocket closed after timeout notification`);
      }, 100);
      
      return true;
    }
  }
  
  // Check max idle duration (only if speech has been detected before)
  if (data.lastSpeechTime && data.maxIdleDurationMs) {
    const idleDuration = now - data.lastSpeechTime;
    if (idleDuration >= data.maxIdleDurationMs) {
      getEventSystem().info(EventCategory.PERFORMANCE, `⏱️  Max idle duration reached (${idleDuration / 1000}s / ${data.maxIdleDurationMs / 1000}s)`);
      getEventSystem().info(EventCategory.SESSION, `⏱️  Closing connection cleanly...`);
      
      // Clear the interval immediately to prevent further checks
      cleanupDurationCheck(data);
      
      // Send a final message before closing (Cloudflare Workers workaround for close event not firing)
      // This ensures the client receives notification before WebSocket closes
      const closeMessage = {
        type: 'error',
        error: {
          type: 'session_timeout',
          code: 'max_idle_duration_exceeded',
          message: `Session ended: No speech detected for ${Math.floor(data.maxIdleDurationMs / 1000)} seconds`,
          param: null,
          event_id: generateEventId(),
        },
      };
      
      try {
        ws.send(JSON.stringify(closeMessage));
        getEventSystem().info(EventCategory.SESSION, `⏱️  Sent close notification to client`);
      } catch (e) {
        getEventSystem().error(EventCategory.SESSION, `⏱️  Failed to send close notification:`, e);
      }
      
      // Wait a moment for message to be delivered, then close
      // This is necessary because Cloudflare Workers Hibernation WebSockets
      // don't reliably trigger close events on the client side
      const maxIdleDuration = data.maxIdleDurationMs; // Capture for closure
      setTimeout(() => {
        ws.close(1000, `Session ended: No speech detected for ${Math.floor(maxIdleDuration / 1000)} seconds`);
        getEventSystem().info(EventCategory.SESSION, `⏱️  WebSocket closed after timeout notification`);
      }, 100);
      
      return true;
    }
  }
  
  return false;
}

/**
 * Initialize duration check interval for a session
 * 
 * Sets up a timer that periodically checks if duration limits have been exceeded.
 * The interval is cleared automatically when the connection closes.
 * 
 * @param ws WebSocket connection
 */
export function initDurationCheck(ws: ServerWebSocket<SessionData>): void {
  const data = ws.data;
  
  // Only set up interval if duration limits are configured
  if (!data.maxCallDurationMs && !data.maxIdleDurationMs) {
    getEventSystem().info(EventCategory.PERFORMANCE, '⏱️  Duration limits not configured, skipping duration check');
    return;
  }
  
  getEventSystem().info(EventCategory.PERFORMANCE, '⏱️  Initializing duration check interval (every 10 seconds)');
  
  // Check every 10 seconds
  const interval = setInterval(() => {
    checkDurationLimits(ws);
  }, 10000);
  
  // Store interval reference for cleanup
  data.durationCheckInterval = interval;
}

/**
 * Clean up duration check interval
 * 
 * @param data Session data
 */
export function cleanupDurationCheck(data: SessionData): void {
  if (data.durationCheckInterval) {
    clearInterval(data.durationCheckInterval);
    data.durationCheckInterval = undefined;
    getEventSystem().info(EventCategory.PERFORMANCE, '⏱️  Duration check interval cleared');
  }
}
