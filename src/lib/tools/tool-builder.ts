/**
 * Tool Builder - Centralized tool construction service
 * 
 * This module provides a single source of truth for building tools for agents.
 * It makes tool categories explicit (server vs client) and eliminates the need
 * for registry lookups during tool routing.
 * 
 * Key Features:
 * - Explicit tool categories (serverTools vs clientTools)
 * - Single function to build all tool types
 * - Clear separation between main agent and subagent modes
 * - No registry poisoning (client tools never registered as server tools)
 */

import type { ServerToolContext } from '../server-tool-registry';
import { serverToolRegistry } from '../server-tool-registry';
import { convertSessionToolsToProxyTools } from '../client-tool-proxy';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Explicit tool set with separated categories
 * 
 * This makes it clear at every point what type of tool you have,
 * eliminating the need for registry lookups.
 */
export interface ToolSet {
  /** Server tools (speak, askSubagent) - executed server-side */
  serverTools: Record<string, any>;
  /** Client tools (get_weather, etc.) - forwarded to client */
  clientTools: Record<string, any>;
}

/**
 * Build tools for main agent
 * 
 * In normal mode: Returns all client tools (as proxy) + server tools
 * In subagent mode: Returns only askSubagent tool
 * 
 * @param sessionTools - Client tool definitions from session.update
 * @param context - Server tool context
 * @param mode - 'main-agent' or 'subagent'
 * @returns Tool set with explicit categories
 */
export function buildToolsForAgent(
  sessionTools: any[],
  context: ServerToolContext,
  mode: 'main-agent' | 'subagent'
): ToolSet {
  getEventSystem().info(EventCategory.SESSION, 
    `🔧 [ToolBuilder] Building tools for ${mode}. Session tools: ${sessionTools.map(t => t.name).join(', ')}`
  );
  
  if (mode === 'subagent') {
    // Subagent mode: Main agent ONLY sees askSubagent
    const mainAgentTools = serverToolRegistry.getMainAgentTools(context);
    
    getEventSystem().info(EventCategory.SESSION,
      `🔧 [ToolBuilder] Subagent mode - Main agent tools: ${Object.keys(mainAgentTools).join(', ')}`
    );
    
    return {
      serverTools: mainAgentTools,
      clientTools: {}, // Main agent doesn't see client tools in subagent mode
    };
  } else {
    // Normal mode: All tools available
    // Filter out server tools from session tools
    const clientToolsOnly = sessionTools.filter(tool => {
      const isServer = serverToolRegistry.isServerTool(tool.name, context);
      if (isServer) {
        getEventSystem().info(EventCategory.SESSION,
          `🚫 [ToolBuilder] Filtering out server tool: ${tool.name}`
        );
      }
      return !isServer;
    });
    
    // Convert client tools to proxy tools (without execute functions)
    const clientProxyTools = convertSessionToolsToProxyTools(clientToolsOnly, context);
    
    // Get server tools with execute functions
    const serverTools = serverToolRegistry.getServerToolsForAgent(context);
    
    getEventSystem().info(EventCategory.SESSION,
      `🔧 [ToolBuilder] Normal mode - Client tools: ${Object.keys(clientProxyTools).join(', ')}, ` +
      `Server tools: ${Object.keys(serverTools).join(', ')}`
    );
    
    return {
      serverTools,
      clientTools: clientProxyTools,
    };
  }
}

/**
 * Build client tools for subagent
 * 
 * Subagent ONLY sees client tools (with execute functions that forward to client).
 * Server tools (askSubagent, speak) are NOT available to subagent.
 * 
 * By default, subagent receives ALL client tools. The requestedTools parameter
 * can be used to filter to specific tools if needed (rare use case).
 * 
 * @param sessionTools - Client tool definitions from session.update
 * @param context - Server tool context
 * @param requestedTools - Optional filter for specific tools (rarely used - subagent typically gets all tools)
 * @returns Client tools ONLY (with execute functions)
 */
