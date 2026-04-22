/**
 * Response Event Handlers
 * 
 * Handlers for response.create and response.cancel events.
 */

import { ServerWebSocket } from 'bun';
import type { SessionData } from '../types';

import { getEventSystem, EventCategory } from '../../events';
import { sendResponseCancelled } from '../utils/event-sender';
import { sendError } from '../utils/errors';
// Forward declaration - will be imported from response/index.ts
let generateResponse: (ws: ServerWebSocket<SessionData>, options?: any) => Promise<void>;

/**
 * Set the generateResponse function (to avoid circular dependency)
 */
export function setGenerateResponse(fn: typeof generateResponse): void {
  generateResponse = fn;
}

/**
 * Handle response.create event
 * 
 * CRITICAL: Ignores response.create in these cases:
 * 1. If a subagent is actively executing (subagentExecuting flag)
 * 2. If there are pending subagent tool results (pendingSubagentResponseIgnores > 0)
 * 
 * This prevents the loop where:
 * 1. Subagent calls client tool
 * 2. Client executes tool and sends function_call_output + response.create
 * 3. Server generates new response, calling subagent again
 * 4. Loop repeats until timeout
 * 
 * The OpenAI Agents SDK automatically sends response.create after function_call_output.
 * In subagent mode, we must ignore these to prevent the loop.
 */
export async function handleResponseCreate(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  
  // Check if subagent is actively executing
  // If so, ignore this response.create - the subagent will handle continuation internally
  if (data.subagentExecuting) {
    getEventSystem().info(EventCategory.SESSION, 
      `🔒 [Subagent] Ignoring response.create - subagent is actively executing`
    );
    return;
  }
  
  // Check if we should ignore this response.create due to pending subagent tool results
  // When a subagent tool receives function_call_output, we add its toolCallId to pendingSubagentToolOutputs
  // The OpenAI Agents SDK automatically sends response.create after function_call_output
  // We ignore it if there are any pending subagent tool outputs
  if (data.pendingSubagentToolOutputs && data.pendingSubagentToolOutputs.size > 0) {
    const pendingCount = data.pendingSubagentToolOutputs.size;
    const pendingIds = Array.from(data.pendingSubagentToolOutputs).join(', ');
    data.pendingSubagentToolOutputs.clear();
    getEventSystem().info(EventCategory.SESSION, 
      `🔒 [Subagent] Ignoring response.create - ${pendingCount} pending subagent tool output(s): ${pendingIds}`
    );
    return;
  }
  
  await generateResponse(ws, event.response);
}

/**
 * Handle response.cancel event
 */
export async function handleResponseCancel(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const requestedResponseId = typeof event?.response_id === 'string' ? event.response_id : null;
  const responseId = requestedResponseId ?? data.currentResponseId;

  if (requestedResponseId && requestedResponseId !== data.currentResponseId) {
    sendError(ws, 'invalid_request_error', `No in-progress response found for response_id ${requestedResponseId}`);
    getEventSystem().warn(EventCategory.SESSION, `⚠️ Response cancellation requested for non-active response: ${requestedResponseId}`);
    return;
  }
  
  // Mark current response as cancelled
  if (responseId && data.currentResponseId === responseId) {
    data.currentResponseId = null;
  }

  if (responseId) {
    sendResponseCancelled(ws, responseId, 'client_cancelled');
    getEventSystem().warn(EventCategory.SESSION, `⚠️ Response cancellation requested: ${responseId}`);
    return;
  }
  
  sendError(ws, 'invalid_request_error', 'No response is currently in progress');
  getEventSystem().warn(EventCategory.SESSION, '⚠️ Response cancellation requested with no active response');
}
