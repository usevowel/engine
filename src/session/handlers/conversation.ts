/**
 * Conversation Event Handlers
 * 
 * Handlers for conversation item events (create, retrieve, truncate).
 */

import { ServerWebSocket } from 'bun';
import { generateEventId, generateItemId } from '../../lib/protocol';
import { sendError } from '../utils/errors';
import { 
  sendConversationItemCreated,
  sendConversationItemRetrieved,
  sendConversationItemTruncated
} from '../utils/event-sender';
import type { SessionData } from '../types';
import type { ConversationItem } from '../../lib/protocol';

import { getEventSystem, EventCategory } from '../../events';
// Forward declaration - will be imported from response/index.ts
let generateResponse: (ws: ServerWebSocket<SessionData>, options?: any) => Promise<void>;

/**
 * Set the generateResponse function (to avoid circular dependency)
 */
export function setGenerateResponse(fn: typeof generateResponse): void {
  generateResponse = fn;
}

/**
 * Handle conversation.item.create event (text input, function outputs, etc.)
 */
export async function handleConversationItemCreate(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const item = event.item as ConversationItem;
  
  // Generate ID if not provided
  if (!item.id) {
    item.id = generateItemId();
  }
  
  // If it's a function_call_output, route to event bus for subagent tool calls
  // CRITICAL: Subagent tool calls/results are NOT added to conversation history
  // They are tracked separately and only the final askSubagent result is visible to main agent
  if (item.type === 'function_call_output' && item.call_id) {
    // Check if this belongs to a subagent tool call (via toolCallAgentMap)
    const isSubagentToolCall = data.toolCallAgentMap?.has(item.call_id) || 
                               (data.subagentToolResults && data.subagentToolResults.has(item.call_id));
    
    if (isSubagentToolCall) {
      getEventSystem().info(EventCategory.SESSION, 
        `🔒 [Subagent] Routing tool output to event bus: ${item.call_id}`
      );
      
      // Route to event bus (will deliver to correct agent subscriber)
      const { ToolResultHandler } = await import('../../lib/tools/tool-result-handler');
      ToolResultHandler.handleClientToolResult(item, data);
      
      // Also maintain backward compatibility with subagentToolResults Map
      // (for deprecated polling-based code)
      if (data.subagentToolResults) {
        let parsedResult: any;
        try {
          parsedResult = item.output ? JSON.parse(item.output) : {};
        } catch {
          parsedResult = item.output || '';
        }
        data.subagentToolResults.set(item.call_id, parsedResult);
      }
      
      // CRITICAL: Track this tool call ID to ignore the next response.create from client
      // The OpenAI Agents SDK automatically sends response.create after function_call_output
      // In subagent mode, we don't want this to trigger a new response - the subagent handles continuation
      if (!data.pendingSubagentToolOutputs) {
        data.pendingSubagentToolOutputs = new Set();
      }
      data.pendingSubagentToolOutputs.add(item.call_id);
      getEventSystem().info(EventCategory.SESSION, 
        `🔒 [Subagent] Added tool call ${item.call_id} to pendingSubagentToolOutputs (total: ${data.pendingSubagentToolOutputs.size})`
      );
      
      // Send confirmation to client (they expect this)
      sendConversationItemCreated(ws, item);
      
      // DO NOT add to conversation history - subagent is a blackbox
      return;
    }
    
    // Regular (non-subagent) tool output - process normally
    const matchingCall = data.conversationHistory.find(
      h => h.type === 'function_call' && h.call_id === item.call_id
    );
    if (matchingCall) {
      item.name = matchingCall.name; // Store tool name for later formatting
      getEventSystem().info(EventCategory.SESSION, `🔧 Tool output received for ${matchingCall.name} (call_id: ${item.call_id})`);
      // Check if it's an error and log full JSON with NO TRUNCATION
      if (item.output?.includes('error occurred') || item.output?.includes('Error:')) {
        getEventSystem().error(EventCategory.SESSION, `⚠️  Tool execution error - FULL UNTRUNCATED DETAILS:`);
        getEventSystem().error(EventCategory.SESSION, `📤 Original tool call (COMPLETE):`);
        getEventSystem().error(EventCategory.SESSION, JSON.stringify(matchingCall, null, 2));
        getEventSystem().error(EventCategory.SESSION, `📤 Raw arguments string:`, matchingCall.arguments);
        getEventSystem().error(EventCategory.SESSION, `📥 Tool output (error - COMPLETE):`);
        getEventSystem().error(EventCategory.SESSION, JSON.stringify(item, null, 2));
        getEventSystem().error(EventCategory.SESSION, `📥 Raw output string:`, item.output);
      }
    } else {
      getEventSystem().warn(EventCategory.SESSION, `⚠️  No matching function_call found for call_id: ${item.call_id}`);
      getEventSystem().warn(EventCategory.SESSION, `📥 Orphaned tool output (COMPLETE):`);
      getEventSystem().warn(EventCategory.SESSION, JSON.stringify(item, null, 2));
      getEventSystem().warn(EventCategory.SESSION, `📥 Raw output:`, item.output);
      
      // Create a dummy function_call to maintain conversation consistency
      // This prevents Mistral "Not the same number of function calls and responses" error
      const dummyCall: ConversationItem = {
        id: generateItemId(),
        type: 'function_call',
        status: 'completed',
        role: 'assistant',
        name: item.name || 'unknown_tool',
        call_id: item.call_id,
        arguments: JSON.stringify({}), // Use empty object since we don't have original args
      };
      
      // Insert dummy call into history before output
      data.conversationHistory.push(dummyCall);
      getEventSystem().warn(EventCategory.SESSION, `🔧 Created dummy function_call for orphaned output: ${item.call_id}`);
    }
  }
  
  // Add to history (only for non-subagent items)
  data.conversationHistory.push(item);
  
  // Send confirmation
  sendConversationItemCreated(ws, item);
  
  getEventSystem().info(EventCategory.SESSION, `📝 Added conversation item: type=${item.type}, role=${item.role || 'N/A'}`);
  
  // Don't auto-trigger response for function_call_output - client will send response.create if needed
  // If it's a user message, trigger response
  if (item.role === 'user') {
    await generateResponse(ws);
  }
}

