/**
 * ILLMAgent - Common interface for all LLM agent implementations
 * 
 * This interface provides a unified API for different agent approaches,
 * allowing the system to swap between implementations (e.g., Vercel SDK Agent
 * vs Custom Agent) without changing the session handler code.
 * 
 * All agent implementations must implement this interface to ensure
 * compatibility with the session management system.
 * 
 * @module ILLMAgent
 */

import { CoreMessage } from 'ai';

import { getEventSystem, EventCategory } from '../../events';
/**
 * Configuration for creating an agent instance
 */
export interface AgentConfig {
  /** Type of agent to create (e.g., 'vercel-sdk', 'custom') */
  agentType?: 'vercel-sdk' | 'custom' | string;
  
  /** LLM provider (from registry) */
  provider: string;
  
  /** API key for the provider */
  apiKey: string;

  /** Optional base URL for OpenAI-compatible or self-hosted providers */
  baseUrl?: string;
  
  /** Model identifier */
  model: string;
  
  /** 
   * System prompt generator function (called on each LLM call)
   * Receives context and returns the system prompt string
   * For CustomAgent: This allows dynamic system prompts based on current language, user instructions, etc.
   */
  systemPrompt: string | ((context?: SystemPromptContext) => string);
  
  /** Maximum number of tool-calling steps (default: 3) */
  maxSteps?: number;
  
  /** 
   * Maximum number of messages to keep in context (deprecated - use maxContextTokens instead)
   * @deprecated Use maxContextTokens for token-based context management
   */
  maxContextMessages?: number;
  
  /** 
   * Maximum number of tokens to keep in conversation history (default: 72000)
   * Minimum enforced: 6000 tokens
   */
  maxContextTokens?: number;
  
  /** 
   * Minimum number of tokens to keep in conversation history (default: 32000)
   * Ensures we always keep enough context for meaningful conversations
   */
  minContextTokens?: number;
  
  /** OpenRouter-specific configuration */
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
  
  /** Context management strategy (for CustomAgent) */
  contextStrategy?: 'message-count' | 'token-count' | 'sliding-window' | 'summarization';
  
  /** Summarization configuration (if using 'summarization' strategy) */
  summarizationConfig?: {
    activeWindowSize?: number;
    summarizationBufferSize?: number;
    maxSummaries?: number;
    summarizationProvider?: string;
    summarizationModel?: string;
  };
  
  /** Maximum number of stream restarts after hard errors (default: 3) */
  maxStreamRetries?: number;
  
  /** Session ID for PostHog LLM analytics tracking (optional) */
  sessionId?: string;
  
  /** 
   * Groq reasoning effort override (optional)
   * If provided, takes precedence over GROQ_REASONING_EFFORT environment variable
   * Valid values: 'none', 'low', 'medium', 'high', 'default'
   */
  groqReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'default';
}

/**
 * Context for generating system prompts dynamically
 */
export interface SystemPromptContext {
  /** Current target language (ISO 639-1 code, e.g., 'en', 'fr') */
  targetLanguage?: string | null;
  
  /** User-provided instructions */
  userInstructions?: string;
  
  /** Agent type (e.g., 'custom', 'vercel-sdk') */
  agentType?: string;
  
  /** Speech mode: 'implicit' (default) or 'explicit' */
  speechMode?: 'implicit' | 'explicit';
}

/**
 * Options for streaming a response
 */
export interface AgentStreamOptions {
  /** 
   * Full conversation history (for agents that need it)
   * Some agents (like CustomAgent) manage history manually
   */
  messages?: CoreMessage[];
  
  /** 
   * Single prompt (for agents that manage history internally)
   * Some agents (like VercelSDKAgent) track history automatically
   */
  prompt?: string;
  
  /** Session tools to make available to the agent */
  sessionTools?: any[];
  
  /** Temperature for generation (optional, provider default if not specified) */
  temperature?: number;
  
  /** Maximum tokens for generation (optional, provider default if not specified) */
  maxTokens?: number;
  
  /** Frequency penalty (0.0-2.0) - reduces repetition by penalizing tokens based on frequency */
  frequencyPenalty?: number;
  
  /** Presence penalty (0.0-2.0) - reduces repetition by penalizing tokens that have appeared */
  presencePenalty?: number;
  
  /** Repetition penalty (0.0-2.0) - OpenRouter-specific, reduces repetition of tokens from input */
  repetitionPenalty?: number;
  
  /** Unified trace ID for agent analytics (set when STT starts) */
  traceId?: string;
  
  /** 
   * Optional system prompt override (for dynamic updates, e.g., language changes)
   * If provided, this overrides the agent's configured system prompt for this stream call
   * Can be a string or a function that generates the prompt
   */
  systemPrompt?: string | ((context?: SystemPromptContext) => string);
  
  /** 
   * Context for system prompt generation (if using a function)
   * Passed to the system prompt generator function
   */
  systemPromptContext?: SystemPromptContext;
  
  /**
   * Optional server tool context for merging server tools with execute functions
   * When provided, server tools are filtered from sessionTools and merged with execute functions
   */
  serverToolContext?: import('../../lib/server-tool-registry').ServerToolContext;
  