export function buildClientToolsForSubagent(
  sessionTools: any[],
  context: ServerToolContext,
  requestedTools?: string[]
): Record<string, any> {
  getEventSystem().info(EventCategory.SESSION,
    `🔧 [ToolBuilder] Building client tools for subagent. Session tools: ${sessionTools.map(t => t.name).join(', ')}`
  );
  
  // CRITICAL: Filter out ALL server tools from session tools
  // Subagent should ONLY see client tools, never server tools
  const clientToolsOnly = sessionTools.filter(tool => {
    const isServer = serverToolRegistry.isServerTool(tool.name, context);
    if (isServer) {
      getEventSystem().info(EventCategory.SESSION,
        `🚫 [ToolBuilder] Filtering out server tool: ${tool.name}`
      );
    }
    return !isServer;
  });
  
  getEventSystem().info(EventCategory.SESSION,
    `🔧 [ToolBuilder] ${clientToolsOnly.length} client tools identified after filtering server tools`
  );
  
  // Assertion: Warn if all tools were filtered
  if (clientToolsOnly.length === 0 && sessionTools.length > 0) {
    getEventSystem().warn(EventCategory.SESSION,
      `⚠️ [ToolBuilder] All session tools were filtered as server tools! ` +
      `This likely indicates a bug. Session tools: ${sessionTools.map(t => t.name).join(', ')}`
    );
  }
  
  // Convert client tools to proxy tools first (to get Zod schemas)
  const proxyTools = convertSessionToolsToProxyTools(clientToolsOnly, context);
  
  // Wrap client tools with execute functions that forward to client and wait for results
  // CRITICAL: Do NOT register these as server tools! Just create tools with execute functions.
  const clientToolsWithExecute: Record<string, any> = {};
  for (const [toolName, proxyTool] of Object.entries(proxyTools)) {
    // Create a new tool with execute function that forwards to client
    // CRITICAL: tool() function requires name, description, and inputSchema (not parameters)
    const { tool } = require('ai');
    const toolWithExecute = tool({
      name: toolName, // Explicitly set name (required by AI SDK)
      description: (proxyTool as any).description || `Tool: ${toolName}`,
      inputSchema: (proxyTool as any).inputSchema || (proxyTool as any).parameters,
      execute: async (args: Record<string, any>) => {
        getEventSystem().info(EventCategory.SESSION,
          `🚀 [ToolBuilder] Client tool execute function called for: ${toolName}`
        );
        // Forward tool call to client and wait for result
        return await executeClientToolForSubagent(toolName, args, context);
      },
    });

    clientToolsWithExecute[toolName] = toolWithExecute;
    getEventSystem().info(EventCategory.SESSION,
      `✅ [ToolBuilder] Created client tool with execute: ${toolName}`
    );
  }
  
  // Filter to requested tools if specified
  if (requestedTools && Array.isArray(requestedTools) && requestedTools.length > 0) {
    const filtered = Object.fromEntries(
      Object.entries(clientToolsWithExecute).filter(([name]) => 
        requestedTools.includes(name)
      )
    );
    
    getEventSystem().info(EventCategory.SESSION,
      `🔧 [ToolBuilder] Filtered to requested tools: ${Object.keys(filtered).join(', ')}`
    );
    
    return filtered;
  }
  
  getEventSystem().info(EventCategory.SESSION,
    `🔧 [ToolBuilder] Returning ${Object.keys(clientToolsWithExecute).length} client tools: ` +
    `${Object.keys(clientToolsWithExecute).join(', ')}`
  );
  
  return clientToolsWithExecute;
}

/**
 * Execute a client tool for subagent by forwarding to client and waiting for result
 * 
 * Uses event bus for result waiting (no polling).
 * 
 * @param toolName - Name of the tool
 * @param args - Tool arguments
 * @param context - Server tool context
 * @returns Tool result from client
 */
