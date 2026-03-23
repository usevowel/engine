/**
 * ⚠️ DEPRECATED - DO NOT MODIFY ⚠️
 * 
 * This agent is deprecated and should not be updated or modified.
 * Use CustomAgent instead for new development.
 * 
 * VercelSDKAgent - Wrapper around Vercel AI SDK Agent
 * 
 * This implementation wraps the existing SoundbirdAgent (which uses Vercel AI SDK's
 * Agent class) to implement the ILLMAgent interface. It provides:
 * - Automatic context window management via prepareStep
 * - Automatic loop detection via stopWhen
 * - Multi-step tool reasoning
 * - Integration with client-side tool proxy pattern
 * 
 * This is the default agent implementation, providing battle-tested behavior
 * from Vercel's AI SDK with minimal overhead.
 * 
 * @deprecated Use CustomAgent instead
 * @module VercelSDKAgent
 */

import { ILLMAgent, AgentConfig, AgentStreamOptions, AgentStreamPart, AgentMetadata } from './ILLMAgent';
import { SoundbirdAgent, AgentConfig as SoundbirdAgentConfig } from '../agent-provider';

import { getEventSystem, EventCategory } from '../../events';
/**
 * VercelSDKAgent - Wrapper around Vercel AI SDK Agent
 * 
 * Implements ILLMAgent interface by wrapping the existing SoundbirdAgent.
 * This provides a clean abstraction while maintaining all the benefits of
 * the Vercel AI SDK's Agent class.
 * 
 * @example
 * ```typescript
 * const agent = new VercelSDKAgent({
 *   provider: 'groq',
 *   apiKey: 'gsk_...',
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   systemPrompt: 'You are a helpful assistant',
 *   maxSteps: 3,
 *   maxContextMessages: 15,
 * });
 * 
 * const stream = await agent.stream({
 *   messages: conversationHistory,
 *   sessionTools: tools,
 * });
 * 
 * for await (const part of stream) {
 *   if (part.type === 'text-delta') {
 *     getEventSystem().info(EventCategory.LLM, part.text);
 *   }
 * }
 * ```
 */
export class VercelSDKAgent implements ILLMAgent {
  private config: AgentConfig;
  private soundbirdAgent: SoundbirdAgent;
  
  constructor(config: AgentConfig) {
    this.config = config;
    
    getEventSystem().info(EventCategory.LLM, '🎯 [VercelSDKAgent] Initializing wrapper around SoundbirdAgent');
    
    // Convert AgentConfig to SoundbirdAgentConfig
    const soundbirdConfig: SoundbirdAgentConfig = {
      provider: config.provider as any, // Cast to SupportedProvider
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps,
      maxContextMessages: config.maxContextMessages,
      openrouterSiteUrl: config.openrouterSiteUrl,
      openrouterAppName: config.openrouterAppName,
      sessionId: config.sessionId, // Pass session ID for PostHog tracking
    };
    
    // Create the underlying SoundbirdAgent
    this.soundbirdAgent = new SoundbirdAgent(soundbirdConfig);
    
    getEventSystem().info(EventCategory.LLM, '✅ [VercelSDKAgent] Wrapper initialized successfully');
  }
  
  /**
   * Stream a response with automatic conversation management
   * 
   * Delegates to the underlying SoundbirdAgent, which uses Vercel AI SDK's
   * Agent class for multi-step tool reasoning and automatic context management.
   * 
   * @param options - Stream options (messages, tools, temperature, etc.)
   * @returns AsyncIterable of stream parts
   */
  async stream(options: AgentStreamOptions): Promise<AsyncIterable<AgentStreamPart>> {
    getEventSystem().info(EventCategory.LLM, '🎯 [VercelSDKAgent] Streaming response');
    
    // Convert our AgentStreamOptions to SoundbirdAgent's format
    // CRITICAL: Pass serverToolContext so SoundbirdAgent can get tools with execute functions
    // CRITICAL: Pass toolsWithExecute if provided (used by subagent for client tools)
    const soundbirdOptions = {
      prompt: options.prompt,
      messages: options.messages,
      sessionTools: options.sessionTools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      serverToolContext: options.serverToolContext,
      toolsWithExecute: options.toolsWithExecute,
    };
    
    // Get the stream from SoundbirdAgent
    const soundbirdStream = await this.soundbirdAgent.stream(soundbirdOptions);
    
    // Transform SoundbirdAgent's stream format to our AgentStreamPart format
    return this.transformStream(soundbirdStream);
  }
  
  /**
   * Transform SoundbirdAgent stream to AgentStreamPart format
   * 
   * SoundbirdAgent emits:
   * - { type: 'text', delta: string }
   * - { type: 'tool_call', toolName, toolCallId, args }
   * - { type: 'tool_result', toolName, toolCallId, result }
   * - { type: 'usage', ... }
   * 
   * We need to emit:
   * - { type: 'text-delta', text: string }
   * - { type: 'tool-call', toolName, toolCallId, args }
   * - { type: 'tool-result', toolName, toolCallId, result }
   * - { type: 'usage', ... }
   */
  private async *transformStream(soundbirdStream: AsyncIterable<any>): AsyncIterable<AgentStreamPart> {
    for await (const part of soundbirdStream) {
      if (part.type === 'text') {
        // Convert { type: 'text', delta } to { type: 'text-delta', text }
        yield {
          type: 'text-delta',
          text: part.delta,
        };
      } else if (part.type === 'tool_call') {
        // Convert { type: 'tool_call' } to { type: 'tool-call' }
        yield {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
        };
      } else if (part.type === 'tool_result') {
        // Convert { type: 'tool_result' } to { type: 'tool-result' }
        yield {
          type: 'tool-result',
          toolCallId: part.toolCallId,
          result: part.result,
        };
      } else if (part.type === 'usage') {
        // Pass through usage events
        yield {
          type: 'usage',
          promptTokens: part.promptTokens,
          completionTokens: part.completionTokens,
          totalTokens: part.totalTokens,
        };
      } else {
        // Unknown event type - log warning
        getEventSystem().warn(EventCategory.LLM, `⚠️ [VercelSDKAgent] Unknown stream event type: ${part.type}`);
      }
    }
  }
  
  /**
   * Get agent metadata for debugging and monitoring
   * 
   * @returns Agent metadata
   */
  getMetadata(): AgentMetadata {
    return {
      type: 'vercel-sdk',
      provider: this.config.provider,
      model: this.config.model,
      maxSteps: this.config.maxSteps || 3,
      maxContextMessages: this.config.maxContextMessages || 15,
      contextStrategy: 'message-count', // VercelSDKAgent uses simple message-count truncation
    };
  }
  
  /**
   * Cleanup resources (called on disconnect)
   * 
   * For VercelSDKAgent, there's no cleanup needed as the underlying
   * SoundbirdAgent doesn't maintain persistent state.
   * 
   * @returns Promise that resolves immediately
   */
  async cleanup(): Promise<void> {
    getEventSystem().info(EventCategory.LLM, '🧹 [VercelSDKAgent] Cleanup called (no-op for VercelSDKAgent)');
    // No cleanup needed for VercelSDKAgent
  }
}


