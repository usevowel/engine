/**
 * Tool Event Bus
 * 
 * Central event bus for routing tool calls and results to the correct agent using agentId.
 * Uses RxJS Subject for reactive event handling.
 * 
 * This eliminates polling, race conditions, and shared mutable state issues.
 */

import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

/**
 * Tool event types
 */
export enum ToolEventType {
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  TOOL_ERROR = 'tool_error',
  TOOL_CANCELLED = 'tool_cancelled',
}

/**
 * Tool event structure
 */
export interface ToolEvent {
  type: ToolEventType;
  agentId: string;           // Which agent this event is for
  toolCallId: string;       // Unique ID for this tool call
  toolName?: string;
  args?: Record<string, any>;
  result?: any;
  error?: Error;
  timestamp: number;
}

/**
 * Tool Event Bus
 * 
 * Routes tool calls and results to the correct agent using agentId.
 * Uses RxJS Subject for reactive event handling.
 */
export class ToolEventBus {
  private eventSubject = new Subject<ToolEvent>();
  
  /**
   * Emit a tool event
   * 
   * @param event - Tool event to emit
   */
  emit(event: ToolEvent): void {
    this.eventSubject.next(event);
  }
  
  /**
   * Subscribe to events for a specific agent
   * 
   * @param agentId - Agent ID to subscribe to
   * @returns Observable stream of events for this agent
   */
  subscribe(agentId: string): Observable<ToolEvent> {
    return this.eventSubject.pipe(
      filter(event => event.agentId === agentId)
    );
  }
  
  /**
   * Subscribe to all events (for debugging/admin)
   * 
   * @returns Observable stream of all events
   */
  subscribeAll(): Observable<ToolEvent> {
    return this.eventSubject.asObservable();
  }
  
  /**
   * Cleanup: Complete the subject
   */
  cleanup(): void {
    this.eventSubject.complete();
  }
}

/**
 * Global singleton instance
 */
export const toolEventBus = new ToolEventBus();