/**
 * Handle conversation.item.retrieve event
 * 
 * OpenAI Agents SDK sends this to request a specific conversation item,
 * typically after transcription completion or item truncation.
 */
export async function handleConversationItemRetrieve(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const itemId = event.item_id;
  
  if (!itemId) {
    sendError(ws, 'invalid_request_error', 'Missing item_id in conversation.item.retrieve event');
    return;
  }
  
  // Find the item in conversation history
  const item = data.conversationHistory.find(item => item.id === itemId);
  
  if (!item) {
    sendError(ws, 'invalid_request_error', `Conversation item '${itemId}' not found`);
    return;
  }
  
  // Send the retrieved item back to client
  sendConversationItemRetrieved(ws, item);
}

/**
 * Handle conversation.item.truncate event
 * 
 * Sent when the user interrupts the assistant. Truncates the assistant's
 * response at the specified audio position.
 */
export async function handleConversationItemTruncate(ws: ServerWebSocket<SessionData>, event: any): Promise<void> {
  const data = ws.data;
  const itemId = event.item_id;
  const contentIndex = event.content_index ?? 0;
  const audioEndMs = event.audio_end_ms ?? 0;
  
  getEventSystem().info(EventCategory.SESSION, `✂️  Truncating item ${itemId} at content_index=${contentIndex}, audio_end_ms=${audioEndMs}`);
  
  // Find the item in conversation history
  const item = data.conversationHistory.find(item => item.id === itemId);
  
  if (!item) {
    getEventSystem().warn(EventCategory.SESSION, `⚠️  Item ${itemId} not found for truncation`);
    return;
  }
  
  // Mark item as incomplete if it was in progress
  if (item.status === 'in_progress') {
    item.status = 'incomplete';
  }
  
  // Send confirmation
  sendConversationItemTruncated(ws, itemId, contentIndex, audioEndMs);
  
  getEventSystem().info(EventCategory.SESSION, `✅ Item truncated: ${itemId}`);
}

/**
 * Handle initial greeting
 * Triggers AI to introduce itself when session starts
 * Exported for use in server.ts during session initialization
 */
export async function handleInitialGreeting(ws: ServerWebSocket<SessionData>): Promise<void> {
  const data = ws.data;
  const itemId = generateItemId();
  
  getEventSystem().info(EventCategory.SESSION, '🎙️ [Initial Greeting] Triggering AI introduction');
  
  // Create system message with greeting prompt
  const greetingItem: ConversationItem = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'system',
    content: [{
      type: 'input_text',
      text: data.config.initial_greeting_prompt || 'Please introduce yourself to the user.',
    }],
  };
  
  // Add to history
  data.conversationHistory.push(greetingItem);
  
  // Send conversation item created
  sendConversationItemCreated(ws, greetingItem);
  
  getEventSystem().info(EventCategory.SESSION, '🎙️ [Initial Greeting] Generating AI response...');
  
  // Trigger AI response
  await generateResponse(ws);
}
