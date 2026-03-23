/**
 * Server Tool Registry
 * 
 * Central registry for managing server-side tool execution.
 * 
 * Server tools are FULLY EXEMPTED from:
 * - Client tool schema conversion
 * - Client tool forwarding mechanism
 * - Client tool result handling
 * 
 * Server provides responses directly via executor functions.
 */

import { ServerWebSocket } from 'bun';
import { tool } from 'ai';
import { z } from 'zod';
import type { SessionData, ResponseLatencyMetrics } from '../session/types';
import { getEventSystem, EventCategory } from '../events';
import { convertJsonSchemaToZod } from './json-schema-to-zod';

/**
 * Context passed to server tool executors
 */
export interface ServerToolContext {
  /** WebSocket connection for sending events */
  ws: ServerWebSocket<SessionData>;
  /** Session data (providers, config, history, etc.) */
  sessionData: SessionData;
  /** Current response ID */
  responseId: string;
  /** Current item ID */
  itemId: string;
  /** Voice configuration */
  voice: string;
  /** Speaking rate */
  speakingRate: number;
  /** Latency tracking */
  latency: {
    responseStart: number;
    asrStart: number;
    asrEnd: number;
    llmStreamStart: number;
    llmFirstToken: number;
    llmStreamEnd: number;
    llmTokenCount: number;
    firstAudioSent: number;
    ttsChunks: Array<{ text: string; start: number; end: number }>;
    responseEnd: number;
  };
}

/**
 * Server tool executor function signature
 */
export type ServerToolExecutor = (
  args: Record<string, any>,
  context: ServerToolContext
) => Promise<ServerToolResult>;

/**
 * Result from server tool execution
 */
export interface ServerToolResult {
  /** Success status */
  success: boolean;
  /** Result data (optional) */
  data?: any;
  /** Error message if failed */
  error?: string;
  /** Whether to add tool call to conversation history */
  addToHistory?: boolean;
}

/**
 * Server Tool Registry
 * 
 * Manages registration and execution of server-side tools.
 * Tools registered here are executed server-side instead of being
 * forwarded to clients.
 */
export class ServerToolRegistry {
  private tools = new Map<string, ServerToolExecutor>();
  private conditions = new Map<string, (context: ServerToolContext) => boolean>();
  private toolDefinitions = new Map<string, { description: string; parameters: any }>();

  /**
   * Register a server tool with an executor function
   * 
   * CRITICAL: Server tools registered here are FULLY EXEMPTED from:
   * - Client tool schema conversion
   * - Client tool forwarding mechanism
   * - Client tool result handling
   * 
   * Server provides responses directly via executor function.
   * 
   * @param name - Tool name (must match tool definition)
   * @param executor - Function that executes the tool
   * @param toolDef - Tool definition (description, parameters)
   * @param condition - Optional condition function (tool only available when condition returns true)
   */
  register(
    name: string,
    executor: ServerToolExecutor,
    toolDef: { description: string; parameters: any },
    condition?: (context: ServerToolContext) => boolean
  ): void {
    this.tools.set(name, executor);
    this.toolDefinitions.set(name, toolDef);
    if (condition) {
      this.conditions.set(name, condition);
    }
  }

  /**
   * Check if a tool is registered as a server tool
   * 
   * CRITICAL: Tools that return true here are EXEMPTED from client tool pipeline.
   * 
   * @param name - Tool name to check
   * @param context - Context for conditional tool checks
   * @returns True if tool should be executed server-side (and excluded from client tools)
   */
  isServerTool(name: string, context: ServerToolContext): boolean {
    if (!this.tools.has(name)) {
      return false;
    }
    
    // Check condition if present
    const condition = this.conditions.get(name);
    if (condition) {
      return condition(context);
    }
    
    return true;
  }

  /**
   * Execute a server tool
   * 
   * CRITICAL: This executes server-side and provides response directly.
   * No client forwarding or client result mechanism is involved.
   * 
   * @param name - Tool name
   * @param args - Tool arguments
   * @param context - Execution context
   * @returns Tool execution result
   */
  async execute(
    name: string,
    args: Record<string, any>,
    context: ServerToolContext
  ): Promise<ServerToolResult> {
    const executor = this.tools.get(name);
    if (!executor) {
      return {
        success: false,
        error: `Server tool ${name} not found`,
      };
    }
    
    return await executor(args, context);
  }

