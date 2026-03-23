/**
 * Session Logger Utilities
 * 
 * Logger utilities for session handling.
 */

import { ServerWebSocket } from 'bun';
import { createConsoleLogger, SNDBRDLogger } from '../../lib/logger';
import type { SessionData } from '../types';

/**
 * Get or create a logger instance for the current session
 */
export function getSessionLogger(ws: ServerWebSocket<SessionData>): SNDBRDLogger {
  // Use session ID from WebSocket data
  const sessionId = ws.data?.sessionId || 'unknown-session';
  const source = 'session-handler';

  return createConsoleLogger(sessionId, undefined, source);
}
