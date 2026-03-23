/**
 * Soundbird Agent Provider
 * 
 * Wrapper around Vercel AI SDK's Agent class (v5) that provides:
 * - Automatic context window management via prepareStep
 * - Automatic loop detection via stopWhen
 * - Integration with client-side tool proxy pattern
 * - Support for Groq and OpenRouter providers
 * 
 * Uses the real Agent class from AI SDK v5, not a custom wrapper.
 * The Agent handles multi-step tool reasoning automatically,
 * allowing the AI to chain multiple tool calls until the task is complete.
 */

import { Experimental_Agent as Agent, CoreTool, CoreMessage, stepCountIs, generateObject, NoSuchToolError } from 'ai';
import { getProvider, type SupportedProvider } from './providers/llm';
import { convertSessionToolsToProxyTools } from '../lib/client-tool-proxy';
import { cleanEllipsisFromMessages, truncateContextSimple } from './agents/utils/agentUtils';
import { AgentStreamOptions } from './agents/ILLMAgent';

import { getEventSystem, EventCategory } from '../events';
/**
 * Configuration for SoundbirdAgent
 */
export interface AgentConfig {
  provider: SupportedProvider;        // Provider from registry (auto-typed)
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxSteps?: number;                  // Max tool-calling steps (default: 3)
  maxContextMessages?: number;        // Max messages to keep (default: 15)
  openrouterSiteUrl?: string;         // OpenRouter referer
  openrouterAppName?: string;         // OpenRouter app name
  sessionId?: string;                 // Session identifier reserved for hosted instrumentation paths
}

/**
 * Soundbird Agent Wrapper
 * 
 * Wraps Vercel AI SDK's Agent class with:
 * - Automatic context truncation (keeps last N messages)
 * - Automatic loop detection (stops repetitive tool calls)
 * - Client-side tool proxy integration
 * - Provider abstraction (Groq/OpenRouter)
 * 
 * Example usage:
 * 
 * ```typescript
 * const agent = new SoundbirdAgent({
 *   provider: 'openrouter',
 *   apiKey: 'sk-or-...',
 *   model: 'anthropic/claude-3-5-sonnet',
 *   systemPrompt: 'You are a helpful voice assistant',
 *   maxSteps: 5,
 *   maxContextMessages: 15,
 * }, toolProxyManager);
 * 
 * const stream = await agent.stream({
 *   prompt: 'Navigate to products and add item 123 to cart',
 *   sessionTools: [navigateTool, addToCartTool],
 * });
 * 
 * for await (const part of stream) {
 *   // Agent automatically chains: navigate → addToCart → done
 *   getEventSystem().info(EventCategory.PROVIDER, part);
 * }
 * ```
 */
export class SoundbirdAgent {
  private config: AgentConfig;
  private agent: Agent;  // Real Vercel AI SDK Agent (v5)
  private tracedModel: any; // Reused for tool repair
  