  /**
   * Get tool definition (for creating agent tools)
   * 
   * Used internally by getServerToolsForAgent().
   */
  getToolDefinition(name: string): { description: string; parameters: any } | undefined {
    return this.toolDefinitions.get(name);
  }
  
  /**
   * Get server tools for agent (with execute functions)
   * 
   * Returns all registered server tools that are available in the given context.
   * Tools are created with execute functions that delegate to the registry.
   * 
   * @param context - Context for conditional tool checks
   * @returns Record of server tools WITH execute functions
   */
  getServerToolsForAgent(context: ServerToolContext): Record<string, any> {
    const tools: Record<string, any> = {};
    
    getEventSystem().info(EventCategory.SESSION, `🔧 [ServerToolRegistry] getServerToolsForAgent: Checking ${this.toolDefinitions.size} registered tools`);
    
    for (const [toolName, toolDef] of this.toolDefinitions) {
      // Check if tool is available in current context (conditional registration)
      const isAvailable = this.isServerTool(toolName, context);
      getEventSystem().info(EventCategory.SESSION, `🔧 [ServerToolRegistry] Tool ${toolName}: isAvailable=${isAvailable}`);
      
      if (isAvailable) {
        // Create tool WITH execute function (delegates to registry)
        const toolWithExecute = this.createServerTool(toolName, toolDef, context);
        const hasExecute = typeof (toolWithExecute as any).execute === 'function';
        getEventSystem().info(EventCategory.SESSION, `🔧 [ServerToolRegistry] Created tool ${toolName}: hasExecute=${hasExecute}`);
        tools[toolName] = toolWithExecute;
      }
    }
    
    getEventSystem().info(EventCategory.SESSION, `🔧 [ServerToolRegistry] Returning ${Object.keys(tools).length} tools: ${Object.keys(tools).join(', ')}`);
    return tools;
  }
  
  /**
   * Create a server tool with execute function (internal helper)
   */
  private createServerTool(
    toolName: string,
    toolDef: { description: string; parameters: any },
    context: ServerToolContext
  ): any {
    const zodSchema = convertJsonSchemaToZod(toolDef.parameters);
    
    return tool({
      name: toolName,
      description: toolDef.description,
      inputSchema: zodSchema,
      execute: async (args: Record<string, any>) => {
        // Delegate to registry - server handles execution
        const result = await this.execute(toolName, args, context);
        if (!result.success) {
          throw new Error(result.error || `Tool ${toolName} execution failed`);
        }
        return result.data;
      },
    });
  }

  /**
   * Get all registered server tool names (for debugging/logging)
   */
  getRegisteredTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tools for main agent (subagent mode)
   * 
   * In subagent mode, main agent only sees askSubagent tool
   * 
   * @param context - Context for conditional tool checks
   * @returns Record with only askSubagent tool (or empty if not in subagent mode)
   */
  getMainAgentTools(context: ServerToolContext): Record<string, any> {
    // Dynamic import to avoid circular dependency
    const { isSubagentModeEnabled } = require('../config/env');
    
    if (!isSubagentModeEnabled(context.sessionData.runtimeConfig)) {
      return {}; // Normal mode: no server tools for main agent (handled separately)
    }
    
    // Return only askSubagent tool
    return {
      askSubagent: this.createAskSubagentTool(context),
    };
  }
  
