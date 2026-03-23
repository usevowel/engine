/**
 * WebSocket Session Handler
 * 
 * Handles WebSocket messages and manages session state.
 * 
 * This file has been refactored to use modular handlers and utilities.
 * See REFACTORING_COMPLETION_GUIDE.md for details.
 */

import { ServerWebSocket } from 'bun';
import { ClientEvent, generateEventId } from '../lib/protocol';

import { getEventSystem, EventCategory } from '../events';
/**
 * Extended Client Event Type
 * 
 * Includes official OpenAI Realtime API events plus our custom debug events.
 */
export type ExtendedClientEvent =
  | ClientEvent
  | { type: 'debug.get_latency'; includeHistory?: boolean };

// Import types
import type { SessionData } from './types';

// Import utilities
import { getSessionLogger } from './utils/logger';
import { sendError } from './utils/errors';
import { cleanupDurationCheck } from './utils/duration';

// Import handlers
import {
  handleSessionUpdate,
  handleAudioAppend,
  handleAudioCommit,
  handleAudioClear,
  handleConversationItemCreate,
  handleConversationItemRetrieve,
  handleConversationItemTruncate,
  handleResponseCreate,
  handleResponseCancel,
  handleDebugGetLatency,
  handleInitialGreeting,
  handleStreamingTranscript,
} from './handlers';

// Import setGenerateResponse from individual files to avoid ambiguous exports
import { setGenerateResponse as setAudioGenerateResponse } from './handlers/audio';
import { setGenerateResponse as setResponseGenerateResponse } from './handlers/response';
import { setGenerateResponse as setConversationGenerateResponse } from './handlers/conversation';

// Import response generation
import { generateResponse } from './response';

// Re-export types for backward compatibility
export type { SessionData, ResponseLatencyMetrics } from './types';

// Re-export duration utilities
export { initDurationCheck, cleanupDurationCheck } from './utils/duration';

// Re-export handlers for use in other files (e.g., server.ts)
export { handleInitialGreeting, handleStreamingTranscript } from './handlers';

// Set up circular dependency resolution for generateResponse
// This allows handlers to call generateResponse without circular imports
setAudioGenerateResponse(generateResponse);
setResponseGenerateResponse(generateResponse);
setConversationGenerateResponse(generateResponse);

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
function checkDurationLimits(ws: ServerWebSocket<SessionData>): boolean {
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
 * Handle incoming WebSocket message
 */
export async function handleMessage(
  ws: ServerWebSocket<SessionData> & { runtimeConfig?: any },
  message: string | Buffer
): Promise<void> {
  const logger = getSessionLogger(ws);

  try {
    // Extract runtime config (available in Workers, fallback for Bun)
    const runtimeConfig = (ws as any).runtimeConfig;
    if (!runtimeConfig) {
      throw new Error('Runtime config not provided. Handler requires runtime configuration.');
    }

    // Store runtime config in session data for access by handlers
    if (!ws.data.runtimeConfig) {
      ws.data.runtimeConfig = runtimeConfig;
    }

    // Check duration limits before processing message
    if (checkDurationLimits(ws)) {
      return; // Connection will be closed by checkDurationLimits
    }

    // Parse event (may include custom debug events)
    const event: ExtendedClientEvent = JSON.parse(message.toString());

    // Log all events except input_audio_buffer.append to avoid log spam
    if (event.type !== 'input_audio_buffer.append') {
      logger.info(`Received event: ${event.type}`, {
        operation: 'event_received',
      });
    }
    
    // Route to appropriate handler
    switch (event.type) {
      case 'session.update':
        await handleSessionUpdate(ws, event);
        break;
        
      case 'input_audio_buffer.append':
        await handleAudioAppend(ws, event);
        break;
        
      case 'input_audio_buffer.commit':
        await handleAudioCommit(ws, event);
        break;
        
      case 'input_audio_buffer.clear':
        await handleAudioClear(ws, event);
        break;
        
      case 'conversation.item.create':
        await handleConversationItemCreate(ws, event);
        break;
        
      case 'conversation.item.retrieve':
        await handleConversationItemRetrieve(ws, event);
        break;
        
      case 'conversation.item.truncate':
        await handleConversationItemTruncate(ws, event);
        break;
        
      case 'response.create':
        await handleResponseCreate(ws, event);
        break;
        
      case 'response.cancel':
        await handleResponseCancel(ws, event);
        break;
        
      case 'debug.get_latency':
        await handleDebugGetLatency(ws, event);
        break;
        
      default:
        // Just log a warning - don't send error to client
        // Some SDKs (like OpenAI Agents SDK) may send events we don't support yet
        getEventSystem().warn(EventCategory.SESSION, `⚠️  Unhandled client event type: ${(event as any).type} (ignoring)`);
    }
  } catch (error) {
    getEventSystem().error(EventCategory.SESSION, '❌ Error handling message:', error);
    sendError(
      ws,
      'server_error',
      error instanceof Error ? error.message : 'Internal server error'
    );
  }
}