  constructor(
    config: AgentConfig
  ) {
    this.config = config;
    
    const maxSteps = config.maxSteps || 3;
    const maxContextMessages = config.maxContextMessages || 15;
    
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Initializing Agent (AI SDK v5)`);
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Provider: ${config.provider}, Model: ${config.model}`);
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] MaxSteps: ${maxSteps}, MaxContextMessages: ${maxContextMessages}`);
    
    // Get provider from registry (replaces manual if/else logic)
    const llmClient = getProvider(config.provider, {
      apiKey: config.apiKey,
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName,
    });
    
    // Create the base model directly in OSS and reuse it for repair paths.
    const baseModel = llmClient(config.model);
    this.tracedModel = baseModel;
    
    // Initialize the real Agent class from AI SDK v5
    this.agent = new Agent({
      model: this.tracedModel,
      system: config.systemPrompt,
      
      // Stop condition: Use step count limit
      // Agent will stop after maxSteps steps
      stopWhen: stepCountIs(maxSteps),
      
      // Context management: Truncate to keep last N messages
      prepareStep: async ({ stepNumber, messages }) => {
        const messageCount = messages.length;
        
        let processedMessages = messages;
        
        if (messageCount > maxContextMessages) {
          getEventSystem().info(EventCategory.LLM, `🔄 [Agent Step ${stepNumber}] Context truncation: ${messageCount} → ${maxContextMessages} messages`);
          
          // Keep system prompt + last N-1 messages, repair orphaned tool pairs
          processedMessages = truncateContextSimple(messages, maxContextMessages, `[Agent Step ${stepNumber}]`);
        } else {
          getEventSystem().info(EventCategory.LLM, `📊 [Agent Step ${stepNumber}] Context size: ${messageCount} messages (within limit)`);
        }
        
        // Clean ellipsis (repeating dots) from message content
        processedMessages = cleanEllipsisFromMessages(processedMessages);
        
        return { messages: processedMessages };
      },
      
      // Tool call repair: Use structured outputs to fix malformed tool calls
      experimental_repairToolCall: async ({
        toolCall,
        tools,
        inputSchema,
        error,
      }: any) => {
        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Tool call repair triggered for: ${toolCall.toolName}`);
        getEventSystem().error(EventCategory.LLM, `🔧 [SoundbirdAgent] Error: ${error.message}`);
        
        // Don't attempt to fix invalid tool names
        if (NoSuchToolError.isInstance(error)) {
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Invalid tool name, cannot repair: ${toolCall.toolName}`);
          return null;
        }
        
        try {
          const tool = tools[toolCall.toolName as keyof typeof tools];
          
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Attempting to repair tool call with structured outputs`);
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Original input: ${JSON.stringify(toolCall.input).substring(0, 200)}`);
          
          // Reuse the same model for repair calls to keep agent behavior consistent.
          const { object: repairedArgs } = await generateObject({
            model: this.tracedModel,
            schema: tool.parameters,
            prompt: [
              `The model tried to call the tool "${toolCall.toolName}" with the following inputs:`,
              JSON.stringify(toolCall.input),
              `The tool accepts the following schema:`,
              JSON.stringify(inputSchema(toolCall)),
              `The error was: ${error.message}`,
              `Please fix the inputs to match the schema exactly.`,
            ].join('\n'),
          });
          
          getEventSystem().info(EventCategory.LLM, `✅ [SoundbirdAgent] Tool call repaired successfully`);
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Repaired input: ${JSON.stringify(repairedArgs).substring(0, 200)}`);
          
          return { ...toolCall, input: JSON.stringify(repairedArgs) };
        } catch (repairError) {
          // Log tool repair errors directly to console.error
          console.error('[SoundbirdAgent] Tool call repair failed:', repairError);
          console.error('[SoundbirdAgent] Repair error context:', {
            toolName: toolCall.toolName,
            provider: this.config.provider,
            model: this.config.model,
            originalError: error.message,
            repairErrorType: repairError instanceof Error ? repairError.name : typeof repairError,
            repairErrorMessage: repairError instanceof Error ? repairError.message : String(repairError),
          });
          
          getEventSystem().error(EventCategory.LLM, `❌ [SoundbirdAgent] Tool call repair failed: ${repairError}`);
          return null;
        }
      },
    });
    
    getEventSystem().info(EventCategory.LLM, `✅ [SoundbirdAgent] Agent initialized successfully with real Agent class`);
  }
  
  /**
   * Stream a response with automatic multi-step reasoning
   * 
   * Uses the real Agent class from AI SDK v5.
   * The Agent handles multi-step tool reasoning automatically.
   * 
   * @param options - Stream options (prompt, tools, temperature, etc.)
   * @returns AsyncIterable of stream parts (text-delta, tool-call, etc.)
   */
  async stream(options: AgentStreamOptions) {
    const {
      prompt,
      messages,
      sessionTools = [],
      temperature,
      maxTokens,
      serverToolContext,
      toolsWithExecute,
    } = options;
    
    // Validate that either prompt or messages is provided (not both)
    if (!prompt && !messages) {
      throw new Error('Either prompt or messages must be provided');
    }
    if (prompt && messages) {
      throw new Error('Cannot provide both prompt and messages');
    }
    
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Starting stream`);
    if (prompt) {
      getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
    } else if (messages) {
      getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Messages: ${messages.length} in history`);
      // Log tool calls and results for debugging
      const toolCalls = messages.filter(m => 
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-call')
      ).length;
      const toolResults = messages.filter(m => 
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-result')
      ).length;
      getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Tool calls: ${toolCalls}, Tool results: ${toolResults}`);
    }
    getEventSystem().info(EventCategory.SESSION, `🤖 [SoundbirdAgent] Tools: ${sessionTools.length} available, toolsWithExecute=${!!toolsWithExecute}`);
    
    // Convert session tools to proxy tools (without execute functions)
    // This enables client-side tool execution via the OpenAI Realtime API pattern
    // NOTE: Server tools are NOT filtered here (context not available in agent)
    // Server tool filtering happens in response handler before tool calls
    // However, in subagent mode, askSubagent is a server tool that needs execute function
    // So we need to merge server tools if serverToolContext is provided
    let proxyTools: Record<string, any> = {};
    
    // CRITICAL: If toolsWithExecute is provided, use it directly
    // This is used by the subagent which already has client tools with execute functions
    if (toolsWithExecute && Object.keys(toolsWithExecute).length > 0) {
      getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Using pre-built toolsWithExecute: ${Object.keys(toolsWithExecute).join(', ')}`);
      proxyTools = toolsWithExecute;
      
      // Verify tools have execute functions
      for (const [toolName, toolDef] of Object.entries(proxyTools)) {
        const hasExecute = typeof (toolDef as any).execute === 'function';
        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Tool ${toolName}: hasExecute=${hasExecute}`);
      }
    } else if (sessionTools.length > 0) {
      getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Processing ${sessionTools.length} session tools, serverToolContext=${!!serverToolContext}`);
      if (serverToolContext) {
        const { serverToolRegistry } = require('../lib/server-tool-registry');
        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Getting tools from registry for: ${sessionTools.map(t => t.name).join(', ')}`);

        // Start with all client-visible session tools as proxy tools.
        // Server tools are filtered out inside convertSessionToolsToProxyTools when context is provided.
        proxyTools = convertSessionToolsToProxyTools(sessionTools, serverToolContext);

        // Merge in true server tools with execute functions.
        // This preserves client proxy tools while allowing server tools to override by name.
        const serverTools = serverToolRegistry.getServerToolsForAgent(serverToolContext);
        const serverToolNames = Object.keys(serverTools);
        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Server tools from registry: ${serverToolNames.join(', ')}`);

        proxyTools = { ...proxyTools, ...serverTools };

        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] After merge - Total tools: ${Object.keys(proxyTools).length} (${Object.keys(proxyTools).join(', ')})`);
        
        // Verify tools have execute functions
        for (const [toolName, toolDef] of Object.entries(proxyTools)) {
          const hasExecute = typeof (toolDef as any).execute === 'function';
          const toolType = typeof toolDef;
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Tool ${toolName}: type=${toolType}, hasExecute=${hasExecute}, keys=${Object.keys(toolDef || {}).join(', ')}`);
        }
      } else {
        // No context - convert all sessionTools (legacy behavior)
        getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] No serverToolContext - converting all sessionTools to proxy tools`);
        proxyTools = convertSessionToolsToProxyTools(sessionTools);
      }
    }
    
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Final tools: ${Object.keys(proxyTools).length} (${Object.keys(proxyTools).join(', ')})`);
    
    // Log full context being passed to LLM (for debugging empty responses)
    const contextToLog = {
      ...(prompt ? { prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : '') } : { messages }),
      tools: Object.keys(proxyTools),
      toolCount: Object.keys(proxyTools).length,
      temperature,
      maxTokens,
      provider: this.config.provider,
      model: this.config.model,
    };
    getEventSystem().info(EventCategory.LLM, `🔍 [SoundbirdAgent] Full context being passed to LLM:`, contextToLog);
    console.log('[SoundbirdAgent] Full LLM context:', JSON.stringify(contextToLog, null, 2));
    
    // Debug: Log the actual messages structure being passed
    if (messages) {
      getEventSystem().debug(EventCategory.LLM, `🔍 [SoundbirdAgent] Messages structure being passed to Agent:`);
      getEventSystem().info(EventCategory.PROVIDER, JSON.stringify(messages.slice(0, 3), null, 2)); // First 3 messages
      if (messages.length > 3) {
        getEventSystem().info(EventCategory.PROVIDER, `... and ${messages.length - 3} more messages`);
      }
    }
    
    // Stream using the real Agent class
    // Pass either prompt or messages (Agent accepts both)
    let agentResult;
    try {
      agentResult = await this.agent.stream({
        ...(prompt ? { prompt } : { messages }),
        tools: proxyTools,
        temperature,
        maxTokens,
      });
    } catch (providerError) {
      // Log provider errors directly to console.error (in addition to event system)
      console.error('[SoundbirdAgent] Provider error during agent.stream():', providerError);
      console.error('[SoundbirdAgent] Error context:', {
        provider: this.config.provider,
        model: this.config.model,
        hasPrompt: !!prompt,
        hasMessages: !!messages,
        messageCount: messages?.length || 0,
        toolCount: Object.keys(proxyTools).length,
        temperature,
        maxTokens,
      });
      
      // Also log via event system
      getEventSystem().error(EventCategory.PROVIDER, '❌ [SoundbirdAgent] Provider error during agent.stream():', providerError instanceof Error ? providerError : new Error(String(providerError)), {
        provider: this.config.provider,
        model: this.config.model,
        errorType: providerError instanceof Error ? providerError.name : typeof providerError,
        errorMessage: providerError instanceof Error ? providerError.message : String(providerError),
      });
      
      // Re-throw to propagate error
      throw providerError;
    }
    
    // AI SDK v5 Agent.stream() returns a StreamResult object with .fullStream property
    // fullStream is the AsyncIterable that emits text-delta, tool-call, tool-result, etc.
    const agentStream = agentResult.fullStream;
    
    // Transform AI SDK stream events to match our expected format
    // AI SDK v5 emits: text-delta, tool-call, tool-result, etc.
    // We need: { type: 'text', delta }, { type: 'tool-call', ... }
    return this.transformStream(agentStream);
  }
  
  /**
   * Transform AI SDK stream events to match Soundbird's expected format
   * 
   * Note: AI SDK v5 uses 'text' property (not 'textDelta') for text-delta events
   * Note: AI SDK v5 uses 'tool-call' (hyphen) and 'input' property for tool arguments
   */
  private async *transformStream(agentStream: AsyncIterable<any>) {
    try {
      for await (const part of agentStream) {
        if (part.type === 'text-delta') {
          // Convert text-delta to our format
          // AI SDK v5: part.text contains the incremental text content
          yield { type: 'text', delta: part.text };
        } else if (part.type === 'tool-call') {
          // Convert AI SDK v5 tool-call format to our format
          // AI SDK v5: { type: 'tool-call', toolName, toolCallId, input }
          // Our format: { type: 'tool_call', toolName, toolCallId, args }
          getEventSystem().info(EventCategory.LLM, `🔧 [SoundbirdAgent] Tool call: ${part.toolName}`, part.input);
          yield {
            type: 'tool_call', // underscore, not hyphen
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            args: part.input, // rename 'input' to 'args'
          };
        } else if (part.type === 'tool-result') {
          // Convert AI SDK v5 tool-result format to our format
          // AI SDK v5: { type: 'tool-result', toolName, toolCallId, result }
          // Our format: { type: 'tool_result', toolName, toolCallId, result }
          yield {
            type: 'tool_result', // underscore, not hyphen
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            result: part.result,
          };
        } else if (part.type === 'abort') {
          // Stream was cancelled - log and throw
          console.error('[SoundbirdAgent] Stream aborted');
          getEventSystem().info(EventCategory.LLM, '🚫 [SoundbirdAgent] Stream aborted');
          throw new Error('Stream was aborted');
        } else if (part.type === 'error') {
          // Pass through errors with detailed validation info
          // Log provider errors directly to console.error (in addition to event system)
          console.error('[SoundbirdAgent] Stream error part received:', part);
          console.error('[SoundbirdAgent] Error details:', {
            errorName: part.error?.name,
            errorMessage: part.error?.message,
            errorStack: part.error?.stack,
            provider: this.config.provider,
            model: this.config.model,
          });
          
          getEventSystem().critical(EventCategory.LLM, '🚨 [SoundbirdAgent] Stream error:', part);
          
          // Drill into validation errors to see what's failing
          if (part.error?.name === 'AI_InvalidPromptError' && part.error?.cause) {
            console.error('[SoundbirdAgent] Validation error details:', part.error.cause);
            getEventSystem().error(EventCategory.LLM, '🔍 [SoundbirdAgent] Validation error details:');
            getEventSystem().error(EventCategory.PROVIDER, '   Error name:', part.error.cause.name);
            
            if (part.error.cause.cause && Array.isArray(part.error.cause.cause)) {
              console.error('[SoundbirdAgent] Validation issues:', JSON.stringify(part.error.cause.cause, null, 2));
              getEventSystem().error(EventCategory.PROVIDER, '   Validation issues:', JSON.stringify(part.error.cause.cause, null, 2));
            }
            
            if (part.error.cause.value && Array.isArray(part.error.cause.value)) {
              console.error('[SoundbirdAgent] Invalid value (first 3 items):', JSON.stringify(part.error.cause.value.slice(0, 3), null, 2));
              getEventSystem().error(EventCategory.PERFORMANCE, '   Invalid value (first 3 items):', JSON.stringify(part.error.cause.value.slice(0, 3), null, 2));
            }
          }
          
          throw part.error;
        } else if (part.type === 'usage') {
          // Pass through usage events for token tracking
          yield part;
        } else {
          // Silently ignore lifecycle events (start, start-step, finish-step, finish)
          // and reasoning events (reasoning-start, reasoning-delta, reasoning-end)
          // and text boundary events (text-start, text-end)
          // These are informational only and not needed for our processing
          const ignoredEvents = [
            'start', 'start-step', 'finish-step', 'finish',
            'reasoning-start', 'reasoning-delta', 'reasoning-end', 'reasoning',
            'text-start', 'text-end',
            'tool-input-start', 'tool-input-delta', 'tool-input-end'
          ];
          
          if (!ignoredEvents.includes(part.type)) {
            // Log truly unknown event types for debugging
            getEventSystem().warn(EventCategory.LLM, `⚠️ [SoundbirdAgent] Unknown stream event type: ${part.type}`);
          }
        }
      }
    } catch (streamError) {
      // Catch any errors during stream iteration (provider errors, network errors, etc.)
      console.error('[SoundbirdAgent] Error during stream iteration:', streamError);
      console.error('[SoundbirdAgent] Stream error context:', {
        provider: this.config.provider,
        model: this.config.model,
        errorType: streamError instanceof Error ? streamError.name : typeof streamError,
        errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
        errorStack: streamError instanceof Error ? streamError.stack : undefined,
      });
      
      // Also log via event system
      getEventSystem().error(EventCategory.PROVIDER, '❌ [SoundbirdAgent] Error during stream iteration:', streamError instanceof Error ? streamError : new Error(String(streamError)), {
        provider: this.config.provider,
        model: this.config.model,
      });
      
      // Re-throw to propagate error
      throw streamError;
    }
  }
  
  /**
   * Generate a complete response (non-streaming)
   * 
   * Note: For voice applications, stream() is preferred.
   * This method is provided for completeness.
   * 
   * @param options - Generation options
   * @returns Complete response with text and tool results
   */
  async generate(options: AgentStreamOptions) {
    const {
      prompt,
      sessionTools = [],
      temperature,
      maxTokens,
    } = options;
    
    getEventSystem().info(EventCategory.LLM, `🤖 [SoundbirdAgent] Generating complete response`);
    
    // Convert session tools to proxy tools
    const proxyTools = sessionTools.length > 0
      ? convertSessionToolsToProxyTools(sessionTools)
      : {};
    
    // Use Agent's generate method
    const result = await this.agent.generate({
      prompt,
      tools: proxyTools,
      temperature,
      maxTokens,
    });
    
    return result;
  }
  
  /**
   * Get current configuration
   */
  getConfig(): Readonly<AgentConfig> {
    return { ...this.config };
  }
}