async function executeClientToolForSubagent(
  toolName: string,
  args: Record<string, any>,
  context: ServerToolContext
): Promise<any> {
  const { ws, sessionData } = context;
  const { generateItemId, generateEventId } = await import('../protocol');
  const { sendOutputItemAdded } = await import('../../session/utils/event-sender');
  const { getEventSystem, EventCategory } = await import('../../events');
  const { ToolCallEmitter } = await import('./tool-call-emitter');
  const { AgentEventSubscriber } = await import('./agent-event-subscriber');
  
  // Generate agent ID for this subagent execution
  // Use subagentId from sessionData if available, otherwise generate one
  const agentId = sessionData.subagentId || `subagent_${generateEventId().substring(0, 36)}`;
  sessionData.subagentId = agentId;
  
  // Create event subscriber for this agent (reuse if exists and matches, create if not)
  // Store subscriber in sessionData to reuse across multiple tool calls
  // CRITICAL: Don't cleanup subscribers that are still waiting for results
  let subscriber = sessionData.subagentEventSubscriber;
  
  // Ensure subscriber exists and matches current agentId
  if (!subscriber || subscriber.getAgentId() !== agentId) {
    // Only cleanup old subscriber if it has no pending results
    if (subscriber) {
      const pendingCount = subscriber.getPendingCount();
      if (pendingCount > 0) {
        getEventSystem().warn(EventCategory.SESSION,
          `⚠️ [ToolBuilder] Cannot cleanup subscriber with ${pendingCount} pending tool calls. Waiting for completion...`
        );
        // Don't cleanup - let it finish naturally
        // The old subscriber will be cleaned up when askSubagent completes
      } else {
        // Safe to cleanup - no pending requests
        subscriber.cleanup();
      }
    }
    
    // Only create new subscriber if we don't have one matching this agentId
    if (!subscriber || subscriber.getAgentId() !== agentId) {
      subscriber = new AgentEventSubscriber(agentId);
      sessionData.subagentEventSubscriber = subscriber;
    }
  }
  
  // CRITICAL: Ensure subscriber exists BEFORE emitting tool call
  // This prevents race conditions where tool call is emitted but subscriber doesn't exist yet
  if (!subscriber || subscriber.getAgentId() !== agentId) {
    getEventSystem().error(EventCategory.SESSION,
      `❌ [ToolBuilder] Subscriber mismatch! Expected: ${agentId}, Got: ${subscriber?.getAgentId() || 'none'}`
    );
    throw new Error(`Subscriber not properly initialized for agent: ${agentId}`);
  }
  
  // Initialize tool call agent mapping if needed
  if (!sessionData.toolCallAgentMap) {
    sessionData.toolCallAgentMap = new Map();
  }
  
  // Generate tool call ID (must match format expected by client)
  const toolCallId = `fc_event_${generateEventId().substring(0, 36)}`;
  
  // Track agentId with toolCallId BEFORE emitting (ensures routing works)
  sessionData.toolCallAgentMap.set(toolCallId, agentId);
  
  // Emit tool call event (subscriber is guaranteed to exist)
  ToolCallEmitter.emitToolCall(agentId, toolName, args, toolCallId);
  
  getEventSystem().info(EventCategory.SESSION,
    `🔧 [ToolBuilder] Execute function called for: ${toolName} (${toolCallId}, agent: ${agentId})`
  );
  getEventSystem().info(EventCategory.SESSION,
    `🔧 [ToolBuilder] Tool args: ${JSON.stringify(args)}`
  );
  
  // Create function_call item (for sending to client only)
  // CRITICAL: Do NOT add to conversation history - subagent is a blackbox
  const functionCallItem = {
    id: generateItemId(),
    type: 'function_call' as const,
    status: 'completed' as const,
    role: 'assistant' as const,
    name: toolName,
    call_id: toolCallId,
    // CRITICAL: arguments must be a string, never undefined
    arguments: args !== undefined ? JSON.stringify(args) : '{}',
  };
  
  // Send to client
  getEventSystem().info(EventCategory.SESSION,
    `📤 [ToolBuilder] Sending tool call to client: ${toolName} (${toolCallId})`
  );
  sendOutputItemAdded(ws, context.responseId, 1, functionCallItem);
  
  try {
    // Wait for result via event bus (no polling!)
    getEventSystem().info(EventCategory.SESSION,
      `⏳ [ToolBuilder] Waiting for client tool result via event bus: ${toolCallId}`
    );
    const result = await subscriber.waitForResult(toolCallId, 30000);
    
    // Clean up mapping
    sessionData.toolCallAgentMap.delete(toolCallId);
    
    getEventSystem().info(EventCategory.SESSION,
      `✅ [ToolBuilder] Received tool result: ${toolName} (${toolCallId}) - ` +
      `${JSON.stringify(result).substring(0, 100)}`
    );
    
    return result;
  } catch (error) {
    // Clean up mapping on error
    sessionData.toolCallAgentMap.delete(toolCallId);
    
    getEventSystem().error(EventCategory.SESSION,
      `❌ [ToolBuilder] Tool execution failed: ${toolName} (${toolCallId})`,
      error instanceof Error ? error : new Error(String(error))
    );
    
    throw error;
  }
}