  /**
   * Get tools for subagent
   * 
   * CRITICAL: Subagent ONLY sees client tools (proxy tools).
   * Server tools (askSubagent, speak, etc.) are NOT available to subagent.
   * 
   * Client tools are wrapped with execute functions that forward to client and wait for results.
   * 
   * IMPORTANT: This method does NOT register client tools as server tools.
   * Client tools are created with execute functions and returned directly.
   * The `isServerTool()` check only considers tools registered via `register()`.
   * 
   * @param sessionTools - Client tool definitions from session.update
   * @param context - Context for tool checks
   * @returns Client tools ONLY (with execute functions that forward to client)
   */
  getSubagentTools(
    sessionTools: any[],
    context: ServerToolContext
  ): Record<string, any> {
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] getSubagentTools called with ${sessionTools.length} session tools`);
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Session tools: ${sessionTools.map(t => t.name).join(', ')}`);
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Registered server tools: ${Array.from(this.tools.keys()).join(', ')}`);

    // CRITICAL: Filter out ALL server tools from session tools
    // Subagent should ONLY see client tools, never server tools
    // Server tools are: speak, askSubagent (registered in server-tools/index.ts)
    const clientToolsOnly = sessionTools.filter(tool => {
      const isServer = this.isServerTool(tool.name, context);
      if (isServer) {
        getEventSystem().info(EventCategory.SESSION, `🚫 [Subagent] Filtering out server tool: ${tool.name}`);
      }
      return !isServer;
    });
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] ${clientToolsOnly.length} client tools identified after filtering server tools`);

    // Convert client tools to proxy tools first (to get Zod schemas)
    const { convertSessionToolsToProxyTools } = require('./client-tool-proxy');
    const proxyTools = convertSessionToolsToProxyTools(clientToolsOnly, context);
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] ${Object.keys(proxyTools).length} proxy tools created`);

    // Wrap client tools with execute functions that forward to client and wait for results
    // CRITICAL: Do NOT register these as server tools! Just create tools with execute functions.
    const clientToolsWithExecute: Record<string, any> = {};
    for (const [toolName, proxyTool] of Object.entries(proxyTools)) {
      // Create a new tool with execute function that forwards to client
      const { tool } = require('ai');
      const toolWithExecute = tool({
        description: (proxyTool as any).description,
        parameters: (proxyTool as any).parameters || (proxyTool as any).inputSchema,
        execute: async (args: Record<string, any>) => {
          getEventSystem().info(EventCategory.SESSION, `🚀 [Subagent] Client tool execute function called for: ${toolName}`);
          // Forward tool call to client and wait for result
          return await this.executeClientToolForSubagent(toolName, args, context);
        },
      });

      clientToolsWithExecute[toolName] = toolWithExecute;
      getEventSystem().info(EventCategory.SESSION, `✅ [Subagent] Created client tool with execute: ${toolName}`);
    }

    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Returning ${Object.keys(clientToolsWithExecute).length} client tools: ${Object.keys(clientToolsWithExecute).join(', ')}`);
    
    // CRITICAL: Return ONLY client tools, NO server tools
    // Subagent should never see server tools like askSubagent or speak
    return clientToolsWithExecute;
  }
  
  /**
   * Convert Zod schema to JSON Schema (helper for temporary registration)
   */
  private zodToJsonSchema(zodSchema: any): any {
    // Simple conversion - in production, use a proper Zod-to-JSON-Schema converter
    // For now, return empty object as fallback
    try {
      if (zodSchema && typeof zodSchema.toJSON === 'function') {
        return zodSchema.toJSON();
      }
    } catch {
      // Fallback to empty object
    }
    return { type: 'object', properties: {} };
  }
  
  /**
   * Execute a client tool for subagent by forwarding to client and waiting for result
   * 
   * @param toolName - Name of the tool
   * @param args - Tool arguments
   * @param context - Server tool context
   * @returns Tool result from client
   */
  private async executeClientToolForSubagent(
    toolName: string,
    args: Record<string, any>,
    context: ServerToolContext
  ): Promise<any> {
    const { ws, sessionData } = context;
    const { generateItemId, generateEventId } = await import('./protocol');
    const { sendOutputItemAdded } = await import('../session/utils/event-sender');
    const { getEventSystem, EventCategory } = await import('../events');
    
    // Generate tool call ID
    const toolCallId = `fc_${generateEventId().substring(0, 36)}`;
    
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Execute function called for: ${toolName} (${toolCallId})`);
    getEventSystem().info(EventCategory.SESSION, `🔧 [Subagent] Tool args: ${JSON.stringify(args)}`);
    
    // Create function_call item
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
    
    // Add to conversation history
    sessionData.conversationHistory.push(functionCallItem);
    
    // Send to client
    getEventSystem().info(EventCategory.SESSION, `📤 [Subagent] Sending tool call to client: ${toolName} (${toolCallId})`);
    sendOutputItemAdded(ws, context.responseId, 1, functionCallItem);
    
    // Wait for client to send back result
    // The client will send conversation.item.create with function_call_output
    // We need to wait for that specific call_id
    getEventSystem().info(EventCategory.SESSION, `⏳ [Subagent] Waiting for client tool result: ${toolCallId}`);
    const result = await this.waitForClientToolResult(toolCallId, sessionData, ws);
    getEventSystem().info(EventCategory.SESSION, `✅ [Subagent] Received tool result: ${toolName} (${toolCallId}) - ${JSON.stringify(result).substring(0, 100)}`);
    
    return result;
  }
  
  /**
   * Wait for client tool result
   * 
   * @param toolCallId - Tool call ID to wait for
   * @param sessionData - Session data
   * @param ws - WebSocket connection
   * @returns Tool result
   */
  private async waitForClientToolResult(
    toolCallId: string,
    sessionData: SessionData,
    ws: ServerWebSocket<SessionData>
  ): Promise<any> {
    const { getEventSystem, EventCategory } = await import('../events');
    
    // Create a promise that resolves when we receive the tool result
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        getEventSystem().error(EventCategory.SESSION, `❌ [Subagent] Timeout waiting for tool result: ${toolCallId}`);
        reject(new Error(`Timeout waiting for tool result: ${toolCallId}`));
      }, 30000); // 30 second timeout
      
      // Check if result already exists in conversation history
      const existingResult = sessionData.conversationHistory.find(
        item => item.type === 'function_call_output' && item.call_id === toolCallId
      );
      
      if (existingResult) {
        clearTimeout(timeout);
        getEventSystem().info(EventCategory.SESSION, `✅ [Subagent] Tool result found in history: ${toolCallId}`);
        resolve(existingResult.output || '');
        return;
      }
      
      // Set up a one-time listener for the tool result
      // We'll check conversation history periodically
      const checkInterval = setInterval(() => {
        const result = sessionData.conversationHistory.find(
          item => item.type === 'function_call_output' && item.call_id === toolCallId
        );
        
        if (result) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          getEventSystem().info(EventCategory.SESSION, `✅ [Subagent] Tool result received: ${toolCallId}`);
          
          // Parse output if it's JSON
          try {
            const parsed = JSON.parse(result.output || '{}');
            resolve(parsed);
          } catch {
            resolve(result.output || '');
          }
        }
      }, 100); // Check every 100ms
    });
  }
  
  /**
   * Create askSubagent tool for main agent
   * 
   * Note: Executor is in separate file (`ask-subagent.ts`) for simplicity.
   */
  private createAskSubagentTool(context: ServerToolContext): any {
    const { tool } = require('ai');
    const { z } = require('zod');
    
    return tool({
      name: 'askSubagent',
      description: `Delegate tool execution to specialized subagent. Use this tool when you need to call other tools. The subagent will handle tool execution and return results.`,
      inputSchema: z.object({
        task: z.string().describe('Description of what tool(s) need to be executed'),
        tools: z.array(z.string()).optional().describe('Specific tool names to use (optional)'),
      }),
      execute: async (args: Record<string, any>) => {
        // Import executor from separate file
        const { executeAskSubagent } = await import('./server-tools/ask-subagent');
        const result = await executeAskSubagent(args, context);
        if (!result.success) {
          throw new Error(result.error || 'Subagent execution failed');
        }
        return result.data;
      },
    });
  }

  /**
   * Clear all registrations (for per-session registration)
   */
  clear(): void {
    this.tools.clear();
    this.conditions.clear();
    this.toolDefinitions.clear();
  }
}

/**
 * Global server tool registry instance
 */
export const serverToolRegistry = new ServerToolRegistry();
