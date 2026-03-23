/**
 * Agent Event Subscriber
 * 
 * Manages event subscription for an agent and provides Promise-based
 * API for waiting for tool results.
 * 
 * This eliminates polling and provides proper cleanup.
 */

import { toolEventBus, ToolEvent, ToolEventType } from './tool-event-bus';
import { Subscription } from 'rxjs';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Agent Event Subscriber
 * 
 * Subscribes to tool events for a specific agent and provides
 * Promise-based API for waiting for tool results.
 */
export class AgentEventSubscriber {
  private agentId: string;
  private subscription: Subscription;
  private pendingResults = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  /**
   * Create a new agent event subscriber
   * 
   * @param agentId - Unique agent ID for this subscriber
   */
  constructor(agentId: string) {
    this.agentId = agentId;
    
    getEventSystem().info(EventCategory.SESSION,
      `🔌 [AgentEventSubscriber] Subscribing agent: ${agentId}`
    );
    
    // Subscribe to events for this agent
    this.subscription = toolEventBus.subscribe(agentId).subscribe(
      (event: ToolEvent) => {
        this.handleEvent(event);
      }
    );
  }

  /**
   * Wait for a tool result
   * 
   * @param toolCallId - Tool call ID to wait for
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns Promise that resolves with tool result
   */
  waitForResult(
    toolCallId: string,
    timeoutMs: number = 30000
  ): Promise<any> {
    getEventSystem().info(EventCategory.SESSION,
      `⏳ [AgentEventSubscriber] Waiting for result: ${toolCallId} (agent: ${this.agentId}, timeout: ${timeoutMs}ms)`
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        getEventSystem().error(EventCategory.SESSION,
          `❌ [AgentEventSubscriber] Timeout waiting for tool result: ${toolCallId} (agent: ${this.agentId})`
        );
        this.pendingResults.delete(toolCallId);
        reject(new Error(`Timeout waiting for tool result: ${toolCallId}`));
      }, timeoutMs);

      this.pendingResults.set(toolCallId, { resolve, reject, timeout });
    });
  }

  /**
   * Handle incoming events
   * 
   * @param event - Tool event received
   */
  private handleEvent(event: ToolEvent): void {
    const pending = this.pendingResults.get(event.toolCallId);
    
    if (!pending) {
      // No pending request for this tool call ID
      getEventSystem().debug(EventCategory.SESSION,
        `🔍 [AgentEventSubscriber] Received event for unknown tool call: ${event.toolCallId} (agent: ${this.agentId})`
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingResults.delete(event.toolCallId);

    switch (event.type) {
      case ToolEventType.TOOL_RESULT:
        getEventSystem().info(EventCategory.SESSION,
          `✅ [AgentEventSubscriber] Tool result received: ${event.toolCallId} (agent: ${this.agentId})`
        );
        pending.resolve(event.result);
        break;
        
      case ToolEventType.TOOL_ERROR:
        getEventSystem().error(EventCategory.SESSION,
          `❌ [AgentEventSubscriber] Tool error received: ${event.toolCallId} (agent: ${this.agentId})`,
          event.error
        );
        pending.reject(event.error || new Error('Tool execution failed'));
        break;
        
      case ToolEventType.TOOL_CANCELLED:
        getEventSystem().info(EventCategory.SESSION,
          `🚫 [AgentEventSubscriber] Tool cancelled: ${event.toolCallId} (agent: ${this.agentId})`
        );
        pending.reject(new Error('Tool call cancelled'));
        break;
        
      default:
        getEventSystem().warn(EventCategory.SESSION,
          `⚠️ [AgentEventSubscriber] Unknown event type: ${event.type} (agent: ${this.agentId})`
        );
    }
  }

  /**
   * Cancel a pending tool call
   * 
   * @param toolCallId - Tool call ID to cancel
   */
  cancel(toolCallId: string): void {
    const pending = this.pendingResults.get(toolCallId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResults.delete(toolCallId);
      pending.reject(new Error('Tool call cancelled'));
      
      getEventSystem().info(EventCategory.SESSION,
        `🚫 [AgentEventSubscriber] Cancelled tool call: ${toolCallId} (agent: ${this.agentId})`
      );
    }
  }

  /**
   * Cancel all pending tool calls
   */
  cancelAll(): void {
    for (const [toolCallId, pending] of this.pendingResults.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Agent subscriber cleaned up'));
    }
    this.pendingResults.clear();
    
    getEventSystem().info(EventCategory.SESSION,
      `🚫 [AgentEventSubscriber] Cancelled all pending tool calls (agent: ${this.agentId})`
    );
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Get number of pending results
   */
  getPendingCount(): number {
    return this.pendingResults.size;
  }

  /**
   * Cleanup: Cancel all pending requests and unsubscribe
   */
  cleanup(): void {
    getEventSystem().info(EventCategory.SESSION,
      `🧹 [AgentEventSubscriber] Cleaning up agent subscriber: ${this.agentId}`
    );

    // Cancel all pending requests
    this.cancelAll();

    // Unsubscribe from events
    this.subscription.unsubscribe();
  }
}