/**
 * @deprecated This function is no longer used. Tool results are now handled via event bus.
 * Kept for backward compatibility but will be removed in a future version.
 * 
 * Wait for client tool result (polling-based - DEPRECATED)
 * 
 * @param toolCallId - Tool call ID to wait for
 * @param sessionData - Session data
 * @param ws - WebSocket connection
 * @returns Tool result
 */
async function waitForClientToolResult(
  toolCallId: string,
  sessionData: import('../../session/types').SessionData,
  ws: import('bun').ServerWebSocket<import('../../session/types').SessionData>
): Promise<any> {
  const { getEventSystem, EventCategory } = await import('../../events');
  
  getEventSystem().warn(EventCategory.SESSION,
    `⚠️ [ToolBuilder] Using deprecated polling-based waitForClientToolResult. Use event bus instead.`
  );
  
  // Initialize subagent tool results tracking if needed
  if (!sessionData.subagentToolResults) {
    sessionData.subagentToolResults = new Map();
  }
  
  // Create a promise that resolves when we receive the tool result
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      getEventSystem().error(EventCategory.SESSION,
        `❌ [ToolBuilder] Timeout waiting for tool result: ${toolCallId}`
      );
      // Clean up tracking
      sessionData.subagentToolResults?.delete(toolCallId);
      reject(new Error(`Timeout waiting for tool result: ${toolCallId}`));
    }, 30000); // 30 second timeout
    
    // Check if result already exists in subagent tracking (not conversation history)
    const existingResult = sessionData.subagentToolResults?.get(toolCallId);
    
    if (existingResult !== null && existingResult !== undefined) {
      clearTimeout(timeout);
      getEventSystem().info(EventCategory.SESSION,
        `✅ [ToolBuilder] Tool result found in subagent tracking: ${toolCallId}`
      );
      // Clean up tracking
      sessionData.subagentToolResults?.delete(toolCallId);
      resolve(existingResult);
      return;
    }
    
    // Set up a one-time listener for the tool result
    // We'll check subagent tracking periodically (NOT conversation history)
    const checkInterval = setInterval(() => {
      const result = sessionData.subagentToolResults?.get(toolCallId);
      
      if (result !== null && result !== undefined) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        getEventSystem().info(EventCategory.SESSION,
          `✅ [ToolBuilder] Tool result received: ${toolCallId}`
        );
        
        // Clean up tracking
        sessionData.subagentToolResults?.delete(toolCallId);
        
        // Result is already parsed (stored as-is from conversation handler)
        resolve(result);
      }
    }, 100); // Check every 100ms
  });
}
