/**
 * Tool Call Emitter
 * 
 * Emits tool call events to the event bus.
 */

import { toolEventBus, ToolEvent, ToolEventType } from './tool-event-bus';
import { generateEventId } from '../protocol';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Tool Call Emitter
 * 
 * Emits tool call events to the event bus.
 */
export class ToolCallEmitter {
  /**
   * Emit a tool call event
   * 
   * @param agentId - Agent ID making the tool call
   * @param toolName - Name of the tool
   * @param args - Tool arguments
   * @param toolCallId - Optional tool call ID (generated if not provided)
   * @returns Tool call ID
   */
  static emitToolCall(
    agentId: string,
    toolName: string,
    args: Record<string, any>,
    toolCallId?: string
  ): string {
    const callId = toolCallId || `fc_${generateEventId().substring(0, 36)}`;
    
    getEventSystem().info(EventCategory.SESSION,
      `📤 [ToolCallEmitter] Emitting tool call: ${toolName} (callId: ${callId}, agent: ${agentId})`
    );

    const event: ToolEvent = {
      type: ToolEventType.TOOL_CALL,
      agentId,
      toolCallId: callId,
      toolName,
      args,
      timestamp: Date.now(),
    };

    toolEventBus.emit(event);
    
    return callId;
  }

  /**
   * Emit a tool cancellation event
   * 
   * @param agentId - Agent ID cancelling the tool call
   * @param toolCallId - Tool call ID to cancel
   */
  static emitCancellation(
    agentId: string,
    toolCallId: string
  ): void {
    getEventSystem().info(EventCategory.SESSION,
      `🚫 [ToolCallEmitter] Emitting cancellation: ${toolCallId} (agent: ${agentId})`
    );

    const event: ToolEvent = {
      type: ToolEventType.TOOL_CANCELLED,
      agentId,
      toolCallId,
      timestamp: Date.now(),
    };

    toolEventBus.emit(event);
  }
}