  /**
   * Optional pre-built tools with execute functions
   * When provided, these tools are used directly instead of building from sessionTools.
   * This is used by the subagent to pass client tools with execute functions that forward to client.
   */
  toolsWithExecute?: Record<string, any>;
}

/**
 * Stream parts - unified format across all agent implementations
 */
export type AgentStreamPart =
  | TextDeltaPart
  | ToolCallPart
  | ToolResultPart
  | UsagePart
  | ErrorPart;

/**
 * Text delta part - incremental text content
 * Note: Uses 'text' type to match session handler expectations
 */
export interface TextDeltaPart {
  type: 'text';
  delta: string;
}

/**
 * Tool call part - AI requesting tool execution
 * Note: Uses 'tool_call' type to match session handler expectations
 */
export interface ToolCallPart {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: any;
}

/**
 * Tool result part - Result from tool execution
 * Note: Uses 'tool_result' type to match session handler expectations
 */
export interface ToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  result: any;
}

/**
 * Usage part - Token usage information
 */
export interface UsagePart {
  type: 'usage';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Error part - Error during streaming
 */
export interface ErrorPart {
  type: 'error';
  error: Error;
}

/**
 * Agent metadata for debugging and monitoring
 */
export interface AgentMetadata {
  /** Type of agent implementation */
  type: 'vercel-sdk' | 'custom' | string;
  
  /** LLM provider being used */
  provider: string;
  
  /** Model being used */
  model: string;
  
  /** Maximum tool-calling steps */
  maxSteps: number;
  
  /** Maximum context messages */
  maxContextMessages: number;
  
  /** Context strategy (if applicable) */
  contextStrategy?: string;
}

/**
 * ILLMAgent - Common interface for all LLM agent implementations
 * 
 * This interface defines the contract that all agent implementations must follow.
 * It provides a unified API for:
 * - Streaming responses with automatic conversation management
 * - Getting agent metadata for debugging/logging
 * - Cleaning up resources on disconnect
 * 
 * @example
 * ```typescript
 * // Create an agent via factory
 * const agent = AgentFactory.create({
 *   agentType: 'custom',
 *   provider: 'groq',
 *   apiKey: 'gsk_...',
 *   model: 'moonshotai/kimi-k2-instruct-0905',
 *   systemPrompt: 'You are a helpful assistant',
 *   maxSteps: 3,
 *   maxContextMessages: 15,
 * });
 * 
 * // Stream a response
 * const stream = await agent.stream({
 *   messages: conversationHistory,
 *   sessionTools: tools,
 * });
 * 
 * // Process stream parts
 * for await (const part of stream) {
 *   if (part.type === 'text-delta') {
 *     getEventSystem().info(EventCategory.LLM, part.text);
 *   } else if (part.type === 'tool-call') {
 *     // Handle tool call
 *   }
 * }
 * 
 * // Get metadata
 * const metadata = agent.getMetadata();
 * getEventSystem().info(EventCategory.LLM, `Using ${metadata.type} agent with ${metadata.model}`);
 * 
 * // Cleanup on disconnect
 * await agent.cleanup();
 * ```
 */
export interface ILLMAgent {
  /**
   * Stream a response with automatic conversation management
   * 
   * This method generates a response from the LLM, yielding stream parts
   * as they become available. The agent handles conversation history,
   * context management, and tool orchestration internally.
   * 
   * @param options - Stream options (messages, tools, temperature, etc.)
   * @returns AsyncIterable of stream parts
   * 
   * @example
   * ```typescript
   * const stream = await agent.stream({
   *   messages: [
   *     { role: 'user', content: 'Hello!' }
   *   ],
   *   sessionTools: [navigateTool, searchTool],
   *   temperature: 0.7,
   * });
   * 
   * for await (const part of stream) {
   *   if (part.type === 'text-delta') {
   *     process.stdout.write(part.text);
   *   }
   * }
   * ```
   */
  stream(options: AgentStreamOptions): Promise<AsyncIterable<AgentStreamPart>>;
  
  /**
   * Get agent metadata for debugging and monitoring
   * 
   * Returns information about the agent implementation, configuration,
   * and current state. Useful for logging, debugging, and monitoring.
   * 
   * @returns Agent metadata
   * 
   * @example
   * ```typescript
   * const metadata = agent.getMetadata();
   * getEventSystem().info(EventCategory.LLM, `Agent: ${metadata.type}`);
   * getEventSystem().info(EventCategory.LLM, `Model: ${metadata.model}`);
   * getEventSystem().info(EventCategory.LLM, `Max Steps: ${metadata.maxSteps}`);
   * ```
   */
  getMetadata(): AgentMetadata;
  
  /**
   * Cleanup resources (called on disconnect)
   * 
   * Performs any necessary cleanup when the agent is no longer needed.
   * This may include clearing conversation history, closing connections,
   * or releasing other resources.
   * 
   * @returns Promise that resolves when cleanup is complete
   * 
   * @example
   * ```typescript
   * // On session disconnect
   * await agent.cleanup();
   * ```
   */
  cleanup(): Promise<void>;
}

