/**
 * Hibernation Manager
 * 
 * Manages session hibernation for server VAD mode.
 * Triggers hibernation after extended silence to reduce costs.
 */

import type { ServerWebSocket } from 'bun';
import type { SessionData } from '../types';
import { sendSessionHibernated, sendSessionResumed } from '../utils/event-sender';
import { getEventSystem, EventCategory } from '../../events';

// Default silence threshold before hibernation (30 seconds)
const DEFAULT_HIBERNATION_SILENCE_THRESHOLD_MS = 30000;

// Minimum time before hibernation can trigger after session start (5 seconds)
const MIN_SESSION_TIME_BEFORE_HIBERNATION_MS = 5000;

/**
 * Check if hibernation is enabled for this session
 */
export function isHibernationEnabled(data: SessionData): boolean {
  // Only enable for server_vad and semantic_vad modes
  const turnDetectionMode = data.config.turn_detection?.type;
  const isServerVADMode = turnDetectionMode === 'server_vad' || turnDetectionMode === 'semantic_vad';
  
  // Check if explicitly disabled
  if (data.hibernationConfig?.enabled === false) {
    return false;
  }
  
  // Default: enabled for server VAD modes
  return isServerVADMode;
}

/**
 * Get the silence threshold for hibernation
 */
export function getHibernationThresholdMs(data: SessionData): number {
  return data.hibernationConfig?.silenceThresholdMs ?? DEFAULT_HIBERNATION_SILENCE_THRESHOLD_MS;
}

/**
 * Track silence start - call when speech ends
 */
export function trackSilenceStart(data: SessionData): void {
  if (!isHibernationEnabled(data)) return;
  
  // Don't start tracking if already hibernated
  if (data.hibernated) return;
  
  data.silenceStartTime = Date.now();
  
  getEventSystem().debug(EventCategory.SESSION, '🕐 Silence tracking started', {
    silenceStartTime: data.silenceStartTime,
    thresholdMs: getHibernationThresholdMs(data),
  });
}

/**
 * Clear silence tracking - call when speech starts
 */
export function clearSilenceTracking(data: SessionData): void {
  if (data.silenceStartTime) {
    const silenceDuration = Date.now() - data.silenceStartTime;
    getEventSystem().debug(EventCategory.SESSION, '🗣️ Silence tracking cleared (speech detected)', {
      silenceDurationMs: silenceDuration,
    });
  }
  
  data.silenceStartTime = undefined;
}

/**
 * Check if session should hibernate due to extended silence
 * Call this periodically (e.g., on each audio chunk or speech_end event)
 */
export function shouldHibernate(data: SessionData): boolean {
  if (!isHibernationEnabled(data)) return false;
  if (data.hibernated) return false;
  if (!data.silenceStartTime) return false;
  
  // Check minimum session time
  const sessionDuration = data.connectionStartTime 
    ? Date.now() - data.connectionStartTime 
    : 0;
  if (sessionDuration < MIN_SESSION_TIME_BEFORE_HIBERNATION_MS) return false;
  
  const silenceDuration = Date.now() - data.silenceStartTime;
  const threshold = getHibernationThresholdMs(data);
  
  return silenceDuration >= threshold;
}

/**
 * Enter hibernation mode
 * - Closes STT stream
 - Sends hibernation event to client
 - Persists session state
 */
export async function enterHibernation(
  ws: ServerWebSocket<SessionData>
): Promise<void> {
  const data = ws.data;
  
  if (data.hibernated) {
    getEventSystem().warn(EventCategory.SESSION, '⚠️ Already hibernated, skipping enterHibernation');
    return;
  }
  
  getEventSystem().info(EventCategory.SESSION, '💤 Entering hibernation mode', {
    sessionId: data.sessionId,
    silenceDuration: data.silenceStartTime ? Date.now() - data.silenceStartTime : 0,
  });
  
  // 1. Close STT stream
  if (data.sttStream) {
    try {
      await data.sttStream.end();
      getEventSystem().info(EventCategory.SESSION, '🔌 STT stream closed for hibernation');
    } catch (error) {
      getEventSystem().error(EventCategory.SESSION, '❌ Error closing STT stream:', error);
    }
    data.sttStream = undefined;
  }
  
  // 2. Mark as hibernated
  data.hibernated = true;
  data.hibernationStartTime = Date.now();
  data.silenceStartTime = undefined;
  
  // 3. Send hibernation event to client
  sendSessionHibernated(ws, data.sessionId);
  
  getEventSystem().info(EventCategory.SESSION, '💤 Hibernation complete - waiting for wake signal');
}

/**
 * Exit hibernation mode
 * - Reinitializes STT stream
 * - Sends resumed event to client
 */
export async function exitHibernation(
  ws: ServerWebSocket<SessionData>,
  reinitializeSTT: () => Promise<void>
): Promise<void> {
  const data = ws.data;
  
  if (!data.hibernated) {
    getEventSystem().warn(EventCategory.SESSION, '⚠️ Not hibernated, skipping exitHibernation');
    return;
  }
  
  const hibernationDuration = data.hibernationStartTime 
    ? Date.now() - data.hibernationStartTime 
    : 0;
  
  getEventSystem().info(EventCategory.SESSION, '☀️ Exiting hibernation mode', {
    sessionId: data.sessionId,
    hibernationDurationMs: hibernationDuration,
  });
  
  // 1. Clear hibernation flags
  data.hibernated = false;
  data.hibernationStartTime = undefined;
  
  // 2. Reinitialize STT stream
  try {
    await reinitializeSTT();
    getEventSystem().info(EventCategory.SESSION, '✅ STT stream reinitialized after hibernation');
  } catch (error) {
    getEventSystem().error(EventCategory.SESSION, '❌ Error reinitializing STT stream:', error);
    throw error;
  }
  
  // 3. Send resumed event to client
  sendSessionResumed(ws, data.sessionId);
  
  getEventSystem().info(EventCategory.SESSION, '☀️ Session resumed from hibernation');
}
