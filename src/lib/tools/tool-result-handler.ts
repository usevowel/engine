/**
 * Tool Result Handler
 * 
 * Receives tool results from client and routes them to the correct agent via event bus.
 */

import { toolEventBus, ToolEvent, ToolEventType } from './tool-event-bus';
import type { SessionData } from '../../session/types';
import type { ConversationItem } from '../protocol';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Tool Result Handler
 * 
 * Receives tool results from client and routes them to the correct agent.
 */
export class ToolResultHandler {
  /**
   * Handle tool result from client
   * 
   * Called when client sends conversation.item.create with function_call_output.
   * Routes the result to the correct agent via event bus.
   * 
   * @param item - Conversation item with function_call_output
   * @param sessionData - Session data
   */
  static handleClientToolResult(
    item: ConversationItem,
    sessionData: SessionData
  ): void {
    if (item.type !== 'function_call_output' || !item.call_id) {
      return;
    }

    // Find which agent this tool call belongs to
    const agentId = this.getAgentIdForToolCall(item.call_id, sessionData);
    
    if (!agentId) {
      // Tool call not found - might be from main agent (normal mode) or invalid
      // In normal mode, tool results go directly to conversation history
      getEventSystem().debug(EventCategory.SESSION,
        `🔍 [ToolResultHandler] No agent ID found for tool call: ${item.call_id} (likely main agent in normal mode)`
      );
      return;
    }

    getEventSystem().info(EventCategory.SESSION,
      `📥 [ToolResultHandler] Routing tool result to agent: ${agentId} (callId: ${item.call_id})`
    );

    // Parse result
    let parsedResult: any;
    try {
      parsedResult = item.output ? JSON.parse(item.output) : {};
    } catch {
      parsedResult = item.output || '';
    }

    // Emit result event
    const event: ToolEvent = {
      type: ToolEventType.TOOL_RESULT,
      agentId,
      toolCallId: item.call_id,
      result: parsedResult,
      timestamp: Date.now(),
    };

    toolEventBus.emit(event);
  }

  /**
   * Handle tool error from client
   * 
   * @param toolCallId - Tool call ID that failed
   * @param error - Error that occurred
   * @param sessionData - Session data
   */
  static handleToolError(
    toolCallId: string,
    error: Error,
    sessionData: SessionData
  ): void {
    const agentId = this.getAgentIdForToolCall(toolCallId, sessionData);
    
    if (!agentId) {
      getEventSystem().debug(EventCategory.SESSION,
        `🔍 [ToolResultHandler] No agent ID found for tool error: ${toolCallId}`
      );
      return;
    }

    getEventSystem().error(EventCategory.SESSION,
      `❌ [ToolResultHandler] Routing tool error to agent: ${agentId} (callId: ${toolCallId})`,
      error
    );

    const event: ToolEvent = {
      type: ToolEventType.TOOL_ERROR,
      agentId,
      toolCallId,
      error,
      timestamp: Date.now(),
    };

    toolEventBus.emit(event);
  }

  /**
   * Get agent ID for a tool call
   * 
   * We track which agent made which tool call using toolCallAgentMap.
   * 
   * @param toolCallId - Tool call ID to look up
   * @param sessionData - Session data
   * @returns Agent ID or null if not found
   */
  private static getAgentIdForToolCall(
    toolCallId: string,
    sessionData: SessionData
  ): string | null {
    // Check toolCallAgentMap (set when tool call is made)
    if (sessionData.toolCallAgentMap) {
      const agentId = sessionData.toolCallAgentMap.get(toolCallId);
      if (agentId) {
        return agentId;
      }
    }
    
    // Fallback: Check subagent tool results (for backward compatibility)
    // This handles cases where toolCallAgentMap might not be set yet
    if (sessionData.subagentToolResults?.has(toolCallId)) {
      // Use subagent ID from session data or generate one
      return sessionData.subagentId || 'subagent';
    }
    
    // No agent ID found - likely main agent in normal mode
    // In normal mode, tool results go directly to conversation history
    return null;
  }
}
